//! Encrypted file transfer (KVP-104 data transactions).
//!
//! Files are split into chunks, each carried in a separate KVP-104
//! transaction with tag `b"FILE"`. Each chunk is encrypted with ECIES
//! (X25519 ephemeral + ChaCha20-Poly1305).
//!
//! Wire format per chunk:
//! ```text
//! file_id:    [u8; 16]  — unique file identifier
//! chunk_index: u16      — zero-based chunk index
//! total_chunks: u16     — total number of chunks
//! epk:        [u8; 32]  — ephemeral X25519 public key
//! nonce:      [u8; 12]  — ChaCha20-Poly1305 nonce
//! ciphertext: [u8]      — encrypted chunk data (includes 16-byte Poly1305 tag)
//! ```

use crate::crypto;
use crate::message::MAX_PLAINTEXT_LEN;

/// KVP-104 transaction tag for file chunks.
pub const FILE_TAG: &[u8] = b"FILE";

/// Maximum file size: 100 MB.
pub const MAX_FILE_SIZE: usize = 100 * 1024 * 1024;

/// Default chunk size: 180 bytes (fits in a single KVP-104 tx with overhead).
pub const DEFAULT_CHUNK_SIZE: usize = 180;

/// A single encrypted file chunk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileChunk {
    /// Unique file identifier (16 bytes).
    pub file_id: [u8; 16],
    /// Zero-based chunk index.
    pub chunk_index: u16,
    /// Total number of chunks.
    pub total_chunks: u16,
    /// Ephemeral X25519 public key (32 bytes).
    pub ephemeral_pk: [u8; 32],
    /// ChaCha20-Poly1305 nonce (12 bytes).
    pub nonce: [u8; 12],
    /// Encrypted chunk data (includes 16-byte Poly1305 tag).
    pub ciphertext: Vec<u8>,
}

/// The chunk's routing metadata, authenticated but not encrypted.
///
/// Binding these means a relay cannot renumber a chunk, reorder it inside a
/// transfer, or redirect it into a different file without the Poly1305 tag
/// rejecting the payload. Encrypt and decrypt must agree on this byte string
/// exactly; it is never transmitted.
fn chunk_aad(file_id: &[u8; 16], chunk_index: u16, total_chunks: u16) -> [u8; 20] {
    let mut aad = [0u8; 20];
    aad[..16].copy_from_slice(file_id);
    aad[16..18].copy_from_slice(&chunk_index.to_le_bytes());
    aad[18..].copy_from_slice(&total_chunks.to_le_bytes());
    aad
}

impl FileChunk {
    /// Encrypt a file chunk for a recipient.
    ///
    /// `recipient_pk` must be the recipient's **X25519 public key** (32 bytes),
    /// derived from their Ed25519 seed via `crypto::ed25519_seed_to_x25519` then
    /// `x25519_dalek::PublicKey::from(&secret)`.
    pub fn encrypt(
        recipient_pk: &[u8; 32],
        file_id: [u8; 16],
        chunk_index: u16,
        total_chunks: u16,
        chunk_data: &[u8],
    ) -> Result<Self, FileError> {        if chunk_data.len() > MAX_PLAINTEXT_LEN {
            return Err(FileError::ChunkTooLong);
        }

        let (ephemeral_pk, nonce_and_ciphertext) = crypto::encrypt(
            recipient_pk,
            chunk_data,
            &chunk_aad(&file_id, chunk_index, total_chunks),
        )
        .map_err(|e| FileError::Crypto(e.to_string()))?;

        if nonce_and_ciphertext.len() < 12 {
            return Err(FileError::Crypto("ciphertext too short".into()));
        }

        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_and_ciphertext[..12]);
        let ciphertext = nonce_and_ciphertext[12..].to_vec();

        Ok(Self {
            file_id,
            chunk_index,
            total_chunks,
            ephemeral_pk,
            nonce,
            ciphertext,
        })
    }

    /// Decrypt this file chunk with the recipient's X25519 secret.
    pub fn decrypt(
        &self,
        recipient_secret: &x25519_dalek::StaticSecret,
    ) -> Result<Vec<u8>, FileError> {
        crypto::decrypt(
            recipient_secret,
            &self.ephemeral_pk,
            &self.nonce,
            &self.ciphertext,
            &chunk_aad(&self.file_id, self.chunk_index, self.total_chunks),
        )
        .map_err(|e| FileError::Crypto(e.to_string()))
    }

    /// Serialize to the on-chain wire format.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(16 + 2 + 2 + 32 + 12 + self.ciphertext.len());
        buf.extend_from_slice(&self.file_id);
        buf.extend_from_slice(&self.chunk_index.to_le_bytes());
        buf.extend_from_slice(&self.total_chunks.to_le_bytes());
        buf.extend_from_slice(&self.ephemeral_pk);
        buf.extend_from_slice(&self.nonce);
        buf.extend_from_slice(&self.ciphertext);
        buf
    }

    /// Deserialize from the on-chain wire format.
    pub fn decode(bytes: &[u8]) -> Result<Self, FileError> {
        if bytes.len() < 64 {
            return Err(FileError::PayloadTooShort);
        }
        let mut file_id = [0u8; 16];
        file_id.copy_from_slice(&bytes[..16]);
        let mut chunk_index_bytes = [0u8; 2];
        chunk_index_bytes.copy_from_slice(&bytes[16..18]);
        let chunk_index = u16::from_le_bytes(chunk_index_bytes);
        let mut total_chunks_bytes = [0u8; 2];
        total_chunks_bytes.copy_from_slice(&bytes[18..20]);
        let total_chunks = u16::from_le_bytes(total_chunks_bytes);
        let mut ephemeral_pk = [0u8; 32];
        ephemeral_pk.copy_from_slice(&bytes[20..52]);
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&bytes[52..64]);
        let ciphertext = bytes[64..].to_vec();
        Ok(Self {
            file_id,
            chunk_index,
            total_chunks,
            ephemeral_pk,
            nonce,
            ciphertext,
        })
    }
}

/// A file transfer session — manages chunking and reassembly.
#[derive(Clone, Debug)]
pub struct FileTransfer {
    /// Unique file identifier (16 bytes).
    pub file_id: [u8; 16],
    /// Total file size in bytes.
    pub total_size: usize,
    /// Chunk size in bytes.
    pub chunk_size: usize,
    /// Number of chunks.
    pub num_chunks: usize,
    /// File name (max 255 bytes).
    pub filename: String,
}

impl FileTransfer {
    /// Create a new file transfer session.
    ///
    /// # Panics
    /// Panics if `data` exceeds [`MAX_FILE_SIZE`] bytes.
    pub fn new(file_id: [u8; 16], data: &[u8], filename: String) -> Self {
        assert!(
            data.len() <= MAX_FILE_SIZE,
            "file exceeds {} bytes",
            MAX_FILE_SIZE
        );
        let num_chunks = data.len().div_ceil(DEFAULT_CHUNK_SIZE);
        Self {
            file_id,
            total_size: data.len(),
            chunk_size: DEFAULT_CHUNK_SIZE,
            num_chunks,
            filename,
        }
    }

    /// Split data into chunks and encrypt each for a recipient.
    pub fn encrypt_chunks(
        &self,
        recipient_pk: &[u8; 32],
        data: &[u8],
    ) -> Result<Vec<FileChunk>, FileError> {
        if data.len() > MAX_FILE_SIZE {
            return Err(FileError::FileTooLarge);
        }
        let mut chunks = Vec::with_capacity(self.num_chunks);
        for (i, chunk_data) in data.chunks(DEFAULT_CHUNK_SIZE).enumerate() {
            let chunk = FileChunk::encrypt(
                recipient_pk,
                self.file_id,
                i as u16,
                self.num_chunks as u16,
                chunk_data,
            )?;
            chunks.push(chunk);
        }
        Ok(chunks)
    }

    /// Reassemble chunks into the original file data.
    ///
    /// Chunks must be sorted by `chunk_index`. Returns an error if any
    /// chunk is missing or has a mismatched `file_id`.
    pub fn reassemble(chunks: &[FileChunk]) -> Result<Vec<u8>, FileError> {
        if chunks.is_empty() {
            return Err(FileError::NoChunks);
        }
        let file_id = chunks[0].file_id;
        let total_chunks = chunks[0].total_chunks as usize;
        if chunks.len() != total_chunks {
            return Err(FileError::MissingChunks);
        }
        let mut sorted: Vec<&FileChunk> = chunks.iter().collect();
        sorted.sort_by_key(|c| c.chunk_index);
        let mut data = Vec::new();
        for (i, chunk) in sorted.iter().enumerate() {
            if chunk.file_id != file_id {
                return Err(FileError::MismatchedFileId);
            }
            if chunk.chunk_index as usize != i {
                return Err(FileError::MissingChunks);
            }
            // Decrypt is done by the caller — here we just concatenate ciphertext
            // The caller must decrypt each chunk and then concatenate.
            data.extend_from_slice(&chunk.ciphertext);
        }
        Ok(data)
    }
}

/// Errors from file transfer operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileError {
    /// Payload shorter than the minimum 64 bytes.
    PayloadTooShort,
    /// Chunk data exceeds [`MAX_PLAINTEXT_LEN`].
    ChunkTooLong,
    /// File exceeds [`MAX_FILE_SIZE`].
    FileTooLarge,
    /// No chunks provided.
    NoChunks,
    /// Missing chunks.
    MissingChunks,
    /// Mismatched file ID.
    MismatchedFileId,
    /// Encryption/decryption failure.
    Crypto(String),
}

impl core::fmt::Display for FileError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PayloadTooShort => write!(f, "payload too short"),
            Self::ChunkTooLong => write!(f, "chunk too long"),
            Self::FileTooLarge => write!(f, "file too large"),
            Self::NoChunks => write!(f, "no chunks"),
            Self::MissingChunks => write!(f, "missing chunks"),
            Self::MismatchedFileId => write!(f, "mismatched file ID"),
            Self::Crypto(msg) => write!(f, "crypto error: {}", msg),
        }
    }
}

impl std::error::Error for FileError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto;

    fn test_keypair(seed: u64) -> ed25519_dalek::SigningKey {
        let mut seed_bytes = [0u8; 32];
        // Put seed in byte 1+ to avoid X25519 clamping collisions on byte 0.
        seed_bytes[1..9].copy_from_slice(&seed.to_le_bytes());
        ed25519_dalek::SigningKey::from_bytes(&seed_bytes)
    }

    #[test]
    fn file_chunk_encrypt_decrypt_roundtrip() {
        let sk = test_keypair(20);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let file_id = [0x01u8; 16];
        let chunk_data = vec![0xABu8; 100];
        let chunk =
            FileChunk::encrypt(recipient_pk.as_bytes(), file_id, 0, 1, &chunk_data).unwrap();

        let decrypted = chunk.decrypt(&recipient_secret).unwrap();
        assert_eq!(decrypted, chunk_data);
    }

    #[test]
    fn file_chunk_encode_decode_roundtrip() {
        let sk = test_keypair(21);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let file_id = [0x02u8; 16];
        let chunk_data = vec![0xCDu8; 50];
        let chunk =
            FileChunk::encrypt(recipient_pk.as_bytes(), file_id, 0, 1, &chunk_data).unwrap();

        let encoded = chunk.encode();
        let decoded = FileChunk::decode(&encoded).unwrap();
        assert_eq!(decoded.file_id, file_id);
        assert_eq!(decoded.chunk_index, 0);
        assert_eq!(decoded.total_chunks, 1);
        assert_eq!(decoded.ephemeral_pk, chunk.ephemeral_pk);
        assert_eq!(decoded.nonce, chunk.nonce);
        assert_eq!(decoded.ciphertext, chunk.ciphertext);

        let decrypted = decoded.decrypt(&recipient_secret).unwrap();
        assert_eq!(decrypted, chunk_data);
    }

    #[test]
    fn file_chunk_wrong_recipient_cannot_decrypt() {
        let sk1 = test_keypair(22);
        let sk2 = test_keypair(23);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk1.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let chunk_data = vec![0xEFu8; 80];
        let chunk =
            FileChunk::encrypt(recipient_pk.as_bytes(), [0x03u8; 16], 0, 1, &chunk_data).unwrap();

        let wrong_secret = crypto::ed25519_seed_to_x25519(&sk2.to_bytes());
        assert!(chunk.decrypt(&wrong_secret).is_err());
    }

    #[test]
    fn file_chunk_too_short_rejected() {
        let short = [0u8; 63];
        assert_eq!(
            FileChunk::decode(&short).unwrap_err(),
            FileError::PayloadTooShort
        );
    }

    #[test]
    fn file_chunk_chunk_too_long() {
        let sk = test_keypair(24);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);
        let long_chunk = vec![0u8; MAX_PLAINTEXT_LEN + 1];
        assert_eq!(
            FileChunk::encrypt(recipient_pk.as_bytes(), [0u8; 16], 0, 1, &long_chunk).unwrap_err(),
            FileError::ChunkTooLong
        );
    }

    #[test]
    fn file_transfer_new() {
        let file_id = [0x04u8; 16];
        let data = vec![0xAAu8; 500];
        let transfer = FileTransfer::new(file_id, &data, "test.txt".to_string());
        assert_eq!(transfer.file_id, file_id);
        assert_eq!(transfer.total_size, 500);
        assert_eq!(transfer.num_chunks, 3); // 180 + 180 + 140
        assert_eq!(transfer.filename, "test.txt");
    }

    #[test]
    fn file_transfer_encrypt_chunks() {
        let sk = test_keypair(25);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let file_id = [0x05u8; 16];
        let data = vec![0xBBu8; 400];
        let transfer = FileTransfer::new(file_id, &data, "doc.pdf".to_string());

        let chunks = transfer
            .encrypt_chunks(recipient_pk.as_bytes(), &data)
            .unwrap();
        assert_eq!(chunks.len(), 3);

        // Decrypt each chunk and concatenate
        let mut decrypted = Vec::new();
        for chunk in &chunks {
            let plain = chunk.decrypt(&recipient_secret).unwrap();
            decrypted.extend_from_slice(&plain);
        }
        assert_eq!(decrypted, data);
    }

    #[test]
    fn file_transfer_reassemble_empty() {
        assert_eq!(
            FileTransfer::reassemble(&[]).unwrap_err(),
            FileError::NoChunks
        );
    }

    #[test]
    fn file_transfer_reassemble_missing_chunks() {
        let sk = test_keypair(26);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let file_id = [0x06u8; 16];
        let chunk = FileChunk::encrypt(recipient_pk.as_bytes(), file_id, 0, 2, &[0u8; 10]).unwrap();
        assert_eq!(
            FileTransfer::reassemble(&[chunk]).unwrap_err(),
            FileError::MissingChunks
        );
    }

    #[test]
    fn file_transfer_reassemble_mismatched_file_id() {
        let sk = test_keypair(27);
        let recipient_secret = crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let chunk1 =
            FileChunk::encrypt(recipient_pk.as_bytes(), [0x07u8; 16], 0, 2, &[0u8; 10]).unwrap();
        let chunk2 =
            FileChunk::encrypt(recipient_pk.as_bytes(), [0x08u8; 16], 1, 2, &[0u8; 10]).unwrap();
        assert_eq!(
            FileTransfer::reassemble(&[chunk1, chunk2]).unwrap_err(),
            FileError::MismatchedFileId
        );
    }

    #[test]
    fn file_transfer_too_large() {
        let result = std::panic::catch_unwind(|| {
            FileTransfer::new([0u8; 16], &[0u8; MAX_FILE_SIZE + 1], "big.bin".to_string());
        });
        assert!(result.is_err());
    }

    #[test]
    fn file_chunk_tampered_chunk_index_rejected() {
        // Renumbering a chunk must break the tag. Otherwise a relay could
        // reorder or duplicate chunks and the transfer would still assemble,
        // silently corrupting the file.
        let sk = test_keypair(21);
        let recipient_secret = crate::crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let mut chunk =
            FileChunk::encrypt(recipient_pk.as_bytes(), [3u8; 16], 2, 5, b"payload").unwrap();
        chunk.chunk_index = 3;

        assert!(chunk.decrypt(&recipient_secret).is_err());
    }

    #[test]
    fn file_chunk_tampered_file_id_rejected() {
        // Re-pointing a chunk at a different transfer must break the tag too.
        let sk = test_keypair(22);
        let recipient_secret = crate::crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let mut chunk =
            FileChunk::encrypt(recipient_pk.as_bytes(), [3u8; 16], 0, 1, b"payload").unwrap();
        chunk.file_id = [4u8; 16];

        assert!(chunk.decrypt(&recipient_secret).is_err());
    }

    #[test]
    fn file_chunk_tampered_total_chunks_rejected() {
        // Truncating a transfer by shrinking `total_chunks` would drop the
        // tail of a file without breaking any other check.
        let sk = test_keypair(23);
        let recipient_secret = crate::crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let mut chunk =
            FileChunk::encrypt(recipient_pk.as_bytes(), [3u8; 16], 0, 5, b"payload").unwrap();
        chunk.total_chunks = 1;

        assert!(chunk.decrypt(&recipient_secret).is_err());
    }
}
