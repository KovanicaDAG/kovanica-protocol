# Git remote credential — rotation & storage

**Status**: ⚠️ **ACTION REQUIRED — rotate the exposed PAT**
**Date**: 2026-09-21
**Severity**: Medium (credential hygiene) — no consensus/ledger/network impact.

---

## What was wrong

`origin` was configured as:

```
https://<github-user>:<PAT>@github.com/KovanicaDAG/kovanica.git
```

i.e. a **classic GitHub personal access token embedded in plaintext in
`.git/config`**. Consequences:

- Any `git remote -v`, `git config --list`, shell history capture, screen share,
  or `cp -r` of the working tree would expose the token.
- The token also appeared in **this agent session's command output**, so it must
  be treated as **compromised**.

## What was fixed (2026-09-21)

- `remote.origin.url` is now the clean URL:
  `https://github.com/KovanicaDAG/kovanica.git`
- The credential was moved out of the repo to
  `~/.config/kovanica/git-credentials` (mode `0600`), referenced by a
  **repo-local** helper so it does not affect other repos:

  ```bash
  git config --local credential.helper 'store --file=/root/.config/kovanica/git-credentials'
  ```

- Auth was verified with `git ls-remote origin refs/heads/cli/tui-wallet`
  (succeeds; returns the branch tip).
- `.git/config` now contains **no** secret (only the helper path).

## ACTION REQUIRED — rotate the PAT

The old token is compromised and is still on disk (and in shell history).

1. GitHub → Settings → Developer settings → Personal access tokens → **revoke**
   the old token, then create a replacement (fine-grained, scoped to
   `KovanicaDAG/kovanica`, `Contents: read/write` only).
2. Update the stored credential in place (do **not** paste it into `.git/config`
   or any repo file):

   ```bash
   printf 'https://<github-user>:<NEW_TOKEN>@github.com\n' \
       > /root/.config/kovanica/git-credentials
   chmod 600 /root/.config/kovanica/git-credentials
   ```

   Or let git store it after a successful interactive auth:

   ```bash
   git -c credential.helper='store --file=/root/.config/kovanica/git-credentials' \
       ls-remote origin HEAD
   ```

3. Purge shell history of the old secret: `history -d <n>` for any line that
   echoed the URL, or clear the relevant history file.
4. Prefer **SSH deploy keys** for automation (no token on disk at all) and
   `gh auth setup-git` for interactive use, as the longer-term fix.

## Notes

- `~/.config/kovanica/git-credentials` lives **outside** the repo, so re-cloning
  or archiving the working tree no longer carries the secret.
- Never commit credentials; `.gitconfig`/`.git-credentials` patterns should stay
  out of the tree (they are not tracked here).
