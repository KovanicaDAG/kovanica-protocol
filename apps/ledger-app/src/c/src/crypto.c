/*
 * Kovanica Ledger App - Crypto Operations
 * 
 * Implements cryptographic operations using Ledger SDK:
 * - Ed25519 key derivation (SLIP-0010)
 * - Ed25519 signing
 * - BLAKE3 hashing
 * - HMAC-SHA512 for BIP-32
 */

#include <string.h>
#include <stdint.h>
#include <cx.h>
#include "kovanica.h"

// SLIP-0010 Ed25519 derivation using Ledger SDK
// Returns KOVANICA_OK on success
int kovanica_slip10_derive(const uint8_t parent_key[32], const uint8_t parent_chain[32], 
                           uint32_t index, uint8_t child_key[32], uint8_t child_chain[32]) {
    // Data format: 0x00 || parent_key(32) || index(4 bytes big-endian)
    uint8_t data[37];
    data[0] = 0x00; // Private derivation (hardened)
    memcpy(&data[1], parent_key, 32);
    data[33] = (index >> 24) & 0xFF;
    data[34] = (index >> 16) & 0xFF;
    data[35] = (index >> 8) & 0xFF;
    data[36] = index & 0xFF;
    
    // HMAC-SHA512(parent_chain, data)
    uint8_t hmac[64];
    cx_hmac_sha512(parent_chain, 32, data, 37, hmac, 64);
    
    // Split result: first 32 bytes = child key, last 32 bytes = child chain code
    memcpy(child_key, hmac, 32);
    memcpy(child_chain, &hmac[32], 32);
    
    return KOVANICA_OK;
}

/// Derive master key and chain code from seed (SLIP-0010)
int kovanica_slip10_master_from_seed(const uint8_t *seed, size_t seed_len,
                                     uint8_t master_key[32], uint8_t master_chain[32]) {
    const uint8_t *seed_key = (const uint8_t *)"ed25519 seed";
    size_t seed_key_len = 12;
    
    uint8_t hmac[64];
    cx_hmac_sha512(seed_key, seed_key_len, seed, 32, hmac, 64);
    
    memcpy(master_key, hmac, 32);
    memcpy(master_chain, &hmac[32], 32);
    
    return KOVANICA_OK;
}

/// Derive BIP-44 path from seed
int kovanica_derive_bip44_path(const uint8_t *seed, size_t seed_len,
                               const uint32_t *path, size_t path_len,
                               uint8_t private_key[32], uint8_t chain_code[32]) {
    if (path_len == 0 || path_len > 10) {
        return KOVANICA_ERR_BAD_PATH;
    }
    
    // Master key from seed
    uint8_t key[32], chain[32];
    int ret = kovanica_slip10_master_from_seed(seed, 32, key, chain);
    if (ret != KOVANICA_OK) return ret;
    
    // Derive each component
    for (size_t i = 0; i < path_len; i++) {
        uint32_t index = path[i];
        bool hardened = (index & 0x80000000) != 0;
        uint32_t child_index = index & 0x7FFFFFFF;
        
        // Only hardened derivation supported for Ed25519 (SLIP-0010)
        if (!hardened && i > 0) {
            return KOVANICA_ERR_INVALID_DERIVATION;
        }
        
        int ret = kovanica_slip10_derive(key, chain, hardened ? (index & 0x7FFFFFFF) | 0x80000000 : index, key, chain);
        if (ret != KOVANICA_OK) return ret;
    }
    
    // Return derived key and chain code
    memcpy(master_key, key, 32);
    memcpy(master_chain, chain, 32);
    
    return KOVANICA_OK;
}

/// Derive Ed25519 public key from private key
int kovanica_get_public_key(const uint8_t private_key[32], uint8_t public_key[32]) {
    cx_ecfp_private_key_t private_key_obj;
    cx_ecfp_public_key_t public_key_obj;
    
    cx_ecfp_init_private_key(CX_CURVE_Ed25519, private_key, 32, &private_key_obj);
    cx_ecfp_generate_pair(CX_CURVE_Ed25519, &public_key_obj, &private_key_obj, 1);
    
    memcpy(public_key, public_key_obj.W, 32);
    return KOVANICA_OK;
}

/// Sign data with Ed25519 private key
int kovanica_sign_data(const uint8_t private_key[32], const uint8_t *data, size_t data_len, uint8_t signature[64]) {
    cx_ecfp_private_key_t private_key_obj;
    cx_ecfp_init_private_key(CX_CURVE_Ed25519, private_key, 32, &private_key_obj);
    
    // Hash the data with SHA-256 first (Ed25519 signs the hash)
    uint8_t hash[32];
    cx_hash_sha256(data, data_len, hash, 32);
    
    uint8_t signature[64];
    size_t sig_len = 64;
    cx_eddsa_sign(&private_key_obj, CX_RND_RFC6979 | CX_LAST, CX_SHA256, 
                  hash, 32, NULL, 0, signature, &sig_len);
    
    if (sig_len != 64) return KOVANICA_ERR_CRYPTO;
    
    memcpy(signature, signature, 64);
    return KOVANICA_OK;
}

/// Get Ed25519 public key from private key
int kovanica_get_public_key(const uint8_t private_key[32], uint8_t public_key[32]) {
    cx_ecfp_private_key_t private_key_obj;
    cx_ecfp_public_key_t public_key_obj;
    
    cx_ecfp_init_private_key(CX_CURVE_Ed25519, private_key, 32, &private_key_obj);
    cx_ecfp_generate_pair(CX_CURVE_Ed25519, &public_key_obj, &private_key_obj, 1);
    
    memcpy(public_key, public_key_obj.W, 32);
    return KOVANICA_OK;
}

/// Sign transaction sighash
int kovanica_sign_transaction(const uint8_t private_key[32], const uint8_t sighash[32], uint8_t signature[64]) {
    return kovanica_sign_data(private_key, sighash, 32, signature);
}