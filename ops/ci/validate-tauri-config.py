#!/usr/bin/env python3
"""Validate every Tauri desktop app configuration in the repo.

Tauri validates `tauri.conf.json` when it builds an app, but only for the app
being built. `apps/console-enterprise` and `apps/desktop-node` are not built by
any CI job, so a config defect there is invisible until someone tries to ship.
This gate closes that gap. It checks, for each config:

  1. **Schema validity**, against the JSON Schema the pinned Tauri CLI ships
     (`schema.json` for v1, `config.schema.json` for v2).
  2. **`http.scope` URL parseability.** Tauri v1 deserialises each entry of
     `tauri.allowlist.http.scope` with `url::Url`, so a wildcard port such as
     `http://localhost:**` is a hard build error that the JSON Schema does not
     describe (the schema types it as a plain string).
  3. **Referenced paths exist**, resolved relative to the config's directory
     (`tauri.bundle.*` for v1, `bundle.*` for v2): `bundle.icon[]`,
     `bundle.windows.nsis.*` images/license, and `bundle.macOS.entitlements`.

Exits 0 when every config passes, 1 otherwise. A config whose schema version
does not match any available local schema is reported as *skipped*, not failed
— the gate must not pretend to have checked something it did not.

Usage:
    python3 ops/ci/validate-tauri-config.py [CONFIG ...]

With no arguments it discovers every `apps/*/src-tauri/tauri.conf.json` and
`apps/*/tauri.conf.json`. Requires the root `npm ci` (for the CLI schema) and
`python3-jsonschema`.
"""

from __future__ import annotations

import glob
import json
import os
import sys
import urllib.parse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_GLOBS = (
    "apps/*/src-tauri/tauri.conf.json",
    "apps/*/tauri.conf.json",
)

# Candidate locations for the CLI's bundled config schema, per Tauri major.
SCHEMA_CANDIDATES = {
    # Tauri v1 ships `schema.json`; v2 ships `config.schema.json`.
    "v1": (
        "node_modules/@tauri-apps/cli/schema.json",
        "node_modules/@tauri-apps/cli/config.schema.json",
    ),
    "v2": (
        "apps/desktop-node/ui/node_modules/@tauri-apps/cli/config.schema.json",
        "node_modules/@tauri-apps/cli/config.schema.json",
    ),
}


def schema_kind(schema: dict) -> str | None:
    """Classify a Tauri config schema as v1 or v2 by its top-level properties."""
    props = schema.get("properties", {})
    if "tauri" in props and "package" in props:
        return "v1"
    if "app" in props and "bundle" in props:
        return "v2"
    return None


def config_kind(config: dict) -> str | None:
    """Classify a config file as v1 or v2."""
    declared = str(config.get("$schema", ""))
    if "/config/1." in declared:
        return "v1"
    if "/config/2" in declared:
        return "v2"
    # Fall back to shape when $schema is absent.
    if "tauri" in config:
        return "v1"
    if "app" in config:
        return "v2"
    return None


def load_schema(kind: str) -> dict | None:
    for rel in SCHEMA_CANDIDATES.get(kind, ()):
        path = os.path.join(REPO_ROOT, rel)
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                schema = json.load(fh)
            if schema_kind(schema) == kind:
                return schema
    return None


def check_http_scope(config: dict) -> list[str]:
    """Return errors for scope entries that are not absolute, parseable URLs."""
    errors: list[str] = []
    scope = (
        config.get("tauri", {})
        .get("allowlist", {})
        .get("http", {})
        .get("scope")
    )
    if not isinstance(scope, list):
        return errors
    for i, entry in enumerate(scope):
        where = f"tauri.allowlist.http.scope[{i}]"
        if not isinstance(entry, str):
            errors.append(f"{where}: not a string ({entry!r})")
            continue
        parts = urllib.parse.urlsplit(entry)
        if parts.scheme not in ("http", "https"):
            errors.append(
                f"{where}: {entry!r} has no http/https scheme "
                "(Tauri v1 parses this field with url::Url)"
            )
            continue
        if not parts.netloc:
            errors.append(f"{where}: {entry!r} has no host")
            continue
        try:
            _ = parts.port
        except ValueError as exc:
            errors.append(
                f"{where}: {entry!r} does not parse as a URL — {exc} "
                "(a wildcard port is not expressible here in Tauri v1)"
            )
    return errors


def bundle_section(config: dict, kind: str | None) -> tuple[dict, str]:
    """Return (bundle object, json-path prefix). v1 nests it under `tauri`."""
    if kind == "v1":
        return config.get("tauri", {}).get("bundle", {}) or {}, "tauri.bundle"
    return config.get("bundle", {}) or {}, "bundle"


def referenced_paths(config: dict, kind: str | None) -> list[tuple[str, str]]:
    """Yield (json-path, relative-path) for every path the config references."""
    bundle, prefix = bundle_section(config, kind)
    out: list[tuple[str, str]] = []

    icons = bundle.get("icon")
    if isinstance(icons, list):
        for i, icon in enumerate(icons):
            if isinstance(icon, str):
                out.append((f"{prefix}.icon[{i}]", icon))

    nsis = (bundle.get("windows", {}) or {}).get("nsis", {}) or {}
    for key in ("installerIcon", "headerImage", "welcomeImage", "licenseFile"):
        value = nsis.get(key)
        if isinstance(value, str):
            out.append((f"{prefix}.windows.nsis.{key}", value))

    entitlements = (bundle.get("macOS", {}) or {}).get("entitlements")
    if isinstance(entitlements, str):
        out.append((f"{prefix}.macOS.entitlements", entitlements))

    resources = bundle.get("resources")
    if isinstance(resources, list):
        for i, res in enumerate(resources):
            if isinstance(res, str):
                out.append((f"{prefix}.resources[{i}]", res))

    return out


def check_paths(config: dict, config_dir: str, kind: str | None) -> list[str]:
    errors: list[str] = []
    for json_path, rel in referenced_paths(config, kind):
        if not os.path.exists(os.path.join(config_dir, rel)):
            errors.append(f"{json_path}: referenced path does not exist: {rel}")
    return errors


def validate_schema(config: dict, schema: dict) -> list[str]:
    try:
        import jsonschema  # noqa: PLC0415
    except ImportError:
        return ["cannot import jsonschema — install python3-jsonschema"]
    validator = jsonschema.Draft7Validator(schema)
    errors = []
    for err in sorted(validator.iter_errors(config), key=lambda e: list(e.path)):
        location = " > ".join(str(p) for p in err.path) or "<root>"
        errors.append(f"schema: {location}: {err.message}")
    return errors


def find_configs(argv: list[str]) -> list[str]:
    if argv:
        return [os.path.abspath(p) for p in argv]
    found: list[str] = []
    for pattern in DEFAULT_GLOBS:
        found.extend(glob.glob(os.path.join(REPO_ROOT, pattern)))
    return sorted(set(found))


def main(argv: list[str]) -> int:
    configs = find_configs(argv)
    if not configs:
        print("validate-tauri-config: no tauri.conf.json files found", file=sys.stderr)
        return 1

    failed = False
    for path in configs:
        rel = os.path.relpath(path, REPO_ROOT)
        print(f"=== {rel} ===")
        try:
            with open(path, encoding="utf-8") as fh:
                config = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  FAIL: cannot read/parse: {exc}")
            failed = True
            continue

        kind = config_kind(config)
        errors: list[str] = []

        schema = load_schema(kind) if kind else None
        if schema is None:
            print(
                f"  SKIP schema check: no local Tauri {kind or '?'} schema available "
                "(run `npm ci` at the repo root)"
            )
        else:
            errors.extend(validate_schema(config, schema))

        errors.extend(check_http_scope(config))
        errors.extend(check_paths(config, os.path.dirname(path), kind))

        if errors:
            failed = True
            for err in errors:
                print(f"  FAIL: {err}")
        else:
            print("  OK")

    print("---")
    print("validate-tauri-config: FAIL" if failed else "validate-tauri-config: PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
