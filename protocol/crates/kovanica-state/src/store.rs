//! Incremental on-disk ledger: an append-only replay log.
//!
//! [`Ledger::write_snapshot`] rewrites the *whole* DAG every time. [`LedgerStore`]
//! writes a short header once, then **appends** each subsequent block as a
//! length-prefixed record. Loading replays the log through
//! [`Ledger::insert_raw_block`] — the identity-preserving path, so every block
//! re-admits with its original id and pruned blocks restore with their stored
//! ids (use [`LedgerStore::open_with_poa`] when the log was produced under a
//! PoA policy). Derived consensus and UTXO state is never trusted from disk,
//! same as the snapshot. The file is a streaming log, not mmap.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use kovanica_dag::{decode_block, encode_block, AuthoritySet, Block, BlockId, SnapshotError};

use crate::ledger::{
    HalvingSchedule, Ledger, LedgerError, LedgerSnapshotError, DEFAULT_HALVING_ERA,
};

/// Magic prefix identifying a Kovanica ledger log (`"KVLF"`).
const MAGIC: [u8; 4] = *b"KVLF";
/// Log format version. Bump on any incompatible framing change.
const VERSION: u16 = 2;
/// Refuse a single on-disk record larger than this.
const MAX_RECORD: usize = 16 * 1024 * 1024;

/// How many records pass 2 replays between prunable-set sweeps.
///
/// The finality boundary moves with the replay tip, so a block typically
/// becomes prunable many inserts after its last referrer was replayed. Sweeping
/// every `REPLAY_PRUNE_SWEEP` records bounds the live delta set to the
/// finality window (plus one sweep window of slack) instead of the chain
/// length, at O(deltas) amortised per record rather than O(deltas) per record.
const REPLAY_PRUNE_SWEEP: usize = 256;

/// An open append-only ledger log.
pub struct LedgerStore {
    file: File,
}

/// Pruning policy applied **during** log replay.
///
/// Without a policy, `open` replays the whole log with pruning disabled
/// (`u64::MAX`), so a long chain materialises the full O(n²) GHOSTDAG
/// `blue_anticone_sizes` maps before the caller prunes afterwards — the load
/// peak that dominates RSS on a deep chain. Passing a policy sets the depths
/// on the ledger *before* the replay loop, so `Dag::insert` and
/// `Ledger::insert` prune incrementally and the DAG / per-block state stay
/// bounded throughout the load.
///
/// Invariant (enforced by [`Ledger::set_block_pruning_depth`]): `block_depth`
/// must be `>= finality_depth`, so every evicted block is already final and
/// replay acceptance is unchanged (a replayed block's selected parent is
/// always within `finality_depth` of the replay tip).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PruningPolicy {
    /// Finality depth in blue-score units (`u64::MAX` = disabled).
    pub finality_depth: u64,
    /// Payload pruning depth in blue-score units (`u64::MAX` = disabled).
    pub payload_pruning_depth: u64,
    /// Block pruning depth in blue-score units (`u64::MAX` = disabled).
    /// Must be `>= finality_depth`.
    pub block_pruning_depth: u64,
}

/// Why a log could not be created, opened, or appended.
#[derive(Debug)]
pub enum StoreError {
    /// A filesystem read or write failed.
    Io(String),
    /// The file did not start with the expected magic.
    BadMagic,
    /// The log version is not supported by this build.
    UnsupportedVersion(u16),
    /// The log ended in the middle of a record (or had no genesis).
    Truncated,
    /// A stored block could not be decoded.
    Block(SnapshotError),
    /// Replaying the log into a ledger failed.
    Replay(LedgerSnapshotError),
}

impl core::fmt::Display for StoreError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            StoreError::Io(e) => write!(f, "io: {e}"),
            StoreError::BadMagic => f.write_str("not a kovanica ledger log"),
            StoreError::UnsupportedVersion(v) => write!(f, "unsupported log version {v}"),
            StoreError::Truncated => f.write_str("truncated ledger log"),
            StoreError::Block(e) => write!(f, "block: {e}"),
            StoreError::Replay(e) => write!(f, "replay: {e}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<io::Error> for StoreError {
    fn from(e: io::Error) -> Self {
        StoreError::Io(e.to_string())
    }
}

impl From<LedgerSnapshotError> for StoreError {
    fn from(e: LedgerSnapshotError) -> Self {
        StoreError::Replay(e)
    }
}

impl LedgerStore {
    /// Create (or replace) a log at `path` and write every block currently in
    /// `ledger`, genesis first. Subsequent [`append`](Self::append) calls add
    /// only new blocks.
    pub fn create(path: impl AsRef<Path>, ledger: &Ledger) -> Result<Self, StoreError> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .truncate(true)
            .open(path)?;
        file.write_all(&MAGIC)?;
        file.write_all(&VERSION.to_le_bytes())?;
        file.write_all(&ledger.schedule().genesis_subsidy.to_le_bytes())?;
        file.write_all(&ledger.schedule().halving_era.to_le_bytes())?;
        file.write_all(&ledger.dag().k().to_le_bytes())?;
        for id in ledger.dag().linearize() {
            let block = ledger.dag().block(&id).expect("linearized id is present");
            write_record(&mut file, block)?;
        }
        file.flush()?;
        Ok(Self { file })
    }

    /// Open an existing log and replay it into a [`Ledger`].
    ///
    /// Replay runs through [`Ledger::insert_raw_block`], so every block is
    /// re-admitted exactly as stored (its id is taken as given) and all derived
    /// state is recomputed from the log, never trusted from disk. For logs
    /// produced under a PoA policy, use [`Self::open_with_poa`] so blocks
    /// re-admit with their original ids.
    pub fn open(path: impl AsRef<Path>) -> Result<(Self, Ledger), StoreError> {
        Self::open_impl(path, None, None)
    }

    /// Like [`Self::open`], but the given pruning policy is applied **before**
    /// replay, so the DAG and per-block state stay bounded during the load
    /// instead of peaking at the full chain's memory footprint. See
    /// [`PruningPolicy`].
    pub fn open_with_policy(
        path: impl AsRef<Path>,
        policy: PruningPolicy,
    ) -> Result<(Self, Ledger), StoreError> {
        Self::open_impl(path, None, Some(policy))
    }

    /// Like [`Self::open`], but Proof-of-Authority admission (with
    /// `authority_set` and `slot_duration_ms`) is active during replay, so PoA
    /// blocks re-admit with their original ids intact. Required for any log
    /// produced in PoA mode — mirroring [`Ledger::read_snapshot_with_poa`].
    pub fn open_with_poa(
        path: impl AsRef<Path>,
        authority_set: AuthoritySet,
        slot_duration_ms: u64,
    ) -> Result<(Self, Ledger), StoreError> {
        Self::open_impl(path, Some((authority_set, slot_duration_ms)), None)
    }

    /// Like [`Self::open_with_poa`], with the pruning policy applied before
    /// replay (see [`Self::open_with_policy`]).
    pub fn open_with_poa_and_policy(
        path: impl AsRef<Path>,
        authority_set: AuthoritySet,
        slot_duration_ms: u64,
        policy: PruningPolicy,
    ) -> Result<(Self, Ledger), StoreError> {
        Self::open_impl(path, Some((authority_set, slot_duration_ms)), Some(policy))
    }

    fn open_impl(
        path: impl AsRef<Path>,
        poa: Option<(kovanica_dag::AuthoritySet, u64)>,
        policy: Option<PruningPolicy>,
    ) -> Result<(Self, Ledger), StoreError> {
        let mut file = OpenOptions::new().read(true).write(true).open(path)?;
        let mut magic = [0u8; 4];
        file.read_exact(&mut magic).map_err(map_header_eof)?;
        if magic != MAGIC {
            return Err(StoreError::BadMagic);
        }
        let mut ver = [0u8; 2];
        file.read_exact(&mut ver).map_err(map_header_eof)?;
        let version = u16::from_le_bytes(ver);
        if version > VERSION {
            return Err(StoreError::UnsupportedVersion(version));
        }
        let mut sub = [0u8; 8];
        file.read_exact(&mut sub).map_err(map_header_eof)?;
        let subsidy = u64::from_le_bytes(sub);
        let halving_era = if version >= 2 {
            let mut era_buf = [0u8; 8];
            file.read_exact(&mut era_buf).map_err(map_header_eof)?;
            u64::from_le_bytes(era_buf)
        } else {
            DEFAULT_HALVING_ERA
        };
        let mut kbuf = [0u8; 2];
        file.read_exact(&mut kbuf).map_err(map_header_eof)?;
        let k = u16::from_le_bytes(kbuf);

        let genesis = read_record(&mut file)?.ok_or(StoreError::Truncated)?;
        let genesis_txs = kovanica_dag_payload(&genesis).map_err(StoreError::Replay)?;
        let schedule = HalvingSchedule::new(subsidy, halving_era);
        let mut ledger = Ledger::new(k, schedule, &genesis_txs)
            .map_err(|e| StoreError::Replay(map_genesis(e)))?;
        if let Some((ref authority_set, slot_duration_ms)) = poa {
            ledger.set_poa(authority_set.clone(), slot_duration_ms);
        }
        // Apply the pruning policy before replay so the DAG and per-block
        // state stay bounded during the load (see [`PruningPolicy`]). The
        // setters run their prune immediately (a no-op on a genesis-only
        // ledger) and enforce the `block >= finality` clamp invariant.
        if let Some(policy) = policy {
            ledger.set_finality_depth(policy.finality_depth);
            ledger.set_payload_pruning_depth(policy.payload_pruning_depth);
            ledger.set_block_pruning_depth(policy.block_pruning_depth);
        }
        // Enable replay mode: DAG-level structural checks are relaxed so
        // anticone blocks linearized last can be re-inserted. Note this does
        // NOT relax `Ledger`'s own finality check in `apply_new_block`, which
        // still runs — a block whose selected parent is below the finality
        // threshold is rejected during replay exactly as it is live.
        if policy.is_some() {
            ledger.set_replay_mode(true);
        }

        // Pass 1: count, for every block, how many log records name it as a
        // parent. `remaining[id]` is decremented as those records are replayed,
        // so `remaining[id] == 0` means no *future* record can select `id` as
        // its parent. That count — not "is a child currently in `deltas`" — is
        // what makes mid-replay pruning sound; see `Ledger::prune_replay_final`.
        //
        // Counting *every* parent, not just `parents()[0]`: the selected parent
        // is chosen by blue work (`Dag::select_parent` = `max_by_key(chain_key)`)
        // and is only known once the DAG has seen the block, so it cannot be
        // read off the record here. A superset is the safe direction — it can
        // only delay a prune, never perform one too early.
        //
        // The log is streamed rather than buffered: holding every `Block` in a
        // `Vec` would keep the peak at O(chain) in block bytes and defeat the
        // point of bounding the load.
        let mut remaining: HashMap<BlockId, usize> = HashMap::new();
        let genesis = rewind_to_genesis(&mut file)?;
        while let Some(block) = read_record(&mut file)? {
            for parent in block.parents() {
                *remaining.entry(*parent).or_insert(0) += 1;
            }
        }

        // Re-initialise the ledger for pass 2 from the genesis record pass 1
        // just read, so both passes agree on the genesis block byte-for-byte.
        let schedule = HalvingSchedule::new(subsidy, halving_era);
        let mut ledger = Ledger::new(k, schedule, &kovanica_dag_payload(&genesis)?)
            .map_err(|e| StoreError::Replay(map_genesis(e)))?;
        if let Some((ref authority_set, slot_duration_ms)) = poa {
            ledger.set_poa(authority_set.clone(), slot_duration_ms);
        }
        if let Some(policy) = policy {
            ledger.set_finality_depth(policy.finality_depth);
            ledger.set_payload_pruning_depth(policy.payload_pruning_depth);
            ledger.set_block_pruning_depth(policy.block_pruning_depth);
            ledger.set_replay_mode(true);
        }

        // Pass 2: replay in log order, sweeping the prunable set as we go.
        rewind_to_genesis(&mut file)?;
        let mut replayed = 0usize;
        while let Some(block) = read_record(&mut file)? {
            // Captured before the move: these are the parents whose outstanding
            // referrer count drops once this record is in the ledger.
            let parents: Vec<BlockId> = block.parents().to_vec();
            ledger
                .insert_raw_block(block)
                .map_err(|e| StoreError::Replay(LedgerSnapshotError::Rebuild(e)))?;
            for parent in &parents {
                if let Some(count) = remaining.get_mut(parent) {
                    *count = count.saturating_sub(1);
                }
            }
            replayed += 1;
            // Swept periodically, not per block: the finality boundary moves
            // with the tip, so a block only becomes prunable many inserts after
            // its last referrer was replayed. Sweeping every block would rescan
            // the whole delta set each time; every `REPLAY_PRUNE_SWEEP` blocks
            // is what holds the live delta set to the finality window rather
            // than the chain length.
            if policy.is_some() && replayed % REPLAY_PRUNE_SWEEP == 0 {
                ledger.prune_replay_final(&remaining);
            }
        }

        if policy.is_some() {
            ledger.set_replay_mode(false);
        }
        // Final prune pass: picks up blocks that only crossed the finality
        // boundary in the last partial sweep window.
        if policy.is_some() {
            ledger.prune();
        }

        Ok((Self { file }, ledger))
    }

    /// Append one block (already in the ledger) to the log and flush.
    pub fn append(&mut self, block: &Block) -> Result<(), StoreError> {
        write_record(&mut self.file, block)?;
        self.file.flush()?;
        Ok(())
    }

    /// Write a finality checkpoint to `path`. This writes the checkpoint
    /// directly to a file (not appended to the log).
    pub fn create_checkpoint(path: impl AsRef<Path>, ledger: &Ledger) -> Result<(), StoreError> {
        let bytes = ledger
            .write_checkpoint()
            .map_err(|e| StoreError::Io(e.to_string()))?;
        std::fs::write(path, bytes).map_err(|e| StoreError::Io(e.to_string()))
    }

    /// Open a checkpoint file and replay it into a [`Ledger`].
    pub fn open_checkpoint(path: impl AsRef<Path>) -> Result<Ledger, StoreError> {
        let bytes = std::fs::read(path).map_err(|e| StoreError::Io(e.to_string()))?;
        let ledger = Ledger::read_checkpoint(&bytes).map_err(|e| StoreError::Io(e.to_string()))?;
        Ok(ledger)
    }
}

fn map_header_eof(e: io::Error) -> StoreError {
    if e.kind() == io::ErrorKind::UnexpectedEof {
        StoreError::Truncated
    } else {
        StoreError::Io(e.to_string())
    }
}

/// Rewind `file` to the first record and return the genesis record.
///
/// The two-pass load in [`LedgerStore::open_impl`] reads the log twice, so each
/// pass has to re-derive the exact same byte offset. The header is re-parsed
/// here rather than cached so the two passes cannot drift apart: if the framing
/// ever changes, both follow it. Magic and version were already validated on
/// `open_impl`'s initial read, but are re-checked so a standalone call fails
/// loudly instead of decoding garbage.
fn rewind_to_genesis(file: &mut File) -> Result<Block, StoreError> {
    file.seek(SeekFrom::Start(0))?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(map_header_eof)?;
    if magic != MAGIC {
        return Err(StoreError::BadMagic);
    }
    let mut ver = [0u8; 2];
    file.read_exact(&mut ver).map_err(map_header_eof)?;
    let version = u16::from_le_bytes(ver);
    let mut subsidy = [0u8; 8];
    file.read_exact(&mut subsidy).map_err(map_header_eof)?;
    if version >= 2 {
        file.read_exact(&mut [0u8; 8]).map_err(map_header_eof)?; // halving_era
    }
    file.read_exact(&mut [0u8; 2]).map_err(map_header_eof)?; // k
    read_record(file)?.ok_or(StoreError::Truncated)
}

fn map_genesis(e: LedgerError) -> LedgerSnapshotError {
    LedgerSnapshotError::Genesis(e)
}

fn kovanica_dag_payload(block: &Block) -> Result<Vec<crate::tx::Transaction>, LedgerSnapshotError> {
    crate::tx::decode_block_payload(block.payload()).map_err(LedgerSnapshotError::Payload)
}

fn write_record(file: &mut File, block: &Block) -> Result<(), StoreError> {
    let mut body = Vec::new();
    encode_block(block, &mut body);
    if body.len() > MAX_RECORD {
        return Err(StoreError::Io("record too large".into()));
    }
    file.write_all(&(body.len() as u64).to_le_bytes())?;
    file.write_all(&body)?;
    Ok(())
}

fn read_record(file: &mut File) -> Result<Option<Block>, StoreError> {
    let mut len_buf = [0u8; 8];
    match file.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u64::from_le_bytes(len_buf) as usize;
    if len == 0 || len > MAX_RECORD {
        return Err(StoreError::Truncated);
    }
    let mut body = vec![0u8; len];
    file.read_exact(&mut body).map_err(map_header_eof)?;
    let block = decode_block(&body).map_err(StoreError::Block)?;
    Ok(Some(block))
}
