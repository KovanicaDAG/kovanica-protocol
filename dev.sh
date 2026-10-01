#!/usr/bin/env sh
# kovanica — multi-repo workspace bootstrap.
#
# Run from the kovanica meta-repo root on any device. It:
#   1. clones / pulls every independent Kovanica repo
#   2. provisions toolchains (Rust, Node, Android, Docker detect)
#   3. installs per-repo deps and machine-local env
#   4. prints a doctor report (repo state, tool versions, ready commands)
#
# Every repo pulls automatically. Repos with a dirty tree are reported,
# never reset. Missing tools are skipped, never fatal.
#
# Usage:
#   ./dev.sh            full bootstrap (reconcile + toolchains + deps + doctor)
#   ./dev.sh --status   reconcile + doctor only (no toolchain/deps work)
#   ./dev.sh --skip-deps    same as --status
#   ./dev.sh --quiet    suppress per-step notes
#
# Env overrides:
#   KOVANICA_BRAIN_VAULT_URL   remote for kovanica-brain-vault (default GitHub)

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"

LOG="${DEV_LOG:-$ROOT/.dev.log}"
QUIET=0
DO_DEPS=1

for arg in "$@"; do
    case "$arg" in
        --status|--skip-deps) DO_DEPS=0 ;;
        --quiet|-q) QUIET=1 ;;
        --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
        *) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
    esac
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '[%s] %s\n' "$(date +%FT%T)" "$*" >>"$LOG"; }
note() { log "$*"; if [ "$QUIET" -eq 0 ]; then printf '  %s\n' "$*"; fi; }
warn() { log "WARN: $*"; printf '  WARN: %s\n' "$*" >&2; }
headline() { printf '\n== %s ==\n' "$*"; }

# Component dirs are tracked by the monorepo itself (old separate repos
# were consolidated and deleted). No per-component git sync anymore.
component_dirs() {
    printf '%s\n' protocol node web wallet mobile cli installer ledger-app data
}

# agent + brain-vault live OUTSIDE the workspace (separate repos):
#   ~/kovanica-agent        (git repo, origin/main)
#   ~/kovanica-brain-vault  (docs vault, not versioned here)

# ---------------------------------------------------------------- reconcile

# Components are tracked by the monorepo working tree — there is nothing
# to pull per-directory. We only report their state relative to HEAD.
sync_component() {
    name="$1"

    if [ -d "$name/.git" ]; then
        warn "$name: stale embedded git repo — remove $name/.git to track via monorepo"
        echo "$name	-	embedded	-	-	-" >>"$WORK/repos.txt"
        return 0
    fi

    if [ ! -d "$name" ]; then
        warn "$name: missing from workspace"
        echo "$name	-	miss	-	-	-" >>"$WORK/repos.txt"
        return 0
    fi

    if git ls-files --error-unmatch "$name" >/dev/null 2>&1; then
        changed="$(git status --porcelain -- "$name" 2>/dev/null | wc -l | tr -d ' ')"
        if [ "${changed:-0}" -eq 0 ]; then
            note "$name: clean (tracked by monorepo @ $(git rev-parse --short HEAD))"
            echo "$name	monorepo	clean	-	-	$(git rev-parse --short HEAD)" >>"$WORK/repos.txt"
        else
            warn "$name: $changed changed file(s) vs monorepo index"
            echo "$name	monorepo	dirty	-	-	$(git rev-parse --short HEAD)" >>"$WORK/repos.txt"
        fi
    else
        note "$name: untracked plain dir (runtime/unversioned)"
        echo "$name	-	plain	-	-	-" >>"$WORK/repos.txt"
    fi
}

ensure_data() {
    if [ ! -d data ]; then
        mkdir -p data
        printf '%s\n' "# data" "" "Runtime data for the Kovanica ecosystem (not versioned)." >data/README.md
        note "data: created (runtime data, unversioned)"
    elif [ ! -f data/README.md ]; then
        printf '%s\n' "# data" "" "Runtime data for the Kovanica ecosystem (not versioned)." >data/README.md
    fi
}

# --------------------------------------------------------------- toolchains

CARGO_OK=unset
NODE_OK=unset
ANDROID_SDK=unset
DOCKER_OK=unset
PYTHON_OK=unset
JAVA_OK=unset

ensure_rust() {
    if [ "$CARGO_OK" != unset ]; then return 0; fi
    if command -v cargo >/dev/null 2>&1; then
        CARGO_OK=yes
        note "cargo: $(cargo --version 2>/dev/null)"
        if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
            warn "no C compiler (cc/gcc/clang) found — cargo build-scripts and linking will fail. Linux: install build-essential; macOS: xcode-select --install"
        fi
        if command -v rustup >/dev/null 2>&1; then
            pin=
            if [ -f "$ROOT/protocol/rust-toolchain.toml" ]; then
                pin="$(sed -n 's/^channel = "\(.*\)"/\1/p' "$ROOT/protocol/rust-toolchain.toml")"
            fi
            if [ -n "$pin" ] && ! rustup toolchain list | grep -q "^$pin"; then
                note "rust: installing pinned toolchain $pin (rustfmt, clippy)"
                rustup toolchain install "$pin" --profile minimal --component rustfmt,clippy
            fi
        else
            warn "rustup not found — relying on system toolchain"
        fi
    else
        CARGO_OK=skip
        warn "cargo not found — protocol/node build & check skipped (install via rustup.rs)"
    fi
}

ensure_node() {
    if [ "$NODE_OK" != unset ]; then return 0; fi
    if command -v node >/dev/null 2>&1; then
        maj="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
        if [ "${maj:-0}" -ge 20 ]; then
            NODE_OK=yes
            note "node: $(node -v) ($(command -v node))"
            return 0
        fi
        warn "node: v$(node -v) too old (>=20 required for web)"
    fi

    nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if [ -f "$nvm_sh" ]; then
        bin_dir="$(bash -c '. "$1" >/dev/null 2>&1 && nvm install 22 >/dev/null 2>&1 && nvm which 22' _ "$nvm_sh" 2>/dev/null || true)"
        if [ -n "$bin_dir" ]; then
            export PATH="$(dirname "$bin_dir"):$PATH"
            NODE_OK=yes
            note "node: $(node -v) via nvm"
            return 0
        fi
        warn "nvm present but could not provision node 22"
    fi
    NODE_OK=skip
    warn "node >= 20 not available — web/wallet deps skipped"
}

ensure_android() {
    if command -v sdkmanager >/dev/null 2>&1; then
        if ! command -v java >/dev/null 2>&1 && [ -z "${JAVA_HOME:-}" ]; then
            ANDROID_SDK=needs-java
            warn "android: SDK present but no java/JAVA_HOME — package install skipped (install JDK 17 first)"
            return 0
        fi
        note "android: installing SDK/NDK packages (android-36, build-tools 36, ndk 27)"
        yes | sdkmanager --licenses >/dev/null 2>&1 || true
        if sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.0.12077973" >/dev/null 2>&1; then
            ANDROID_SDK=present
        else
            ANDROID_SDK=partial
            warn "android: SDK/NDK package install failed — check sdkmanager licenses & network"
        fi
        if command -v cargo >/dev/null 2>&1 && ! command -v cargo-ndk >/dev/null 2>&1; then
            note "android: installing cargo-ndk"
            cargo install cargo-ndk --locked >/dev/null 2>&1 || warn "android: cargo-ndk install failed"
        fi
    else
        ANDROID_SDK=skip
        warn "android: sdkmanager not found — mobile/wallet android builds skipped"
    fi
}

probe_procs() {
    if command -v docker >/dev/null 2>&1; then DOCKER_OK=yes; else DOCKER_OK=skip; warn "docker not found — kovanica-agent stack (compose) requires it"; fi
    if command -v python3 >/dev/null 2>&1; then PYTHON_OK=yes; else PYTHON_OK=skip; warn "python3 not found — kovanica-agent venv skipped"; fi
    if command -v java >/dev/null 2>&1; then JAVA_OK=yes; else JAVA_OK=skip; fi
}

# --------------------------------------------------------------------- deps

cargo_check() {
    if [ "$DO_DEPS" -eq 0 ]; then return 0; fi
    ensure_rust
    dir="$1"
    shift
    if [ "$CARGO_OK" = skip ]; then warn "skip cargo check in $dir (no cargo)"; return 0; fi
    note "cargo check: $dir $*"
    if ! (cd "$ROOT/$dir" && cargo check "$@" --locked) >/dev/null 2>&1; then
        warn "$dir: cargo check failed — run manually: cd $dir && cargo check $* --locked"
    fi
}

npm_deps() {
    if [ "$DO_DEPS" -eq 0 ]; then return 0; fi
    ensure_node
    if [ "$NODE_OK" = skip ]; then return 0; fi
    dir="$1"; sub="$2"
    [ -d "$ROOT/$dir/$sub" ] || { warn "$dir/$sub: missing"; return 0; }
    if [ ! -d "$ROOT/$dir/$sub/node_modules" ]; then
        note "npm install: $dir/$sub"
        if ! (cd "$ROOT/$dir/$sub" && npm ci --no-fund --no-audit) >/dev/null 2>&1; then
            warn "$dir/$sub: npm ci failed — falling back to npm install"
            (cd "$ROOT/$dir/$sub" && npm install --no-fund --no-audit) >/dev/null 2>&1 \
                || warn "$dir/$sub: npm install failed"
        fi
    else
        note "$dir/$sub: node_modules present"
    fi
}

setup_agent() {
    if [ "$DO_DEPS" -eq 0 ]; then return 0; fi
    d="$HOME/kovanica-agent"
    [ -d "$d" ] || { warn "kovanica-agent missing"; return 0; }

    if [ "$PYTHON_OK" = yes ] && [ ! -d "$d/venv" ]; then
        note "agent: creating python venv"
        python3 -m venv "$d/venv" || warn "agent: venv creation failed"
    fi
    if [ -x "$d/venv/bin/pip" ] && [ -f "$d/agent/requirements.txt" ]; then
        if ! "$d/venv/bin/pip" install -q -r "$d/agent/requirements.txt" >/dev/null 2>&1; then
            warn "agent: pip install of agent/requirements.txt failed"
        else
            note "agent: python deps installed"
        fi
    fi

    if [ ! -f "$d/.env" ] && [ -f "$d/.env.example" ]; then
        cp "$d/.env.example" "$d/.env"
        note "agent: created .env from .env.example"
    fi
    if [ -f "$d/.env" ] && ! grep -q '^AUTH_DEV_TOKEN=.\+' "$d/.env"; then
        tok="$(openssl rand -hex 24 2>/dev/null || true)"
        if [ -n "$tok" ]; then
            tmp="$(mktemp)"
            awk -v t="$tok" 'BEGIN{FS=OFS="="} /^AUTH_DEV_TOKEN=/{print "AUTH_DEV_TOKEN=" t; next} {print}' "$d/.env" >"$tmp" \
                && mv "$tmp" "$d/.env"
            warn "agent: generated new AUTH_DEV_TOKEN — keep it safe, it grants the dev role"
        fi
    fi

    if [ -f "$d/kovanica" ]; then
        first="$(head -n 1 "$d/kovanica" 2>/dev/null || true)"
        case "$first" in
            '#!/'*)
                tgt="$(printf '%s' "$first" | cut -c3-)"
                if [ ! -x "$tgt" ] && [ ! -f "$d/kovanica.local" ]; then
                    tmp="$(mktemp)"
                    { printf '#!%s\n' "$d/venv/bin/python3"; tail -n +2 "$d/kovanica"; } >"$tmp" \
                        && mv "$tmp" "$d/kovanica.local" \
                        && chmod +x "$d/kovanica.local"
                    note "agent: wrote portable launcher kovanica.local (tracked ./kovanica has a VPS-specific shebang)"
                fi
                ;;
        esac
    fi
}

gradle_warm() {
    if [ "$DO_DEPS" -eq 0 ]; then return 0; fi
    if [ "$JAVA_OK" != yes ]; then return 0; fi
    for d in "$ROOT/wallet/android" "$ROOT/mobile/android"; do
        if [ -x "$d/gradlew" ]; then
            (cd "$d" && ./gradlew --version >/dev/null 2>&1) \
                && note "gradle: warmed $d" \
                || warn "gradle warm-up failed in $d"
        fi
    done
}

check_vault_drift() {
    a="$HOME/kovanica-brain-vault"
    b="$HOME/kovanica-agent/kovanica-brain-vault"
    if [ -d "$a" ] && [ -d "$b" ]; then
        diffs="$(diff -rq "$a" "$b" 2>/dev/null | wc -l | tr -d ' ')"
        if [ -n "${diffs:-}" ] && [ "$diffs" -gt 0 ]; then
            warn "brain-vault drift: top-level vault differs from agent-shipped copy (${diffs} diff lines) — agent repo owns its copy; sync when intended"
        fi
    fi
}

meta_hygiene() {
    for name in $(component_dirs); do
        if [ -d "$name/.git" ]; then
            warn "$name: stale embedded git repo (see Reconcile above)"
        fi
    done
    if git ls-files -s 2>/dev/null | grep -q ':160000'; then
        warn "monorepo records gitlinks (mode 160000) instead of tracked trees — run: git rm --cached -r <subrepo>"
    fi
}

# ------------------------------------------------------------------ doctor

doctor() {
    headline "Repos"
    if [ -f "$WORK/repos.txt" ]; then
        printf '  %-22s %-8s %-7s %6s %6s  %s\n' NAME BRANCH STATE AHEAD BEHIND HEAD
        while IFS='	' read -r name br state ahead behind head; do
            printf '  %-22s %-8s %-7s %6s %6s  %s\n' \
                "$name" "$br" "$state" "${ahead:-0}" "${behind:-0}" "${head:--}"
        done <"$WORK/repos.txt"
    fi
    if [ -d data ]; then printf '  %-22s (runtime data, unversioned)\n' data; fi

    headline "Toolchain"
    probe() {
        name="$1"; shift
        if command -v "$name" >/dev/null 2>&1; then
            printf '  %-12s %s\n' "$name" "$("$@")"
        else
            printf '  %-12s %s\n' "$name" "missing"
        fi
    }
    probe cargo cargo --version
    if command -v rustup >/dev/null 2>&1; then
        printf '  %-12s %s\n' rustup "$(rustup toolchain list 2>/dev/null | awk '/\(active/ {print $1; exit}')"
    else
        printf '  %-12s %s\n' rustup "n/a (rust via $(command -v cargo))"
    fi
    probe node node -v
    probe python3 python3 --version
    probe docker docker --version
    if command -v java >/dev/null 2>&1; then
        printf '  %-12s %s\n' java "$(java -version 2>&1 | head -n 1)"
    else
        printf '  %-12s %s\n' java missing
    fi
    case "$ANDROID_SDK" in
        present) a="SDK ready (android-36 / ndk 27)" ;;
        partial) a="SDK present — package install incomplete" ;;
        needs-java) a="SDK present — install JDK 17 first" ;;
        *) a="skipped (no sdkmanager)" ;;
    esac
    printf '  %-12s %s\n' android "$a"

    headline "Deps"
    if [ -d protocol/target ]; then
        printf '  %-22s target/ built\n' protocol
    else
        printf '  %-22s target/ not built (first cargo check builds it)\n' protocol
    fi
    [ -d node/target ] && printf '  %-22s target/ built\n' node || \
        printf '  %-22s target/ not built\n' node
    [ -d web/site/node_modules ] && printf '  %-22s node_modules/\n' web/site || \
        printf '  %-22s not installed (npm ci)\n' web/site
    [ -d wallet/extension/node_modules ] && printf '  %-22s node_modules/\n' wallet/extension || \
        printf '  %-22s not installed (npm ci)\n' wallet/extension
    [ -x "$HOME/kovanica-agent/venv/bin/python" ] && printf '  %-22s venv/\n' agent || \
        printf '  %-22s no venv yet\n' agent

    headline "Run"
    cat <<RUN
  web dev (all interfaces):   cd web/site && npm run dev          -> http://localhost:8080
  web dev (local only):       npx vite dev --host 127.0.0.1 --port 8080
  node (solo, cargo):         cd node && KOVANICA_POW=1 KOVANICA_MINE=0 KOVANICA_DATA=\$PWD/data \\
                              cargo run --release -p kovanica-node -- explorer 127.0.0.1:8080
  node (public testnet):      see node/README.md (KOVANICA_PEERS=seed.kovanica.online:9000,seed2.kovanica.online:9000)
  agent REPL:                 (cd ~/kovanica-agent && ./kovanica.local repl)   # portable launcher written by this script
  agent stack (needs docker): docker compose -f ~/kovanica-agent/docker-compose.yml up -d qdrant vllm sandbox-runner agent-api
  wallet extension:           cd wallet/extension && npm run dev
RUN
}

# ------------------------------------------------------------------- main

headline "Reconcile"
for name in $(component_dirs); do
    sync_component "$name"
done
ensure_data

headline "Toolchains & deps"
probe_procs
ensure_rust
ensure_node
ensure_android
gradle_warm
check_vault_drift

if [ "$DO_DEPS" -eq 1 ]; then
    cargo_check protocol --workspace
    cargo_check node -p kovanica-node
    npm_deps web site
    npm_deps wallet extension
    setup_agent
else
    note "deps step skipped (--status)"
fi

meta_hygiene
doctor
log "done"