# VPS (`srv1745734`)

`/root/kovanica-web` and `/root/kovanica-ledger` are **not git repos.** Clone
sidecars. Do not `git -C` them.

Kovanica owns `127.0.0.1:3010` (web), `127.0.0.1:8080` (explorer HTTP),
`0.0.0.0:9000` (P2P). Leave dashboard / trader / postgres / docker alone.

---

## Seed

Explorer listens on TCP 9000. Keep:

```
KOVANICA_LISTEN=0.0.0.0:9000
KOVANICA_PEERS=off
KOVANICA_MINE=0
KOVANICA_FAUCET=0
KOVANICA_ALLOW_RESET=0
KOVANICA_OPERATOR=0
KOVANICA_POW=1
KOVANICA_DATA=/root/kovanica-ledger/data
```

ufw `9000/tcp` is open. **That is not enough:** `explorer.kovanica.online` is
Cloudflare-proxied (orange cloud). A clone that dials that hostname:9000 hits
Cloudflare, not this box.

Publish a **DNS-only** (grey cloud) A record:

```
seed.kovanica.online  →  $(curl -s ifconfig.me)   # DNS only, proxy OFF
```

Clones:

```
KOVANICA_PEERS=seed.kovanica.online:9000
```

Until that record exists, use the origin IP: `KOVANICA_PEERS=<ip>:9000`.

---

## Ship UI (Telegram links gone)

Do this **inside tmux** so an SSH drop does not kill the build. Reuse the
existing `/tmp` clone — do **not** `npm ci` again (that is what dropped SSH).

```sh
tmux new -s kv || tmux attach -s kv
cd /tmp/kovanica-web-build
git fetch origin
git reset --hard origin/main
npm run build:vps
test -f .output/server/index.mjs
mkdir -p /root/kovanica-web/.output
rsync -a --delete .output/ /root/kovanica-web/.output/
pm2 delete kovanica-web
cd /root/kovanica-web
HOST=127.0.0.1 PORT=3010 pm2 start .output/server/index.mjs --name kovanica-web
pm2 save
```

If `/tmp/kovanica-web-build` is missing, clone once then `npm ci` **inside tmux**.

Confirm no `t.me` on `https://kovanica.online`. Purge Cloudflare cache if needed.
