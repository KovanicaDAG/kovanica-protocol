#!/usr/bin/env bash
# Kovanica Protocol — Gentoo Installer
#
# For Gentoo users who want to build from source with full control.
# Uses an overlay-style approach with an ebuild.

set -euo pipefail

REPO_URL="https://github.com/KovanicaDAG/kovanica-protocol"
BINARY="kovanica-node"
DATA_DIR="${KOVANICA_DATA:-/var/lib/kovanica}"

info()  { echo -e "\033[0;34m[info]\033[0m  $*"; }
ok()    { echo -e "\033[0;32m[ok]\033[0m    $*"; }
die()   { echo -e "\033[0;31m[error]\033[0m $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root"

info "Kovanica Protocol Installer (Gentoo)"

# Ensure required system packages
emerge --ask=n dev-vcs/git dev-lang/rust dev-libs/openssl sys-libs/zlib

# Clone and build
srcdir=$(mktemp -d)
git clone --depth 1 "${REPO_URL}.git" "${srcdir}/kovanica"
cd "${srcdir}/kovanica"

# Generate a minimal ebuild
mkdir -p "/usr/local/portage/kovanica-node"
cat > "/usr/local/portage/kovanica-node/kovanica-node-0.2.0.ebuild" <<'EBUILD'
EAPI=8
DESCRIPTION="Kovanica BlockDAG node — GHOSTDAG consensus"
HOMEPAGE="https://kovanica.online"
SRC_URI=""
LICENSE="MIT Apache-2.0"
SLOT="0"
KEYWORDS="~amd64 ~arm64"
DEPEND="dev-lang/rust"
RDEPEND=""

src_compile() {
    cargo build --release -p kovanica-node || die
}

src_install() {
    dobin target/release/kovanica-node
}
EBUILD

cd /usr/local/portage/kovanica-node
ebuild kovanica-node-0.2.0.ebuild manifest 2>/dev/null || true
ebuild kovanica-node-0.2.0.ebuild install 2>/dev/null \
    || (cd "${srcdir}/kovanica" && cargo build --release -p kovanica-node \
        && cp target/release/$BINARY /usr/local/bin/)

rm -rf "${srcdir}"

# Setup
mkdir -p "$DATA_DIR"
if ! id -u kovanica >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin kovanica
fi
chown kovanica:kovanica "$DATA_DIR"

ok "Kovanica node installed"
echo "  ${BINARY} serve"
