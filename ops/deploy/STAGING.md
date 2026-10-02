# Kovanica Seed Staging

Prepares a host to run Kovanica **without starting anything**. No chain data is
created, no service is enabled, no genesis is written. This is deliberately
separate from `RESET-RUNBOOK.md`: staging is reversible, the reset is not.

## What staging does

| Step | Effect |
|---|---|
| Base packages | `ca-certificates curl rsync ufw chrony tzdata jq` |
| Time sync | Enables `chrony`/`chronyd`. PoA slot scheduling is wall-clock dependent, so an unsynced clock causes missed or double slots. |
| Node binary | Installs `/usr/local/bin/kovanica-node`, refusing to proceed unless the SHA-256 matches the expected value passed in. |
| Config dir | Creates `/etc/kovanica` at mode `0700`. Left empty — secrets arrive in the key ceremony. |
| systemd units | Installs `kovanica-testnet-seed@.service` and `kovanica-mainnet-seed@.service`, then `daemon-reload`. **Never enabled, never started.** |
| Firewall | `ufw` default-deny inbound; allows only 22, 8000 (testnet P2P), 9000 (mainnet P2P). |

## What staging deliberately does not do

- Does not write `/etc/kovanica/*.env`. Those are installed from the repo's
  `deploy/<network>/configs/seed<N>.env` at deploy time.
- Does not create or enable any authority key material.
- Does not create `KOVANICA_DATA` directories, so `apply_block` has nothing to
  write to and a stray `systemctl start` fails loudly instead of silently
  forking a chain.
- Does not open the explorer ports. The API binds to loopback and is reached
  through nginx/Cloudflare, never directly from the internet.

## Verification

The script asserts, and fails non-zero if any of these is untrue: no
`kovanica-node` process, no `/var/lib/kovanica-*` directory, no enabled unit,
and nothing bound to 8000/9000/3001/3002.

Re-check at any time:

```sh
pgrep -x kovanica-node                       # expect no output
ls -d /var/lib/kovanica-*                    # expect no output
systemctl is-enabled 'kovanica-testnet-seed@2.service'   # expect disabled
ss -ltn | grep -E ':(8000|9000|3001|3002)$'              # expect no output
```

## Binary provenance

All seeds must run a byte-identical binary, otherwise a version skew can
produce divergent chains. Pass the checksum explicitly rather than trusting
the transfer:

```sh
sha256sum /usr/local/bin/kovanica-node > /tmp/opencode/binary.sha
```

A checksum mismatch aborts the script before the binary is installed.

## SSH

Key-based login must be confirmed in a **fresh** session before touching
`PasswordAuthentication`. These hosts fail2ban on a short lockout, so repeated
failed attempts lock you out for roughly 20 seconds mid-operation.