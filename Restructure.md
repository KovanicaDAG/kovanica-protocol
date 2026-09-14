KOVANICA — Kompletan Restructure + Versioning Paket

1. Finalna Repo Struktura
/root/kovanica/
├── kovanica-protocol/       # interni monorepo — izvor istine (dag/state/node/cli/ffi)
├── kovanica-node/            # JAVNI release repo (github.com/KovanicaDAG/kovanica-node) — NE spajati s protocol
├── kovanica-wallet/          # android/ ios/ shared/ extension/
├── kovanica-web/              # site/ deploy/
├── kovanica-mobile/            # android/ ios/
├── kovanica-agent/              # RAG servis (Python), zaseban repo, bez izmjena
├── kovanica-installer/          # installer scripts, zaseban repo, bez izmjena
└── kovanica-data/                # runtime data, BEZ gita
2. Master skripta za agenta (restructure.sh)
#!/usr/bin/env bash
set -euo pipefail

HOME_DIR=/root
SRC="$HOME_DIR/kovanica-protocol"
DST="$HOME_DIR/kovanica"

mkdir -p "$DST"
command -v git-filter-repo >/dev/null || { echo "FATAL: pip install git-filter-repo --break-system-packages"; exit 1; }

# ---------- 1. Standalone repos: plain mv, git history + remote netaknuti ----------
for repo in kovanica-node kovanica-agent kovanica-installer; do
  if [ -d "$HOME_DIR/$repo" ]; then
    echo "== mv $repo (standalone, remote-preserved) =="
    mv "$HOME_DIR/$repo" "$DST/$repo"
  fi
done

[ -d "$HOME_DIR/kovanica-data" ] && mv "$HOME_DIR/kovanica-data" "$DST/kovanica-data"

# ~/kovanica-web (stale .output backup, no git) -> archive, don't merge into layout
if [ -d "$HOME_DIR/kovanica-web" ]; then
  echo "== archiving stale ~/kovanica-web (.output only, no git) =="
  tar -czf "$HOME_DIR/kovanica-web-output-backup-$(date +%Y%m%d).tar.gz" -C "$HOME_DIR" kovanica-web
  rm -rf "$HOME_DIR/kovanica-web"
fi

# ---------- 2. Split kovanica-wallet (protocol/kovanica-wallet + wallet-extension) ----------
echo "== Splitting kovanica-wallet =="
rm -rf "$DST/kovanica-wallet"
git clone "$SRC" "$DST/kovanica-wallet"
cd "$DST/kovanica-wallet"
git filter-repo --path kovanica-wallet --path wallet-extension
mkdir -p extension
[ -d wallet-extension ] && git mv wallet-extension/* extension/ 2>/dev/null || true
[ -f wallet-extension/.gitignore ] && git mv wallet-extension/.gitignore extension/.gitignore 2>/dev/null || true
rmdir wallet-extension 2>/dev/null || true
if [ -d kovanica-wallet ]; then
  git mv kovanica-wallet/android . 2>/dev/null || true
  git mv kovanica-wallet/ios . 2>/dev/null || true
  git mv kovanica-wallet/shared . 2>/dev/null || true
  rmdir kovanica-wallet 2>/dev/null || true
fi
git add -A && git commit -m "restructure: merge wallet-extension into extension/" || true
cd - >/dev/null

# ---------- 3. Split kovanica-web (protocol/web + web-deploy) ----------
echo "== Splitting kovanica-web =="
rm -rf "$DST/kovanica-web"
git clone "$SRC" "$DST/kovanica-web"
cd "$DST/kovanica-web"
git filter-repo --path web --path web-deploy
mkdir -p site deploy
[ -d web ] && git mv web/* site/ 2>/dev/null || true
for f in .github .gitignore .prettierrc .tanstack .vercel; do
  [ -e "web/$f" ] && git mv "web/$f" "site/$f" 2>/dev/null || true
done
rmdir web 2>/dev/null || true
[ -d web-deploy ] && git mv web-deploy/* deploy/ 2>/dev/null || true
rmdir web-deploy 2>/dev/null || true
git add -A && git commit -m "restructure: merge web + web-deploy into site/ + deploy/" || true
cd - >/dev/null

# ---------- 4. Split kovanica-mobile (protocol/android-light-node) ----------
echo "== Splitting kovanica-mobile =="
rm -rf "$DST/kovanica-mobile"
git clone "$SRC" "$DST/kovanica-mobile"
cd "$DST/kovanica-mobile"
git filter-repo --path android-light-node
mkdir -p android
git mv android-light-node/* android/ 2>/dev/null || true
[ -d android-light-node/.kotlin ] && git mv android-light-node/.kotlin android/.kotlin 2>/dev/null || true
rmdir android-light-node 2>/dev/null || true
mkdir -p ios && touch ios/.gitkeep
git add -A && git commit -m "restructure: android-light-node -> android/, add ios placeholder" || true
cd - >/dev/null

# ---------- 5. kovanica-protocol sam (mv, cleanup sub-dirova napravljenih splitom) ----------
echo "== mv kovanica-protocol =="
mv "$SRC" "$DST/kovanica-protocol"
cd "$DST/kovanica-protocol"
git rm -r --cached kovanica-wallet wallet-extension web web-deploy android-light-node 2>/dev/null || true
rm -rf kovanica-wallet wallet-extension web web-deploy android-light-node
git add -A && git commit -m "restructure: remove split-out dirs (now in sibling repos)" || true
cd - >/dev/null

echo "== DONE. Layout: =="
ls -la "$DST"
3. .gitignore po repou
kovanica-wallet/.gitignore
android/.gradle/
android/build/
android/*/build/
android/local.properties
android/.idea/
android/*.iml
android/captures/
android/.cxx/
ios/build/
ios/DerivedData/
ios/*.xcworkspace/xcuserdata/
ios/Pods/
ios/*.xcuserstate
extension/node_modules/
extension/dist/
extension/.env
extension/.env.local
.DS_Store
*.log
kovanica-web/.gitignore
site/node_modules/
site/.output/
site/.vercel/
site/.tanstack/
site/dist/
site/.env
site/.env.local
deploy/.output/
deploy/node_modules/
.DS_Store
*.log
kovanica-mobile/.gitignore
android/.gradle/
android/build/
android/*/build/
android/local.properties
android/.idea/
android/*.iml
android/captures/
android/.cxx/
android/.kotlin/
ios/build/
ios/DerivedData/
ios/Pods/
.DS_Store
*.log
(kovanica-protocol, kovanica-node, kovanica-agent, kovanica-installer već imaju svoje .gitignore — ne diraj)
4. README.md po repou
kovanica-wallet/README.md
# kovanica-wallet
Kovanica wallet — mobile apps + browser extension.

## Structure
- android/ — Android wallet app (Kotlin)
- ios/ — iOS wallet app (Swift)
- shared/ — Shared logic across platforms
- extension/ — Browser extension (Vite + TypeScript)

## Development
cd android && ./gradlew build
cd ios && xcodebuild -scheme KovanicaWallet
cd extension && npm install && npm run dev

## Related repos
kovanica-protocol · kovanica-web · kovanica-mobile

## License
MIT OR Apache-2.0
kovanica-web/README.md
# kovanica-web
Kovanica web app (site) + deploy config.

## Structure
- site/ — Vite + TanStack web app
- deploy/ — Deploy config/output

## Development
cd site && npm install && npm run dev

## Related repos
kovanica-protocol · kovanica-wallet · kovanica-mobile

## License
MIT OR Apache-2.0
kovanica-mobile/README.md
# kovanica-mobile
Kovanica light node mobile clients (Android + future iOS).
Distinct from kovanica-wallet — this is the light node client, not the wallet.

## Structure
- android/ — Android light node client (Kotlin)
- ios/ — iOS light node client (planned)

## Development
cd android && ./gradlew build

## Related repos
kovanica-protocol · kovanica-wallet · kovanica-web

## License
MIT OR Apache-2.0
~/kovanica/README.md (root meta, nije git repo)
# kovanica
Meta-directory — Kovanica DAG protocol ecosystem. Not a git repo itself;
each subdirectory is its own independent git repository.

| Repo | Purpose | Remote |
|---|---|---|
| kovanica-protocol | Internal monorepo — core dag/state/node/cli/ffi, source of truth | KovanicaDAG/kovanica-protocol |
| kovanica-node | Public release snapshot for third-party operators | KovanicaDAG/kovanica-node |
| kovanica-wallet | Wallet apps + browser extension | (init below) |
| kovanica-web | Web app + deploy | (init below) |
| kovanica-mobile | Light node mobile clients | (init below) |
| kovanica-agent | RAG agent service (Python) | existing |
| kovanica-installer | Installer scripts | existing |
| kovanica-data | Runtime data, not versioned | — |

## Release flow
kovanica-node is periodically synced from kovanica-protocol's crates when a
new version is tagged for public release. NOT auto-synced — diff before push.
5. Init git za nove repoe + prvi commit (nakon restructure.sh)
#!/usr/bin/env bash
set -euo pipefail
cd /root/kovanica

# kovanica-wallet, kovanica-web, kovanica-mobile već imaju .git iz filter-repo koraka
# (git remote još nije postavljen — postavi ga ako/kad kreiraš GitHub repoe)

for repo in kovanica-wallet kovanica-web kovanica-mobile; do
  echo "== $repo status =="
  cd "/root/kovanica/$repo"
  git log --oneline -5
  git status --short
  cd - >/dev/null
done

# Primjer dodavanja remote-a kad kreiraš GitHub repo (ručno, po jednom):
# cd /root/kovanica/kovanica-wallet
# git remote add origin git@github.com:KovanicaDAG/kovanica-wallet.git
# git push -u origin main
6. Tag prvi versioned checkpoint na svim repoima
#!/usr/bin/env bash
set -euo pipefail
for repo in kovanica-protocol kovanica-wallet kovanica-web kovanica-mobile kovanica-agent kovanica-installer; do
  d="/root/kovanica/$repo"
  [ -d "$d/.git" ] || continue
  cd "$d"
  git tag -a "v0.1.0-restructure" -m "First versioned checkpoint after multi-repo restructure"
  echo "tagged $repo"
  cd - >/dev/null
done

Redoslijed izvršavanja za agenta:
	1.	restructure.sh — radi cijeli split + mv
	2.	Ručno pregledaj ls -la /root/kovanica/* i sadržaj svakog repoa
	3.	Dodaj .gitignore + README.md fileove iz sekcije 3–4 u odgovarajuće repoe
	4.	init-check.sh (sekcija 5) — provjeri statuse
	5.	tag-checkpoint.sh (sekcija 6) — tag v0.1.0-restructure svugdje
	6.	Tek onda otvori GitHub repoe i pushaj

kovanica-node ne tagiraj -već ima svoj tag-sustav
