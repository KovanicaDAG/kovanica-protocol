//! Data directory management with network isolation.
//!
//! Each network (testnet/mainnet) gets its own data directory under a
//! platform-appropriate base (e.g. `$XDG_DATA_HOME/kovanica/` on Linux,
//! `%APPDATA%/Kovanica/` on Windows, `~/Library/Application Support/Kovanica/`
//! on macOS). A `network` marker file inside each directory enforces that a
//! node booted for one network can never destroy another network's data.

use std::fs;
use std::path::PathBuf;

use crate::profile::NetworkProfile;
use thiserror::Error;

/// Why data directory operations failed.
#[derive(Debug, Error)]
pub enum DataDirError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("network marker mismatch: expected '{expected}', found '{found}'")]
    NetworkMismatch { expected: String, found: String },
    #[error("base data directory not available: {0}")]
    BaseDirUnavailable(String),
}

/// Resolved data directory for a network profile.
#[derive(Clone, Debug)]
pub struct DataDir {
    /// Root directory for this network's data.
    pub path: PathBuf,
    /// The network profile this directory belongs to.
    pub profile: NetworkProfile,
}

impl DataDir {
    /// Resolve the data directory for `profile`, creating it if necessary,
    /// and verifying the network marker.
    pub fn resolve(profile: NetworkProfile) -> Result<Self, DataDirError> {
        let base = Self::base_data_dir()?;
        let path = base.join(profile.id);
        fs::create_dir_all(&path)?;

        // Write or verify the network marker file.
        let marker = path.join("network");
        match fs::read_to_string(&marker) {
            Ok(existing) => {
                let existing = existing.trim();
                if existing != profile.id {
                    return Err(DataDirError::NetworkMismatch {
                        expected: profile.id.to_string(),
                        found: existing.to_string(),
                    });
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::write(&marker, profile.id.as_bytes())?;
            }
            Err(e) => return Err(DataDirError::Io(e)),
        }

        Ok(Self { path, profile })
    }

    /// Path to the incremental append-only log (for `Node::create_log`).
    pub fn log_path(&self) -> PathBuf {
        self.path.join("ledger.log")
    }

    /// Path to the latest finality checkpoint (for `Node::create_checkpoint`).
    pub fn checkpoint_path(&self) -> PathBuf {
        self.path.join("checkpoint.bin")
    }

    /// Path to a whole-file snapshot (for `Node::save` / `Node::load`).
    pub fn snapshot_path(&self) -> PathBuf {
        self.path.join("snapshot.bin")
    }

    /// Base data directory per platform conventions.
    fn base_data_dir() -> Result<PathBuf, DataDirError> {
        let proj =
            directories::ProjectDirs::from("", "KovanicaDAG", "Kovanica").ok_or_else(|| {
                DataDirError::BaseDirUnavailable("could not determine project dirs".into())
            })?;
        Ok(proj.data_dir().to_path_buf())
    }
}
