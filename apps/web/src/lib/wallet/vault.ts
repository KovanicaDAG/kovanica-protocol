import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LEN = 16;
const IV_LEN = 12;

export type EncryptedBundle = {
  salt: string;
  iv: string;
  ct: string;
};

function asBufferSource(u: Uint8Array): BufferSource {
  return u as BufferSource;
}

async function getPasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8ToBytes(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBufferSource(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a BIP39 mnemonic with a user password. Returns hex-encoded salt/iv/ciphertext. */
export async function encryptMnemonic(mnemonic: string, password: string): Promise<EncryptedBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await getPasswordKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(utf8ToBytes(mnemonic)),
  );
  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ct: bytesToHex(new Uint8Array(ct)),
  };
}

/** Decrypt a previously encrypted mnemonic. Throws on bad password or corrupt data. */
export async function decryptMnemonic(bundle: EncryptedBundle, password: string): Promise<string> {
  const key = await getPasswordKey(password, hexToBytes(bundle.salt));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(hexToBytes(bundle.iv)) },
    key,
    asBufferSource(hexToBytes(bundle.ct)),
  );
  return new TextDecoder().decode(pt);
}
