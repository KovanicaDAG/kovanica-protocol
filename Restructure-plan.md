RESTRUCTURE-PLAN

KOVANICA — 100% Efficient Multi-Repo Restructure + Versioning
Cilj: Iz monorepo-a kovanica-protocol izvući čiste, history-preserving sibling repoe + očistiti protocol, bez gubitka historije, bez broken Cargo workspacea, s backupom i checkpoint tagom.
Finalna struktura (cilj):
/root/kovanica/
├── kovanica-protocol/     # internal monorepo (source of truth)
├── kovanica-node/         # PUBLIC release (NE spajati)
├── kovanica-wallet/       # android/ ios/ shared/ extension/
├── kovanica-web/          # site/ deploy/
├── kovanica-mobile/       # android/ ios/
├── kovanica-agent/        # (već standalone)
├── kovanica-installer/    # (već standalone)
└── kovanica-data/         # runtime, BEZ gita

0. Preduvjeti (obavezno)
# Na serveru / root okruženju
command -v git-filter-repo || pip install git-filter-repo --break-system-packages
command -v cargo >/dev/null
df -h /root   # dovoljno prostora (filter-repo radi klonove)

1. Master skripta — `restructure.sh`
Spremi kao /root/restructure.sh i pokreni s bash /root/restructure.sh.
#!/usr/bin/env bash
set -euo pipefail

HOME_DIR=/root
SRC="$HOME_DIR/kovanica-protocol"
DST="$HOME_DIR/kovanica"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$HOME_DIR/kovanica-restructure-backup-$TS"

echo "=== Kovanica Restructure — $TS ==="
echo "Backup dir: $BACKUP_DIR"

# ---------- Safety ----------
command -v git-filter-repo >/dev/null || {
  echo "FATAL: git-filter-repo missing. Run: pip install git-filter-repo --break-system-packages"
  exit 1
}
[ -d "$SRC" ] || { echo "FATAL: $SRC does not exist"; exit 1; }

mkdir -p "$DST" "$BACKUP_DIR"

echo "== 0. Full pre-restructure backup =="
tar -czf "$BACKUP_DIR/protocol-full.tar.gz" -C "$HOME_DIR" kovanica-protocol
# Brzi snapshot ostalih ako postoje
for r in kovanica-node kovanica-agent kovanica-installer kovanica-data; do
  [ -d "$HOME_DIR/$r" ] && tar -czf "$BACKUP_DIR/${r}.tar.gz" -C "$HOME_DIR" "$r" || true
done
echo "Backup complete → $BACKUP_DIR"

# ---------- 1. Standalone repos (plain mv, remote + history netaknuti) ----------
for repo in kovanica-node kovanica-agent kovanica-installer; do
  if [ -d "$HOME_DIR/$repo" ]; then
    echo "== mv $repo (standalone) =="
    mv "$HOME_DIR/$repo" "$DST/$repo"
  fi
done
[ -d "$HOME_DIR/kovanica-data" ] && mv "$HOME_DIR/kovanica-data" "$DST/kovanica-data"

# Stale kovanica-web (samo .output, bez gita)
if [ -d "$HOME_DIR/kovanica-web" ]; then
  echo "== Archiving stale ~/kovanica-web =="
  tar -czf "$BACKUP_DIR/kovanica-web-stale-$TS.tar.gz" -C "$HOME_DIR" kovanica-web
  rm -rf "$HOME_DIR/kovanica-web"
fi

# ---------- 2. kovanica-wallet ----------
echo "== Splitting kovanica-wallet =="
rm -rf "$DST/kovanica-wallet"
git clone --no-local "$SRC" "$DST/kovanica-wallet"
cd "$DST/kovanica-wallet"

git filter-repo \
  --path kovanica-wallet \
  --path wallet-extension \
  --path-rename kovanica-wallet/android:android \
  --path-rename kovanica-wallet/ios:ios \
  --path-rename kovanica-wallet/shared:shared \
  --path-rename wallet-extension:extension \
  --force

# Cleanup empty dirs
find . -type d -empty -delete 2>/dev/null || true
git add -A
git commit -m "restructure: extract wallet (android/ios/shared) + extension/" || true
cd - >/dev/null

# ---------- 3. kovanica-web ----------
echo "== Splitting kovanica-web =="
rm -rf "$DST/kovanica-web"
git clone --no-local "$SRC" "$DST/kovanica-web"
cd "$DST/kovanica-web"

git filter-repo \
  --path web \
  --path web-deploy \
  --path-rename web:site \
  --path-rename web-deploy:deploy \
  --force

find . -type d -empty -delete 2>/dev/null || true
git add -A
git commit -m "restructure: web → site/, web-deploy → deploy/" || true
cd - >/dev/null

# ---------- 4. kovanica-mobile ----------
echo "== Splitting kovanica-mobile =="
rm -rf "$DST/kovanica-mobile"
git clone --no-local "$SRC" "$DST/kovanica-mobile"
cd "$DST/kovanica-mobile"

git filter-repo \
  --path android-light-node \
  --path-rename android-light-node:android \
  --force

mkdir -p ios
touch ios/.gitkeep
git add -A
git commit -m "restructure: android-light-node → android/, ios placeholder" || true
cd - >/dev/null

# ---------- 5. kovanica-protocol move + cleanup ----------
echo "== Moving + cleaning kovanica-protocol =="
mv "$SRC" "$DST/kovanica-protocol"
cd "$DST/kovanica-protocol"

# Ukloni iz indexa i filesystema
git rm -r --cached kovanica-wallet wallet-extension web web-deploy android-light-node 2>/dev/null || true
rm -rf kovanica-wallet wallet-extension web web-deploy android-light-node

# Cargo workspace cleanup (kritično)
if [ -f Cargo.toml ]; then
  echo "== Cleaning Cargo.toml workspace members =="
  # Ukloni linije koje referenciraju izvučene pathove
  # (prilagodi sed pattern prema stvarnom formatu)
  sed -i \
    -e '/kovanica-wallet/d' \
    -e '/wallet-extension/d' \
    -e '/"web"/d' \
    -e '/web-deploy/d' \
    -e '/android-light-node/d' \
    Cargo.toml || true

  # Ako postoji [workspace.members] lista, očisti je ručno ako sed nije dovoljan
  echo "Cargo.toml cleaned (verify manually if needed)"
fi

# Ukloni eventualne path dependencies u pod-crateovima
find . -name "Cargo.toml" -exec grep -l "kovanica-wallet\|wallet-extension\|android-light-node\|web-deploy" {} \; 2>/dev/null | while read -r f; do
  echo "WARNING: path dependency still present in $f — clean manually"
done

git add -A
git commit -m "restructure: remove extracted dirs (now sibling repos) + clean workspace" || true
cd - >/dev/null

echo ""
echo "=== RESTRUCTURE DONE ==="
echo "Layout:"
ls -la "$DST"
echo ""
echo "Backup: $BACKUP_DIR"
echo "Next: run verification + add .gitignore/README + cargo check"

2. Post-restructure verification — `verify-restructure.sh`
#!/usr/bin/env bash
set -euo pipefail
DST=/root/kovanica

echo "=== Verification ==="
for repo in kovanica-protocol kovanica-wallet kovanica-web kovanica-mobile kovanica-node kovanica-agent kovanica-installer; do
  d="$DST/$repo"
  if [ -d "$d/.git" ]; then
    echo "----- $repo -----"
    (cd "$d" && git log --oneline -3 && git status --short && echo "OK")
  else
    echo "----- $repo ----- (no .git or missing)"
  fi
done

echo ""
echo "=== Protocol Cargo check ==="
cd "$DST/kovanica-protocol"
cargo check --workspace 2>&1 | tail -20 || echo "CARGO CHECK FAILED — fix workspace members!"

3. .gitignore fajlovi (dodaj nakon restructure)
`kovanica-wallet/.gitignore`
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
`kovanica-web/.gitignore`
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
`kovanica-mobile/.gitignore`
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
(protocol, node, agent, installer već imaju svoje — ne diraj)

4. README.md fajlovi
`kovanica-wallet/README.md`
# kovanica-wallet

Kovanica wallet — mobile apps + browser extension.

## Structure
- `android/` — Android wallet (Kotlin)
- `ios/` — iOS wallet (Swift)
- `shared/` — Shared logic
- `extension/` — Browser extension (Vite + TypeScript)

## Development
```bash
cd android && ./gradlew build
cd ios && xcodebuild -scheme KovanicaWallet
cd extension && npm install && npm run dev
Related
	•	Source of truth: kovanica-protocol
	•	Web: kovanica-web
	•	Light node mobile: kovanica-mobile
License
MIT OR Apache-2.0
### `kovanica-web/README.md`
```markdown
# kovanica-web

Kovanica web app + deploy config.

## Structure
- `site/` — Vite + TanStack web application
- `deploy/` — Deploy configuration / output

## Development
```bash
cd site && npm install && npm run dev
Related
	•	Protocol: kovanica-protocol
	•	Wallet: kovanica-wallet
	•	Mobile light-node: kovanica-mobile
License
MIT OR Apache-2.0
### `kovanica-mobile/README.md`
```markdown
# kovanica-mobile

Kovanica light-node mobile clients (Android + future iOS).  
**Distinct from kovanica-wallet** — this is the light node, not the full wallet.

## Structure
- `android/` — Android light node client (Kotlin)
- `ios/` — iOS light node (planned)

## Development
```bash
cd android && ./gradlew build
Related
	•	Protocol: kovanica-protocol
	•	Wallet: kovanica-wallet
	•	Web: kovanica-web
License
MIT OR Apache-2.0
### `/root/kovanica/README.md` (meta, nije git repo)
```markdown
# kovanica

Meta-directory — Kovanica DAG protocol ecosystem.  
**Not a git repository itself.** Each subdirectory is an independent git repo.

| Repo                | Purpose                                      | Remote                          |
|---------------------|----------------------------------------------|---------------------------------|
| kovanica-protocol   | Internal monorepo (dag/state/node/cli/ffi)   | KovanicaDAG/kovanica-protocol   |
| kovanica-node       | Public release snapshot for operators        | KovanicaDAG/kovanica-node       |
| kovanica-wallet     | Wallet apps + browser extension              | (create)                        |
| kovanica-web        | Web app + deploy                             | (create)                        |
| kovanica-mobile     | Light-node mobile clients                    | (create)                        |
| kovanica-agent      | RAG agent service (Python)                   | existing                        |
| kovanica-installer  | Installer scripts                            | existing                        |
| kovanica-data       | Runtime data (not versioned)                 | —                               |

## Release flow
`kovanica-node` is periodically synced from `kovanica-protocol` crates when a new public version is tagged.  
**Not auto-synced** — always diff before push.

5. Tag checkpoint — `tag-checkpoint.sh`
#!/usr/bin/env bash
set -euo pipefail
DST=/root/kovanica
TAG="v0.1.0-restructure"
MSG="First versioned checkpoint after multi-repo restructure"

for repo in kovanica-protocol kovanica-wallet kovanica-web kovanica-mobile kovanica-agent kovanica-installer; do
  d="$DST/$repo"
  if [ -d "$d/.git" ]; then
    cd "$d"
    git tag -a "$TAG" -m "$MSG"
    echo "tagged $repo → $TAG"
    cd - >/dev/null
  fi
done

echo "Note: kovanica-node is intentionally NOT tagged (owns its own release process)"

6. Točan redoslijed izvršavanja (agent / ljudski)
	1.	Backup + Restructure bash /root/restructure.sh
	2.	
	3.	Verifikacija bash /root/verify-restructure.sh
	4.	
	•	Ako cargo check padne → ručno očisti Cargo.toml workspace.members i path dependencies.
	5.	Dodaj .gitignore + README u wallet / web / mobile (i meta README).
	6.	Ponovno cargo check u protocolu dok ne prođe.
	7.	Tag bash /root/tag-checkpoint.sh
	8.	
	9.	GitHub (ručno, jedan po jedan):
	•	Kreiraj prazne repoe: kovanica-wallet, kovanica-web, kovanica-mobile
	•	Za svaki: cd /root/kovanica/kovanica-wallet
	•	git remote add origin git@github.com:KovanicaDAG/kovanica-wallet.git
	•	git push -u origin main
	•	git push origin v0.1.0-restructure
	•	
	•	Isto za web i mobile.
	10.	Finalni sanity
	•	ls -la /root/kovanica
	•	Svaki repo ima čist git status
	•	Protocol cargo check --workspace prolazi
	•	Tagovi postoje

7. Rollback
Ako nešto krene po zlu:
# Vrati protocol iz backupa
rm -rf /root/kovanica/kovanica-protocol
tar -xzf /root/kovanica-restructure-backup-*/protocol-full.tar.gz -C /root
# Ostale repoe po potrebi iz njihovih tarova

Ključne razlike od originalnog plana (zašto je ovo 100%)
Original	Poboljšanje
Ručni git mv nakon filter-repo	--path-rename unutar filter-repo → čist tree odmah
Nema backup	Full tar backup prije bilo kakvog mv/filtera
Cargo workspace ostaje broken	Eksplicitni cleanup + cargo check verifikacija
Nema verify skripte	verify-restructure.sh
Tagiranje bez kontrole	Jasno: node se ne tagira
Nedostaje meta README	Dodan
Ovo je spremno za izvršavanje. Pokreni restructure.sh, zatim verify, zatim README + gitignore, zatim tag, zatim GitHub.
