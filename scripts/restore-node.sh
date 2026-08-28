#!/usr/bin/env bash
# restore-node.sh — Restore Kovanica node data and wallet seeds from an encrypted backup.
#
# Reads the passphrase from KOV_BACKUP_PASSPHRASE (env) or
# KOV_BACKUP_PASSPHRASE_FILE. Never pass the passphrase on the command line.
#
# Usage:
#   KOV_BACKUP_PASSPHRASE="..." ./scripts/restore-node.sh [--data-archive PATH]
#     [--seed-archive PATH] [--data-dir DIR] [--seed-dir DIR] [--force] [--dry-run]
#     [--verify-only]
#
# If no archive is specified, the most recent backup in KOV_BACKUP_DIR is used.
#
# Environment:
#   KOV_BACKUP_DIR         backup directory (default: /root/kovanica-backups)
#   KOV_BACKUP_PASSPHRASE  encryption passphrase
#   KOV_BACKUP_PASSPHRASE_FILE  file containing the passphrase
#   KOVANICA_DATA          target data directory (default: ./data or /root/kovanica-data)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKUP_DIR="${KOV_BACKUP_DIR:-/root/kovanica-backups}"
DATA_DIR="${KOVANICA_DATA:-}"
if [[ -z "$DATA_DIR" ]]; then
    if [[ -d "$REPO_ROOT/data" ]]; then
        DATA_DIR="$REPO_ROOT/data"
    else
        DATA_DIR="/root/kovanica-data"
    fi
fi
SEED_DIR=""
DATA_ARCHIVE=""
SEED_ARCHIVE=""
FORCE=0
DRY_RUN=0
VERIFY_ONLY=0

usage() { grep '^#' "$0" | cut -c4-; exit 0; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage ;;
        --data-archive) DATA_ARCHIVE="$2"; shift 2 ;;
        --seed-archive) SEED_ARCHIVE="$2"; shift 2 ;;
        --data-dir) DATA_DIR="$2"; shift 2 ;;
        --seed-dir) SEED_DIR="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --verify-only) VERIFY_ONLY=1; shift ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$SEED_DIR" ]] && SEED_DIR="$DATA_DIR"

# Resolve latest archives if not provided
find_latest() {
    local pattern="$1"
    [[ -d "$BACKUP_DIR" ]] || return 0
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2- || true
}

if [[ -z "$DATA_ARCHIVE" ]]; then
    DATA_ARCHIVE="$(find_latest "*-data-*.tar.gz.enc")"
fi
if [[ -z "$SEED_ARCHIVE" ]]; then
    SEED_ARCHIVE="$(find_latest "*-seeds-*.tar.gz.enc")"
fi

if [[ -z "$DATA_ARCHIVE" || ! -f "$DATA_ARCHIVE" ]]; then
    echo "Error: data archive not found in $BACKUP_DIR"
    exit 1
fi

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
elif [[ "$VERIFY_ONLY" -eq 0 && -z "$PASS" ]]; then
    PASS_SOURCE="interactive prompt"
    read -rsp "Restore passphrase: " PASS
    echo
    if [[ -z "$PASS" ]]; then
        echo "Error: passphrase is required"
        exit 1
    fi
fi

export KOV_BACKUP_PASSPHRASE="$PASS"

decrypt_tar() {
    local archive="$1"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
        -pass env:KOV_BACKUP_PASSPHRASE -in "$archive"
}

# Verify-only: decrypt to /dev/null while listing archive contents
if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    echo "=== Verifying data archive: $DATA_ARCHIVE ==="
    decrypt_tar "$DATA_ARCHIVE" | tar -tzf - | tail -n 20
    echo "... (listed last 20 entries)"
    if [[ -n "$SEED_ARCHIVE" && -f "$SEED_ARCHIVE" ]]; then
        echo "=== Verifying seed archive: $SEED_ARCHIVE ==="
        decrypt_tar "$SEED_ARCHIVE" | tar -tzf -
    fi
    echo "=== Verify OK (passphrase decrypts archive) ==="
    exit 0
fi

echo "=== Kovanica node restore ==="
echo "Data archive: $DATA_ARCHIVE"
echo "Seed archive: ${SEED_ARCHIVE:-(none)}"
echo "Target dir  : $DATA_DIR"
echo "Seed dir    : $SEED_DIR"
echo "Passphrase source: $PASS_SOURCE"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "=== DRY RUN ==="
    echo "Would decrypt and extract data archive into: $DATA_DIR"
    echo "Would decrypt and extract seed archive into: $SEED_DIR"
    echo "No files were changed."
    exit 0
fi

if [[ -e "$DATA_DIR" && -n "$(ls -A "$DATA_DIR" 2>/dev/null || true)" && "$FORCE" -eq 0 ]]; then
    echo "Error: target data directory is not empty: $DATA_DIR"
    echo "Use --force to overwrite, or pick a different --data-dir."
    exit 1
fi

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true

echo "[1/2] Restoring data directory..."
decrypt_tar "$DATA_ARCHIVE" | tar -xzf - -C "$DATA_DIR"

if [[ -n "$SEED_ARCHIVE" && -f "$SEED_ARCHIVE" ]]; then
    echo "[2/2] Restoring wallet seeds..."
    mkdir -p "$SEED_DIR"
    decrypt_tar "$SEED_ARCHIVE" | tar -xzf - -C "$SEED_DIR"
else
    echo "[2/2] No seed archive supplied; data archive already contains seeds if they were backed up together"
fi

echo "=== Restore complete ==="
echo "Data directory: $DATA_DIR"
echo "Seed directory: $SEED_DIR"
echo "Next: adjust ownership/permissions and start the node."
