#!/usr/bin/env bash
# backup-node.sh — Encrypted backup of Kovanica node data + wallet seeds.
#
# Reads the passphrase from KOV_BACKUP_PASSPHRASE (env) or a file at
# KOV_BACKUP_PASSPHRASE_FILE. If neither is set, you are prompted securely.
# Never pass the passphrase on the command line.
#
# Backups are encrypted at source with AES-256-CBC + PBKDF2 and stored under
# /root/kovanica-backups by default (files 600, directory 700). No unencrypted
# dump is written to disk, not even in /tmp.
#
# Usage:
#   KOV_BACKUP_PASSPHRASE="..." ./scripts/backup-node.sh [--data DIR] [--out DIR]
#     [--name NAME] [--retention N] [--dry-run]
#
# Environment:
#   KOVANICA_DATA          data directory to back up (default: ./data or /root/kovanica-data)
#   KOV_BACKUP_DIR         backup destination (default: /root/kovanica-backups)
#   KOV_BACKUP_PASSPHRASE  encryption passphrase (do NOT commit this)
#   KOV_BACKUP_PASSPHRASE_FILE  file containing the passphrase
#   KOV_SEED_DIRS          colon-separated list of directories to scan for seeds
#
# Examples:
#   ./scripts/backup-node.sh --dry-run
#   ./scripts/backup-node.sh --data /root/kovanica-data --out /mnt/backups

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Defaults
DATA_DIR="${KOVANICA_DATA:-}"
if [[ -z "$DATA_DIR" ]]; then
    if [[ -d "$REPO_ROOT/data" ]]; then
        DATA_DIR="$REPO_ROOT/data"
    else
        DATA_DIR="/root/kovanica-data"
    fi
fi
BACKUP_DIR="${KOV_BACKUP_DIR:-/root/kovanica-backups}"
NAME="${KOV_BACKUP_NAME:-$(hostname -s 2>/dev/null || echo kovanica)}"
RETENTION="${KOV_BACKUP_RETENTION:-7}"
DRY_RUN=0

SEED_PATTERNS=("*.miner" "*.seed" "*.wallet" "*.key")
SEED_DIRS=("$DATA_DIR")
if [[ -n "${KOV_SEED_DIRS:-}" ]]; then
    IFS=':' read -ra SEED_DIRS <<< "$KOV_SEED_DIRS"
fi
if [[ -d "$HOME/.config/kovanica/seeds" ]]; then
    SEED_DIRS+=("$HOME/.config/kovanica/seeds")
fi

usage() { grep '^#' "$0" | cut -c4-; exit 0; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage ;;
        --data) DATA_DIR="$2"; shift 2 ;;
        --out|--backup-dir) BACKUP_DIR="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        --retention) RETENTION="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

DATA_DIR="$(cd "$DATA_DIR" 2>/dev/null && pwd)" || {
    echo "Error: data directory does not exist: $DATA_DIR"
    exit 1
}

TS="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

DATA_ARCHIVE="$BACKUP_DIR/${NAME}-data-${TS}.tar.gz.enc"
SEED_ARCHIVE="$BACKUP_DIR/${NAME}-seeds-${TS}.tar.gz.enc"
MANIFEST="$BACKUP_DIR/${NAME}-data-${TS}.manifest.json"

# Passphrase handling
PASS="${KOV_BACKUP_PASSPHRASE:-}"
PASS_SOURCE="environment KOV_BACKUP_PASSPHRASE"
if [[ -z "$PASS" && -n "${KOV_BACKUP_PASSPHRASE_FILE:-}" ]]; then
    if [[ -f "$KOV_BACKUP_PASSPHRASE_FILE" ]]; then
        PASS="$(cat "$KOV_BACKUP_PASSPHRASE_FILE")"
        PASS_SOURCE="file $KOV_BACKUP_PASSPHRASE_FILE"
    else
        echo "Error: KOV_BACKUP_PASSPHRASE_FILE not found"
        exit 1
    fi
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ -z "$PASS" ]]; then
        PASS_SOURCE="not required (dry-run)"
    fi
elif [[ -z "$PASS" ]]; then
    PASS_SOURCE="interactive prompt"
    read -rsp "Backup passphrase: " PASS
    echo
    if [[ -z "$PASS" ]]; then
        echo "Error: passphrase is required"
        exit 1
    fi
fi

export KOV_BACKUP_PASSPHRASE="$PASS"

# Discover seed files
SEED_FILES=()
for d in "${SEED_DIRS[@]}"; do
    [[ -d "$d" ]] || continue
    for pat in "${SEED_PATTERNS[@]}"; do
        while IFS= read -r -d '' f; do
            SEED_FILES+=("$f")
        done < <(find "$d" -maxdepth 3 -type f -name "$pat" -print0 2>/dev/null)
    done
done

if [[ ${#SEED_FILES[@]} -eq 0 ]]; then
    echo "Warning: no wallet seed files found under ${SEED_DIRS[*]}"
fi

DATA_SIZE=$(du -sb "$DATA_DIR" | awk '{print $1}')
SEED_SIZE=0
for f in "${SEED_FILES[@]}"; do
    s=$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f" 2>/dev/null || echo 0)
    SEED_SIZE=$((SEED_SIZE + s))
done

if [[ ${#SEED_FILES[@]} -eq 0 ]]; then
    SEED_RELS='[]'
else
    SEED_RELS=$(printf '%s\n' "${SEED_FILES[@]}" | sed 's|^"||;s|"$||' | jq -R . | jq -s .)
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "=== DRY RUN ==="
    echo "Data dir : $DATA_DIR"
    echo "Data size: $(numfmt --to=iec "$DATA_SIZE" 2>/dev/null || echo "$DATA_SIZE bytes")"
    echo "Backup   : $DATA_ARCHIVE"
    echo "Seeds    : ${#SEED_FILES[@]} file(s), $(numfmt --to=iec "$SEED_SIZE" 2>/dev/null || echo "$SEED_SIZE bytes")"
    echo "Seed backup: $SEED_ARCHIVE"
    printf '  %s\n' "${SEED_FILES[@]:-}"
    echo "Manifest : $MANIFEST"
    echo "Passphrase source: $PASS_SOURCE"
    echo "Retention: keep newest $RETENTION backup set(s)"
    echo "Would delete old backups (dry-run; not deleted):"
    find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "${NAME}-*.tar.gz.enc" -o -name "${NAME}-*.manifest.json" \) -printf '  %f\n' | sort -r | tail -n +$((RETENTION + 1)) || true
    exit 0
fi

# Encrypting archive helper: reads tar stream from stdin, writes encrypted file.
encrypt_tar() {
    local out="$1"
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
        -pass env:KOV_BACKUP_PASSPHRASE -out "$out"
}

echo "=== Kovanica node backup ($NAME @ $TS) ==="
echo "Data dir : $DATA_DIR"

# Full data backup (encrypted at source)
echo "[1/3] Archiving and encrypting data directory ($(numfmt --to=iec "$DATA_SIZE" 2>/dev/null || echo "$DATA_SIZE bytes"))..."
tar -czf - -C "$DATA_DIR" . | encrypt_tar "$DATA_ARCHIVE"
chmod 600 "$DATA_ARCHIVE"

# Seed-only backup (encrypted at source)
if [[ ${#SEED_FILES[@]} -gt 0 ]]; then
    echo "[2/3] Archiving and encrypting ${#SEED_FILES[@]} wallet seed file(s)..."
    tar -czf - --transform 's|.*/||' "${SEED_FILES[@]}" | encrypt_tar "$SEED_ARCHIVE"
    chmod 600 "$SEED_ARCHIVE"
else
    echo "[2/3] No seed files to archive"
    SEED_ARCHIVE=""
fi

# Manifest (plaintext, no secrets)
echo "[3/3] Writing manifest..."
DATA_SHA=$(sha256sum "$DATA_ARCHIVE" | awk '{print $1}')
SEED_SHA=""
[[ -n "$SEED_ARCHIVE" ]] && SEED_SHA=$(sha256sum "$SEED_ARCHIVE" | awk '{print $1}')

jq -n \
    --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg host "$(hostname -f 2>/dev/null || hostname)" \
    --arg data_dir "$DATA_DIR" \
    --arg data_archive "$(basename "$DATA_ARCHIVE")" \
    --arg data_sha256 "$DATA_SHA" \
    --arg seed_archive "$(basename "$SEED_ARCHIVE")" \
    --arg seed_sha256 "$SEED_SHA" \
    --argjson seed_files "$SEED_RELS" \
    --arg cipher "aes-256-cbc-salt-pbkdf2" \
    --arg compression "gzip" \
    '{
        created: $created,
        host: $host,
        data_dir: $data_dir,
        data_archive: $data_archive,
        data_sha256: $data_sha256,
        seed_archive: $seed_archive,
        seed_sha256: $seed_sha256,
        seed_files: $seed_files,
        cipher: $cipher,
        compression: $compression
    }' > "$MANIFEST"
chmod 600 "$MANIFEST"

# Retention: keep newest N backup sets (a set = data + seeds + manifest)
if [[ "$RETENTION" -gt 0 ]]; then
    echo "Pruning backups older than the newest $RETENTION set(s)..."
    mapfile -t ALL_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${NAME}-*.tar.gz.enc" -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
    if [[ ${#ALL_BACKUPS[@]} -gt $RETENTION ]]; then
        for old in "${ALL_BACKUPS[@]:$RETENTION}"; do
            base="${old%.tar.gz.enc}"
            rm -f "$old" "${base}.manifest.json" \
                  "${base/-data-/-seeds-}.tar.gz.enc" \
                  "${base/-seeds-/-data-}.tar.gz.enc"
        done
    fi
fi

echo "=== Backup complete ==="
echo "Data archive : $DATA_ARCHIVE"
echo "Seed archive : ${SEED_ARCHIVE:-(none)}"
echo "Manifest     : $MANIFEST"
