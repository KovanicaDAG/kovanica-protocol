# Kovanica Protocol — Reproducible Builds

**Status**: Draft (P2.2)  
**Goal**: Third party can rebuild release binary from tagged commit and get identical SHA256.

---

## 1. Toolchain Versions (Pinned)

### Rust Toolchain
```toml
# rust-toolchain.toml (workspace root)
[toolchain]
channel = "1.82.0"          # Exact version, not "stable"
components = ["rustc", "cargo", "rustfmt", "clippy"]
targets = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"]
profile = "minimal"
```

### Node.js (for web/frontend if needed)
```json
// .nvmrc or package.json engines
{
  "engines": {
    "node": "22.12.0",
    "npm": "10.9.0"
  }
}
```

### Cargo Lockfile
- `Cargo.lock` **committed to git** (workspace resolver v2)
- All dependencies pinned to exact versions
- No `*` or wildcard versions in `Cargo.toml`

---

## 2. Build Environment

### Required Environment Variables
```bash
# Deterministic build env
export CARGO_INCREMENTAL=0
export RUSTFLAGS="-C target-cpu=native -C opt-level=3 -C panic=abort -C codegen-units=1"
export RUSTDOCFLAGS="-C target-cpu=native"
export SOURCE_DATE_EPOCH=1704067200  # Fixed timestamp (2024-01-01 00:00:00 UTC)
```

### Build Command
```bash
# From workspace root
cargo build --release --workspace --locked --target x86_64-unknown-linux-gnu
```

### Output Binaries
```
target/x86_64-unknown-linux-gnu/release/
├── kovanica-node          # Main node binary
├── kovanica-cli           # CLI tool
└── kovanica-ffi           # FFI cdylib (for mobile)
```

---

## 3. CI Verification Pipeline

### GitHub Actions Workflow (`.github/workflows/reproducible-build.yml`)

```yaml
name: Reproducible Build Verification

on:
  push:
    tags:
      - 'v*'  # Only on version tags

jobs:
  reproducible-build:
    name: Verify Reproducible Build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout tag
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: 1.82.0
          targets: x86_64-unknown-linux-gnu
          components: rustc, cargo, rustfmt, clippy

      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
        with:
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}

      - name: Set deterministic env
        run: |
          echo "CARGO_INCREMENTAL=0" >> $GITHUB_ENV
          echo "RUSTFLAGS=-C target-cpu=native -C opt-level=3 -C panic=abort -C codegen-units=1" >> $GITHUB_ENV
          echo "SOURCE_DATE_EPOCH=1704067200" >> $GITHUB_ENV

      - name: Build release
        run: cargo build --release --workspace --locked --target x86_64-unknown-linux-gnu

      - name: Compute hashes
        id: hashes
        run: |
          cd target/x86_64-unknown-linux-gnu/release
          sha256sum kovanica-node kovanica-cli kovanica-ffi > SHA256SUMS
          cat SHA256SUMS

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-binaries
          path: |
            target/x86_64-unknown-linux-gnu/release/kovanica-node
            target/x86_64-unknown-linux-gnu/release/kovanica-cli
            target/x86_64-unknown-linux-gnu/release/kovanica-ffi
            target/x86_64-unknown-linux-gnu/release/SHA256SUMS

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            target/x86_64-unknown-linux-gnu/release/kovanica-node
            target/x86_64-unknown-linux-gnu/release/kovanica-cli
            target/x86_64-unknown-linux-gnu/release/kovanica-ffi
            target/x86_64-unknown-linux-gnu/release/SHA256SUMS
          generate_release_notes: true
```

---

## 4. Verification Procedure (Third Party)

### Prerequisites
- Ubuntu 22.04+ or compatible Linux
- Rust 1.82.0 (via `rustup install 1.82.0`)
- Git

### Steps
```bash
# 1. Clone at exact tag
git clone https://github.com/KovanicaDAG/kovanica-protocol.git
cd kovanica-protocol
git checkout v0.2.0  # Example tag

# 2. Install pinned toolchain
rustup install 1.82.0
rustup default 1.82.0
rustup target add x86_64-unknown-linux-gnu

# 3. Set deterministic environment
export CARGO_INCREMENTAL=0
export RUSTFLAGS="-C target-cpu=native -C opt-level=3 -C panic=abort -C codegen-units=1"
export SOURCE_DATE_EPOCH=1704067200

# 4. Build
cargo build --release --workspace --locked --target x86_64-unknown-linux-gnu

# 5. Verify hashes match release
cd target/x86_64-unknown-linux-gnu/release
sha256sum -c SHA256SUMS  # From GitHub Release assets
```

### Expected Output
```
kovanica-node: OK
kovanica-cli: OK
kovanica-ffi: OK
```

---

## 5. Known Non-Determinism Sources (Mitigated)

| Source | Mitigation |
|--------|------------|
| Incremental compilation | `CARGO_INCREMENTAL=0` |
| Debug info / file paths | `SOURCE_DATE_EPOCH` fixed, `-C panic=abort` |
| Codegen units | `-C codegen-units=1` |
| Target CPU detection | `-C target-cpu=native` (documented; rebuild on same arch) |
| Timestamps in binary | `SOURCE_DATE_EPOCH` + `panic=abort` strips most |
| HashMap iteration | Not in consensus-critical paths (deterministic by design) |

---

## 6. Cross-Compilation (Future)

| Target | Status |
|--------|--------|
| `x86_64-unknown-linux-gnu` | ✅ Primary |
| `aarch64-unknown-linux-gnu` | Planned (ARM64 servers) |
| `x86_64-pc-windows-msvc` | Not planned |
| `aarch64-apple-darwin` | Not planned (mobile uses FFI) |

---

## 7. Release Checklist

- [ ] Tag follows semver: `v<major>.<minor>.<patch>`
- [ ] `Cargo.lock` committed
- [ ] `rust-toolchain.toml` present
- [ ] CI workflow passes on tag push
- [ ] GitHub Release created with binaries + `SHA256SUMS`
- [ ] Release notes link to this doc for verification

---

*Related: [AUDIT-PLAN.md](./AUDIT-PLAN.md) · [LEGIT-BOARD.md](./LEGIT-BOARD.md)*