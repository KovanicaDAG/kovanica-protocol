/**
 * Known-answer check for the browser key implementation.
 *
 * Pins the frozen Kovanica derivation path m/44'/3007'/0'/0'/i' against the same
 * literals the Rust suite asserts in crates/kovanica-wallet/tests/slip10_vectors.rs
 * (zero-entropy phrase). If this fails, the browser wallet and the node disagree
 * about which address a seed owns — a real key-loss class bug, not cosmetics.
 *
 * Run: npx tsx scripts/kvnc-vectors.check.mts
 */
import { createWalletFromMnemonic, signingKey } from '../src/lib/kvnc';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';


const ZERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const v = createWalletFromMnemonic(ZERO, 0);

const checks: Array<[string, string, string]> = [
  ['sk index 0', bytesToHex(signingKey(v, 0)), '99d5e3a2a167ffae4407e9485105f301ab88d49ec9951f008eb7840ffded804d'],
  ['sk index 1', bytesToHex(signingKey(v, 1)), '58b3767fe602f53bb4ff9082c72e76d92acf9b4d966159fb42a3898f0ee822d7'],
  ['sk index 2', bytesToHex(signingKey(v, 2)), '2ac511aa2558e239e00191802f26a7498890744718849df701d4ffb027ab348e'],
  ['public key', bytesToHex(v.publicKey), '862f70cfafc9b581699f8d67598eac699cbc92bdfc940e95ed7ee1e8d8100e7e'],
  ['address', v.address, 'kvnc1A2ob7wBpGDrzuyLudnqwMyiqgwKhdN8RtcVGbTChbtvZdag'],
];

let failed = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      want ${want}\n      got  ${got}`);
}

const sig = ed25519.sign(signingKey(v, 0), new Uint8Array(32));
console.log(`${sig.length === 64 ? 'PASS' : 'FAIL'}  signature is 64 bytes`);
if (sig.length !== 64) failed++;

console.log(failed === 0 ? '\nall vectors match' : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
