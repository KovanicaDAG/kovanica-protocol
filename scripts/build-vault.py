#!/usr/bin/env python3
"""
build-vault.py — assemble the Kovanica Protocol Obsidian vault from the monorepo docs.

What it does
------------
1. Walks an ordered rule list (source glob -> vault category). First match wins.
2. Copies each matched markdown file into `vault/<category>/`, preserving the
   source-relative directory tail so names stay unique and readable.
3. Rewrites relative markdown links into Obsidian wikilinks that resolve inside
   the vault, using a source->dest map built in step 1. Links to code (or to
   files we excluded) are left untouched.
4. Injects/merges YAML frontmatter (title, category, source, synced, tags).
5. Regenerates the 00-Home MOCs.
6. NEVER touches `90-Notes/` — that tree is yours.

The vault directory is gitignored from the monorepo and is its own git repo,
so this script is the "regenerate from source of truth" half of the sync story.

Usage
-----
    ./scripts/build-vault.py                 # build into ./vault
    ./scripts/build-vault.py --include-sensitive
    ./scripts/build-vault.py --with-agent-config
    ./scripts/build-vault.py --dry-run

Classification note: this is a documentation-packaging tool. It makes no
consensus or ledger changes (client-only / docs-only).
"""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import re
import shutil
import sys
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parent.parent
VAULT = REPO / "vault"
NOTES_DIR = "90-Notes"
UNFILED_DIR = "99-Unfiled"
SENTINEL = ".vault-managed"

# Vault entries the build must never delete. `.obsidian` is hand-maintained
# vault configuration, not generated content.
PRESERVE = {NOTES_DIR, ".git", ".obsidian"}

# Directories never walked, at any depth.
PRUNE_DIRS = {
    ".git", "node_modules", "target", "dist", "build", ".next", ".turbo",
    ".svelte-kit", ".venv", "__pycache__", ".idea", ".vscode", "cov",
    ".gradle", "vendor", ".cargo", ".obsidian", ".pytest_cache", ".github",
}

# Top-level trees excluded wholesale. `kovanica-protocol/` is an untracked
# scratch copy of the agent config; `trezor-coin-def/` is an external vendor
# clone already ignored by the monorepo .gitignore.
PRUNE_ROOTS = {"kovanica-protocol", "trezor-coin-def", "00-Home"}

# Files with generated / vendored content that add no vault value.
PRUNE_FILE_RE = re.compile(
    r"(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|"
    r"theme\.css|app\.css|.*\.snap)$"
)

# ---------------------------------------------------------------------------
# Category rules. Ordered: first match wins. Source globs are matched against
# the repo-relative POSIX path. Keep this list top-of-mind when adding docs.
# ---------------------------------------------------------------------------
CATEGORIES: list[tuple[str, list[str]]] = [
    ("10-Protocol", [
        "protocol/docs/RFC-*", "protocol/docs/KVP*", "protocol/docs/TOKENOMICS.md",
        "protocol/docs/SPEC-INDEX.md", "protocol/docs/WHAT-IS-KOVANICA.md",
        "protocol/docs/LEGIT-BOARD.md", "protocol/docs/SECURITY.md",
        "protocol/docs/MAINNET-CRITERIA.md", "protocol/AGENTS.md",
    ]),
    ("20-Network", [
        "protocol/NETWORK.md", "protocol/docs/upgrades/**",
        "THIRD-SEED-PROVIDER-CHECKLIST.md", "TODO/seed2-deploy.md",
        "TODO/public-api-bootstrap-peers.md", "TODO/git-remote-credential-rotation.md",
    ]),
    ("30-Operations", [
        "protocol/OPERATIONS.md", "protocol/docs/OPS-HARDENING.md",
        "protocol/docs/RUN-A-NODE.md", "protocol/docs/RELEASE.md",
        "protocol/docs/RAM-REDUCTION.md", "protocol/docs/TESTNET-SOAK.md",
        "protocol/docs/soak-snapshot-*.md", "protocol/docs/api/**",
        "protocol/TESTNET*.md", "protocol/HOWTO_*.md", "protocol/docs/TESTNET-RESET-POLICY.md",
        "protocol/deploy/**", "installer/**", "web/site/DEPLOY.md",
        "protocol/docs/RFC-008-OraclePruning.md",
    ]),
    ("40-Node", [
        "node/**", "protocol/docs/patches/**", "protocol/PHASE_1_MERGE_STATUS.md",
        "protocol/MERGE_PREVIEW.md",
    ]),
    ("50-Components", [
        "web/**", "wallet/**", "mobile/**", "android-light-node/**",
        "cli/**", "sdk/**", "ledger-app/**", "data/README.md",
        "protocol/desktop-app/**",
    ]),
    ("60-Planning", [
        "60-Planning/**",
        "MASTER-ROADMAP.md", "docs/**", "TODO/plans/**", "plans/**",
        "protocol/docs/plans/**", "protocol/TODO.md", "protocol/Restructure*.md",
    ]),
    ("70-Policy", [
        "protocol/LEGAL_PAYMENT_POLICY.md", "protocol/docs/ENTITY-LEGAL.md",
        "protocol/docs/BUG-BOUNTY.md", "protocol/docs/AUDIT-PLAN.md",
        "protocol/docs/COMMUNITY-DISCORD.md", "protocol/docs/DISCORD-SETUP.md",
        "protocol/docs/REPRODUCIBLE-BUILDS.md", "protocol/docs/AUDIT-PLAN.md",
    ]),
    ("80-Repo-Doctrine", [
        "AGENTS.md", "README.md", "PROJECT.md", "TEST_INFRA.md", "TEST_READY.md",
        "kovanica-wallet-info.md", "protocol/README.md",
    ]),
]

# Excluded by default: infra-sensitive runbooks. Enable with --include-sensitive.
SENSITIVE: list[str] = [
    "TESTNET-RESET-CREDENTIALS.md", "TESTNET-RESET-PROCEDURE.md",
]

# Duplicated or stale sources, kept out of the vault so the phone copy cannot
# contradict canonical docs. Values are the reason, surfaced in 00-Home/Not-
# vendored.md rather than silently dropped.
STALE: dict[str, str] = {
    # protocol/NETWORK.md is the single canonical network truth. It was
    # previously listed here as a stale "duplicate of NETWORK.md" on the
    # premise that a root-level NETWORK.md was newer and more complete. No
    # root NETWORK.md exists (it moved under protocol/), so that entry
    # excluded the ONLY canonical copy from the vault — and the tracked
    # vault/docs/_root/NETWORK.md was a leftover that kept drifting (it
    # carried a false "seed3 DNS deleted / NXDOMAIN" claim). Removing the
    # entry lets 20-Network vend protocol/NETWORK.md fresh on each build.
    #
    # The RedesignDomains package calls this out itself: "Canonical full
    # reference: ../NETWORK.md". Its 07-MAINNET-ACTIVATION.md stays (open).
    "protocol/docs/upgrades/02-RedesignDomains/NETWORK.md":
        "self-declared non-canonical copy of NETWORK.md",
    # node/TESTNET.md is now only a pointer stub to protocol/TESTNET.md (it used
    # to carry a factually wrong pre-RFC-006 economy). A 6-line pointer adds
    # nothing on a phone, so keep the canonical table and drop the stub.
    "node/TESTNET.md":
        "pointer stub superseded by protocol/TESTNET.md (canonical parameter table)",
}

# Disambiguate notes that would otherwise share an Obsidian title.
TITLE_OVERRIDES: dict[str, str] = {
    "AGENTS.md": "AGENTS.md — Monorepo Conventions",
    "protocol/AGENTS.md": "AGENTS.md — Protocol Consensus Doctrine",
}

# Agent/skill/command doctrine. Off by default (--with-agent-config to enable).
AGENT_CONFIG_GLOBS = [
    ".opencode/agents/**", ".opencode/skills/**", ".opencode/commands/**",
    ".opencode/plugins/README.md", ".opencode/tools/README.md",
]

MD_LINK = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+?)(?:\s+\"[^\"]*\")?\)")
WIKI_LINK = re.compile(r"(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]")
FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)


def prune(rel: PurePosixPath) -> bool:
    if rel.parts[0] in PRUNE_ROOTS:
        return True
    # Generated FFI binding output — regenerated, carries no vault knowledge.
    if str(rel).startswith("protocol/crates/kovanica-ffi/bindings/"):
        return True
    if any(part in PRUNE_DIRS for part in rel.parts[:-1]):
        return True
    if rel.parts[0] in PRUNE_DIRS:
        return True
    return bool(PRUNE_FILE_RE.match(str(rel)))


def iter_markdown(extra_agent_config: bool):
    for path in REPO.rglob("*.md"):
        rel = path.relative_to(REPO)
        if rel.parts[0] == "vault" or rel.parts[0] == "scripts":
            continue
        if prune(rel):
            continue
        yield path, rel.as_posix()


def glob_match(rel: str, glob: str) -> bool:
    """Match a repo-relative path against a category glob.

    - `dir/**`      -> everything under `dir/`
    - no wildcard   -> exact match
    - otherwise     -> fnmatch, with `*` anchored per path segment
    """
    if glob.endswith("/**"):
        return rel.startswith(glob[:-2])
    if not any(ch in glob for ch in "*?["):
        return rel == glob
    # fnmatch's `*` also crosses `/`; restrict it to a single segment.
    seg_pat = re.escape(glob).replace(r"\*", "[^/]*")
    return re.fullmatch(seg_pat, rel) is not None


def categorise(rel: str, agent_cfg: bool) -> str | None:
    for cat, globs in CATEGORIES:
        for g in globs:
            if glob_match(rel, g):
                return cat
    if agent_cfg:
        for g in AGENT_CONFIG_GLOBS:
            if glob_match(rel, g):
                return "85-Agent-Doctrine"
    return None


def dest_for(cat: str, rel: str) -> PurePosixPath:
    """Flatten the source path into one traceable filename inside the category.

    `protocol/docs/RFC-001-Multisig.md` -> `10-Protocol/protocol-docs-RFC-001-Multisig.md`

    Flat per category (rather than mirroring the source tree) keeps the phone
    sidebar readable, while the source directory prefix keeps every name unique
    and traceable back to the repo. `build_map` asserts no collisions.
    """
    p = PurePosixPath(rel)
    if len(p.parts) == 1:
        return PurePosixPath(cat, p.name)
    prefix = "--".join(slug(x) for x in p.parts[:-1])
    return PurePosixPath(cat, f"{prefix}--{p.name}")


def slug(s: str) -> str:
    """Collapse whitespace/odd chars in a path component. Traceability lives in
    frontmatter `source:`, so the filename itself may be normalised."""
    s = s.removesuffix(".md")
    s = re.sub(r"\s+", "-", s.strip())
    return re.sub(r"[^A-Za-z0-9._-]", "-", s) or "x"


def build_map(include_sensitive: bool, agent_cfg: bool):
    """Map source-relative paths to vault destinations.

    Returns (mapping, skipped) where `skipped` is only for files deliberately
    left out (sensitive, external vendor trees, agent config when disabled).
    Anything that merely lacks a category rule is filed into 99-Unfiled/ so no
    source doc disappears silently.
    """
    mapping: dict[str, PurePosixPath] = {}
    skipped: list[tuple[str, str]] = []
    seen: dict[PurePosixPath, str] = {}
    for _, rel in iter_markdown(agent_cfg):
        if rel.startswith("scripts/"):
            continue
        if rel in SENSITIVE and not include_sensitive:
            skipped.append((rel, "infra-sensitive — re-run with --include-sensitive"))
            continue
        if rel in STALE:
            skipped.append((rel, f"stale/duplicate — {STALE[rel]}"))
            continue
        cat = categorise(rel, agent_cfg)
        if cat is None:
            # Agent doctrine is opt-in. It is a deliberate exclusion, not an
            # orphan, so it must not land in 99-Unfiled.
            if rel.startswith(".opencode/"):
                skipped.append((rel, "agent doctrine — re-run with --with-agent-config"))
                continue
            cat = UNFILED_DIR
        dest = dest_for(cat, rel)
        if dest in seen and seen[dest] != rel:
            raise SystemExit(
                f"vault name collision: {rel!r} and {seen[dest]!r} -> {dest}\n"
                f"tighten the CATEGORIES globs or dest_for() in {__file__}"
            )
        seen[dest] = rel
        mapping[rel] = dest
    return mapping, skipped


def resolve(target: str, source_rel: str, mapping: dict[str, PurePosixPath]) -> str | None:
    """Resolve a relative link target to a vault wikilink, or None to leave as-is."""
    if target.startswith(("http://", "https://", "mailto:", "#", "/")):
        return None
    path_part = target.split("#", 1)[0]
    anchor = target[len(path_part):]
    if not path_part:
        return None
    # Auto-append .md if missing (Obsidian convention)
    if not path_part.lower().endswith(".md"):
        path_part += ".md"
    
    # First try as repo-root-relative (for absolute-like links like 60-Planning/...)
    norm = os_norm(path_part)
    if not norm.startswith("..") and norm in mapping:
        dest = mapping[norm]
        return str(dest.with_suffix("")) + anchor
    
    # Fall back to source-relative resolution
    if not path_part.lower().endswith(".md"):
        path_part += ".md"
    src_dir = PurePosixPath(source_rel).parent
    norm = os_norm(str((PurePosixPath(source_rel).parent / path_part)))
    if norm.startswith(".."):
        return None
    dest = mapping.get(norm)
    if dest is None:
        return None
    return str(dest.with_suffix("")) + anchor


def os_norm(p: str) -> str:
    parts: list[str] = []
    for seg in p.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
            continue
        parts.append(seg)
    return "/".join(parts)


def rewrite_links(text: str, source_rel: str, mapping: dict[str, PurePosixPath]) -> tuple[str, int]:
    count = 0

    def sub_md(m: re.Match) -> str:
        nonlocal count
        bang, label, target = m.group(1), m.group(2), m.group(3)
        link = resolve(target, source_rel, mapping)
        if link is None:
            return m.group(0)
        count += 1
        stem = link.rsplit("/", 1)[-1]
        if label.strip() and label.strip() != stem:
            return f"{bang}[[{link}|{label.strip()}]]"
        return f"{bang}[[{link}]]"

    def sub_wiki(m: re.Match) -> str:
        nonlocal count
        bang, target, anchor, alias = m.group(1), m.group(2), m.group(3), m.group(4)
        full_target = target + (anchor or "")
        link = resolve(full_target, source_rel, mapping)
        if link is None:
            return m.group(0)
        count += 1
        if alias and alias.strip():
            return f"{bang}[[{link}|{alias.strip()}]]"
        return f"{bang}[[{link}]]"

    text = MD_LINK.sub(sub_md, text)
    text, n_wiki = WIKI_LINK.subn(sub_wiki, text)
    count += n_wiki
    return text, count


def upsert_frontmatter(text: str, title: str, cat: str, source_rel: str, synced: str) -> str:
    body = text
    m = FM_RE.match(text)
    if m:
        existing = m.group(1)
        keep = [ln for ln in existing.splitlines()
                if not re.match(r"^(title|category|source|synced|tags|source_path):", ln)]
        block = "\n".join(keep).strip("\n")
        meta = f"category: {cat}\nsource: {source_rel}\nsynced: {synced}"
        if block:
            meta = block + "\n" + meta
        body = f"---\n{meta}\n---\n" + text[m.end():]
    else:
        meta = (f"title: {yaml_str(title)}\ncategory: {cat}\n"
                f"source: {source_rel}\nsynced: {synced}")
        body = f"---\n{meta}\n---\n" + text.lstrip("\n")
    return body


def yaml_str(s: str) -> str:
    return '"' + s.replace('"', '\\"') + '"'


def note_title(text: str, fallback: str) -> str:
    """First ATX H1 of a note, as a single line.

    Deliberately line-bounded: an earlier greedy version swallowed whole
    documents into MOC entries and frontmatter titles.
    """
    body = text
    m = FM_RE.match(text)
    if m:
        body = text[m.end():]
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("# "):
            t = s[2:].strip()
            t = re.sub(r"\s+", " ", t).strip().rstrip("#").strip()
            if t:
                return t
    return re.sub(r"\s+", " ", fallback)


def write_mocs(mapping: dict[str, PurePosixPath], synced: str, skipped: list) -> None:
    home = VAULT / "00-Home"
    home.mkdir(parents=True, exist_ok=True)

    by_cat: dict[str, list[str]] = {}
    for src, dest in sorted(mapping.items()):
        by_cat.setdefault(dest.parts[0], []).append(dest.as_posix())

    cat_links = "\n".join(
        f"- [[00-Home/{cat}|{cat[3:]}]] — {len(v)} notes"
        for cat, v in sorted(by_cat.items())
    )
    unfiled = by_cat.get(UNFILED_DIR, [])
    if unfiled:
        unfiled_note = (
            f"Add or tighten a glob in the `CATEGORIES` list in\n"
            f"`scripts/build-vault.py` and re-run. Notes with no matching rule land in\n"
            f"[[00-Home/{UNFILED_DIR}|{UNFILED_DIR}]] so they are never silently dropped."
        )
    else:
        unfiled_note = (
            "Add or tighten a glob in the `CATEGORIES` list in\n"
            "`scripts/build-vault.py` and re-run. Every doc currently lands in a\n"
            "category — nothing is sitting unfiled."
        )

    (home / "Home.md").write_text(
        f"""---
title: Kovanica Protocol Vault
synced: {synced}
generated_by: scripts/build-vault.py
---

# Kovanica Protocol Vault

Generated from the `kovanica-protocol` monorepo by `scripts/build-vault.py`
(`./scripts/build-vault.sh` is the wrapper). `90-Notes/` is yours — the build
never reads, writes, or deletes it.

## Browse

{cat_links}

## How sync stays honest

- **Desktop** — `./scripts/build-vault.sh` regenerates every category from the
  repo. The repo is the source of truth; the vault is a projection of it.
- **Phone** — this vault is its own git repo with its own remote, so any
  Obsidian git plugin can pull and push.
- **Never lose notes** — hand-written notes live in `90-Notes/`. Re-running the
  build leaves that tree untouched.
- **Trace any doc** — every vendored note carries `source:` frontmatter with its
  repo path. Nothing in the vault is hand-maintained except `90-Notes/`.

## When a doc lands in the wrong place

{unfiled_note}
""", encoding="utf-8")

    for cat, dests in sorted(by_cat.items()):
        lines = [
            "---",
            f"title: {yaml_str(cat[3:] + ' index')}",
            "category: index",
            f"synced: {synced}",
            "generated_by: scripts/build-vault.py",
            "---",
            "",
            f"# {cat[3:]}",
            "",
            f"← [[00-Home/Home|Home]] · {len(dests)} notes",
            "",
        ]
        for d in sorted(dests):
            p = VAULT / d
            t = note_title(p.read_text(encoding="utf-8", errors="replace"), p.stem)
            lines.append(f"- [[{d[:-3]}|{t}]]")
        (home / f"{cat}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    if skipped:
        rows = [
            "---",
            "title: Not vendored",
            "category: index",
            f"synced: {synced}",
            "generated_by: scripts/build-vault.py",
            "---",
            "",
            "# Deliberately not vendored",
            "",
            "Left out on purpose. Each is either infra-sensitive or regenerable.",
            "The vault is git-backed and syncs to a phone, so operationally",
            "sensitive material stays in the repo where it belongs.",
            "",
        ]
        rows += [f"- `{r}` — {why}" for r, why in sorted(skipped)]
        (home / "Not-vendored.md").write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-sensitive", action="store_true")
    ap.add_argument("--with-agent-config", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    synced = dt.date.today().isoformat()
    mapping, skipped = build_map(args.include_sensitive, args.with_agent_config)

    print(f"matched {len(mapping)} notes, skipped {len(skipped)}")
    if args.dry_run:
        for cat in sorted({d.parts[0] for d in mapping.values()}):
            n = sum(1 for d in mapping.values() if d.parts[0] == cat)
            print(f"  {cat:24} {n:3}")
        return 0

    # Clean step: the build owns every generated category, so it wipes those
    # and rewrites them. Hand-maintained trees and vault config are preserved
    # — an earlier version deleted .obsidian/ here and silently shipped a vault
    # that would not open as an Obsidian vault.
    if VAULT.exists():
        for child in VAULT.iterdir():
            if child.name in PRESERVE:
                continue
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    (VAULT / NOTES_DIR).mkdir(parents=True, exist_ok=True)
    (VAULT / UNFILED_DIR).mkdir(parents=True, exist_ok=True)

    links = 0
    for src_rel, dest_rel in sorted(mapping.items()):
        src = REPO / src_rel
        dest = VAULT / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        text = src.read_text(encoding="utf-8", errors="replace")
        text, n = rewrite_links(text, src_rel, mapping)
        links += n
        title = TITLE_OVERRIDES.get(src_rel) or note_title(text, dest.stem)
        dest.write_text(upsert_frontmatter(text, title, dest_rel.parts[0], src_rel, synced),
                        encoding="utf-8")

    write_mocs(mapping, synced, skipped)
    (VAULT / SENTINEL).write_text(
        f"synced={synced}\nnotes={len(mapping)}\nlinks_rewritten={links}\n", encoding="utf-8")

    print(f"wrote {len(mapping)} notes, rewrote {links} links -> {VAULT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
