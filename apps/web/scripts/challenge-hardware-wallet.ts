/**
 * Challenger Adversarial Stress-Test Suite for Kovanica Hardware Wallet Integration
 * Tests malformed inputs, boundary conditions, concurrency, error recovery, and state transitions.
 */

import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  MockHardwareProvider,
  LedgerHardwareProvider,
  TrezorHardwareProvider,
  getHardwareProvider,
  getActiveHardwareProvider,
  setActiveHardwareProvider,
  disconnectActiveHardwareProvider,
  formatDerivationPath,
  parseAccountOrPath,
  validateSighash,
  KOVANICA_COIN_TYPE,
  HardwareWalletError,
  HardwareErrorCode,
} from "../src/lib/wallet/hardware/index.ts";
import { serializeBip44Path, mapLedgerError } from "../src/lib/wallet/hardware/ledger-provider.ts";
import { mapTrezorError } from "../src/lib/wallet/hardware/trezor-provider.ts";
import { hexToKvnc, parseAddr } from "../src/lib/wallet/address.ts";

ed.hashes.sha512 = sha512;

function generateRandomHex(lengthChars: number): string {
  const bytes = randomBytes(Math.ceil(lengthChars / 2));
  return bytesToHex(bytes).slice(0, lengthChars);
}

async function runAdversarialStressTests() {
  console.log("==================================================================");
  console.log("  Kovanica Hardware Wallet - Empirical Challenger Stress Suite   ");
  console.log("==================================================================\n");

  let totalTestsPassed = 0;
  let totalSubchecksPassed = 0;

  // ==========================================================================
  // Suite 1: Malformed & Invalid Sighash Edge Cases
  // ==========================================================================
  console.log("[Suite 1] Malformed & Invalid Sighash Edge Cases");
  const provider = new MockHardwareProvider();
  await provider.connect();

  const invalidSighashes = [
    { label: "empty string", val: "" },
    { label: "non-hex chars", val: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    { label: "short hex (63 chars)", val: "1db9d8e740828abcba12d4198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7" },
    { label: "long hex (65 chars)", val: "1db9d8e740828abcba12d4198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7aa" },
    { label: "16 hex chars", val: "1234567890abcdef" },
    { label: "128 hex chars", val: "1db9d8e740828abcba12d4198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7a1db9d8e740828abcba12d4198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7a" },
    { label: "0x prefix (66 chars)", val: "0x1db9d8e740828abcba12d4198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7a" },
    { label: "embedded whitespace", val: "1db9d8e740828abc ba12d4198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7a" },
    { label: "special symbols", val: "1db9d8e740828abc!@#$%^&*()198ba4c87c0d5d6f19d0c44f25fab32c16fa4e6e7" },
    { label: "null cast", val: null as any },
    { label: "undefined cast", val: undefined as any },
  ];

  for (const { label, val } of invalidSighashes) {
    // 1. Check direct validateSighash
    assert.throws(
      () => validateSighash(val, "mock"),
      (err: any) => {
        assert.ok(err instanceof HardwareWalletError, `validateSighash on ${label} should throw HardwareWalletError`);
        return true;
      },
      `validateSighash should reject ${label}`
    );

    // 2. Check provider.signTransaction rejects
    await assert.rejects(
      async () => provider.signTransaction(0, val),
      (err: any) => {
        assert.ok(err instanceof HardwareWalletError, `signTransaction on ${label} should throw HardwareWalletError`);
        return true;
      },
      `signTransaction should reject ${label}`
    );
    totalSubchecksPassed += 2;
  }

  // Check valid mixed-case hex is accepted and normalized
  const upperSighash = "1DB9D8E740828ABCBA12D4198BA4C87C0D5D6F19D0C44F25FAB32C16FA4E6E7A";
  const validSignRes = await provider.signTransaction(0, upperSighash);
  assert.equal(validSignRes.sighash, upperSighash.toLowerCase(), "Sighash should be normalized to lowercase");
  assert.match(validSignRes.signature, /^[0-9a-f]{128}$/, "Valid signature generated for upper-case input");
  totalSubchecksPassed += 2;

  console.log(`  ✓ Passed ${invalidSighashes.length * 2 + 2} sighash validation & normalization checks`);
  totalTestsPassed++;

  // ==========================================================================
  // Suite 2: Unusual Account Indices, Boundary Values & Custom Derivation Paths
  // ==========================================================================
  console.log("\n[Suite 2] Unusual Account Indices & Custom Derivation Paths");

  const accountScenarios = [
    { input: 0, expectedAcc: 0, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/0'/0/0` },
    { input: 1, expectedAcc: 1, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/1'/0/0` },
    { input: 1000, expectedAcc: 1000, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/1000'/0/0` },
    { input: 2147483647, expectedAcc: 2147483647, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/2147483647'/0/0` }, // 2^31 - 1
    { input: -5, expectedAcc: 0, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/0'/0/0` }, // Negative clamped
    { input: -1000, expectedAcc: 0, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/0'/0/0` },
    { input: 2.7, expectedAcc: 2, expectedPath: `m/44'/${KOVANICA_COIN_TYPE}'/2'/0/0` }, // Float floored
{ input: "m/44'/3007'/5'/0/0", expectedAcc: 5, expectedPath: "m/44'/3007'/5'/0/0" },
    { input: "44'/3007'/8'/0/0", expectedAcc: 8, expectedPath: "m/44'/3007'/8'/0/0" },
    { input: "m/44'/3007'/3'/1/7", expectedAcc: 3, expectedPath: "m/44'/3007'/3'/1/7" },
    { input: "m/44'/60'/0'/0/0", expectedAcc: 0, expectedPath: "m/44'/60'/0'/0/0" },
    { input: "m/44'/3007'/99'/0/0/1", expectedAcc: 99, expectedPath: "m/44'/3007'/99'/0/0/1" },
  ];

  const derivedKeys = new Map<string, string>();

  for (const { input, expectedAcc, expectedPath } of accountScenarios) {
    // Check path parsing
    const parsed = parseAccountOrPath(input as any);
    assert.equal(parsed.accountIndex, expectedAcc, `parseAccountOrPath for ${String(input)} should have accountIndex ${expectedAcc}`);
    assert.equal(parsed.path, expectedPath, `parseAccountOrPath for ${String(input)} should have path ${expectedPath}`);

    // Get public key
    const pub = await provider.getPublicKey(input as any);
    assert.match(pub.publicKey, /^[0-9a-f]{64}$/, `Public key for ${String(input)} must be 64-hex`);
    assert.equal(pub.address, pub.publicKey, "Address matches public key");
    assert.equal(pub.path, expectedPath, "Public key result contains expected path");

    // Sign a transaction
    const testSighash = generateRandomHex(64);
    const signResult = await provider.signTransaction(input as any, testSighash);
    assert.match(signResult.signature, /^[0-9a-f]{128}$/, "Signature must be 128-hex");
    assert.equal(signResult.path, expectedPath, "Sign result path matches");

    // Cryptographically verify signature
    const isValid = ed.verify(
      hexToBytes(signResult.signature),
      hexToBytes(testSighash),
      hexToBytes(pub.publicKey)
    );
    assert.equal(isValid, true, `Cryptographic signature verification for ${String(input)} failed!`);

    // Record key for determinism and uniqueness checks
    derivedKeys.set(expectedPath, pub.publicKey);
    totalSubchecksPassed += 6;
  }

  // Determinism check: repeating account 1000 derives exact same public key
  const repeatPub = await provider.getPublicKey(1000);
  assert.equal(repeatPub.publicKey, derivedKeys.get(`m/44'/${KOVANICA_COIN_TYPE}'/1000'/0/0`), "Key derivation must be deterministic");
  totalSubchecksPassed++;

  console.log(`  ✓ Verified ${accountScenarios.length} account & path boundary scenarios + Ed25519 crypto verification`);
  totalTestsPassed++;

  // ==========================================================================
  // Suite 3: Rapid Concurrent Signing Requests (100 parallel operations)
  // ==========================================================================
  console.log("\n[Suite 3] Rapid Concurrency & Asynchronous Load (100 parallel operations)");

  const concurrentProvider = new MockHardwareProvider({ simulatedDelayMs: 15 });
  await concurrentProvider.connect();

  const concurrentOpsCount = 100;
  const concurrentTasks = Array.from({ length: concurrentOpsCount }, async (_, idx) => {
    const acc = idx % 10;
    const sighash = generateRandomHex(64);
    const signRes = await concurrentProvider.signTransaction(acc, sighash);
    return { idx, acc, sighash, signRes };
  });

  const startTime = Date.now();
  const concurrentResults = await Promise.all(concurrentTasks);
  const durationMs = Date.now() - startTime;

  // Retrieve public keys for all 10 accounts used
  const accountPubKeys = await Promise.all(
    Array.from({ length: 10 }, (_, i) => concurrentProvider.getPublicKey(i))
  );

  // Validate every single result for cryptographic integrity
  for (const { idx, acc, sighash, signRes } of concurrentResults) {
    assert.equal(signRes.sighash, sighash, `Op ${idx}: Result sighash matches input`);
    assert.match(signRes.signature, /^[0-9a-f]{128}$/, `Op ${idx}: Signature is 128-hex`);

    const expectedPub = accountPubKeys[acc].publicKey;
    const isValid = ed.verify(
      hexToBytes(signRes.signature),
      hexToBytes(sighash),
      hexToBytes(expectedPub)
    );
    assert.equal(isValid, true, `Op ${idx}: Signature verification against account ${acc} failed`);
    totalSubchecksPassed += 3;
  }

  // Also test interleaved getPublicKey + signTransaction under concurrency
  const mixedTasks = Array.from({ length: 40 }, async (_, idx) => {
    const acc = idx % 5;
    if (idx % 2 === 0) {
      const pub = await concurrentProvider.getPublicKey(acc);
      assert.equal(pub.publicKey, accountPubKeys[acc].publicKey);
    } else {
      const sighash = generateRandomHex(64);
      const res = await concurrentProvider.signTransaction(acc, sighash);
      const isValid = ed.verify(hexToBytes(res.signature), hexToBytes(sighash), hexToBytes(accountPubKeys[acc].publicKey));
      assert.equal(isValid, true);
    }
  });
  await Promise.all(mixedTasks);
  totalSubchecksPassed += 40;

  console.log(`  ✓ Processed ${concurrentOpsCount} concurrent sign operations + 40 mixed operations in ${durationMs}ms with 100% cryptographic validity`);
  totalTestsPassed++;

  // ==========================================================================
  // Suite 4: Simulated Error Modes & Full State Recovery
  // ==========================================================================
  console.log("\n[Suite 4] Simulated Error Modes & State Recovery");

  const errProvider = new MockHardwareProvider();
  await errProvider.connect();

  const testSighash = generateRandomHex(64);
  const errorModes: HardwareErrorCode[] = [
    "USER_REJECTED",
    "DEVICE_LOCKED",
    "APP_NOT_OPEN",
    "TIMEOUT",
    "DEVICE_NOT_CONNECTED",
  ];

  for (const errCode of errorModes) {
    errProvider.setSimulatedError(errCode);

    // 1. getPublicKey should reject with the error code
    await assert.rejects(
      async () => errProvider.getPublicKey(0),
      (err: any) => {
        assert.ok(err instanceof HardwareWalletError, `Error for ${errCode} should be HardwareWalletError`);
        assert.equal(err.code, errCode, `Error code should match ${errCode}`);
        return true;
      },
      `getPublicKey should reject on ${errCode}`
    );

    // 2. signTransaction should reject with the error code
    await assert.rejects(
      async () => errProvider.signTransaction(0, testSighash),
      (err: any) => {
        assert.ok(err instanceof HardwareWalletError, `Error for ${errCode} should be HardwareWalletError`);
        assert.equal(err.code, errCode, `Error code should match ${errCode}`);
        return true;
      },
      `signTransaction should reject on ${errCode}`
    );

    // 3. Reset error and verify immediate recovery
    errProvider.setSimulatedError(null);
    const pub = await errProvider.getPublicKey(0);
    const sign = await errProvider.signTransaction(0, testSighash);
    const isValid = ed.verify(hexToBytes(sign.signature), hexToBytes(testSighash), hexToBytes(pub.publicKey));
    assert.equal(isValid, true, `Recovery after ${errCode} must produce valid cryptographic signature`);

    totalSubchecksPassed += 5;
  }

  console.log(`  ✓ Verified all 5 simulated error modes and guaranteed post-error recovery`);
  totalTestsPassed++;

  // ==========================================================================
  // Suite 5: Connection Lifecycle, Reconnection & Disconnection State Transitions
  // ==========================================================================
  console.log("\n[Suite 5] Connection Lifecycle & State Transitions");

  const lifecycleProvider = new MockHardwareProvider();

  // Initially disconnected
  assert.equal(lifecycleProvider.isConnected(), false, "Provider initially disconnected");
  assert.equal(lifecycleProvider.getDeviceInfo(), null, "Device info initially null");

  // Calls when disconnected must throw DEVICE_NOT_CONNECTED
  await assert.rejects(
    async () => lifecycleProvider.getPublicKey(0),
    (err: any) => err.code === "DEVICE_NOT_CONNECTED"
  );
  await assert.rejects(
    async () => lifecycleProvider.signTransaction(0, testSighash),
    (err: any) => err.code === "DEVICE_NOT_CONNECTED"
  );
  totalSubchecksPassed += 4;

  // Connect
  const info1 = await lifecycleProvider.connect();
  assert.equal(lifecycleProvider.isConnected(), true);
  assert.equal(info1.connected, true);
  assert.ok(info1.model);
  totalSubchecksPassed += 3;

  // Connect again while already connected (idempotent connect)
  const info2 = await lifecycleProvider.connect();
  assert.equal(lifecycleProvider.isConnected(), true);
  assert.equal(info2.connected, true);
  totalSubchecksPassed += 2;

  // Disconnect
  await lifecycleProvider.disconnect();
  assert.equal(lifecycleProvider.isConnected(), false);
  assert.equal(lifecycleProvider.getDeviceInfo(), null);
  totalSubchecksPassed += 2;

  // Disconnect again while already disconnected (idempotent disconnect)
  await lifecycleProvider.disconnect();
  assert.equal(lifecycleProvider.isConnected(), false);
  totalSubchecksPassed += 1;

  // Reconnect
  await lifecycleProvider.connect();
  assert.equal(lifecycleProvider.isConnected(), true);
  const pubAfterReconnect = await lifecycleProvider.getPublicKey(0);
  assert.match(pubAfterReconnect.publicKey, /^[0-9a-f]{64}$/);
  totalSubchecksPassed += 2;

  // Multi-instance isolation check
  const instanceA = new MockHardwareProvider({ masterSeedPrefix: "seed-alpha" });
  const instanceB = new MockHardwareProvider({ masterSeedPrefix: "seed-beta" });
  await instanceA.connect();
  await instanceB.connect();
  const pubA = await instanceA.getPublicKey(0);
  const pubB = await instanceB.getPublicKey(0);
  assert.notEqual(pubA.publicKey, pubB.publicKey, "Distinct seed prefixes must produce distinct keys");
  totalSubchecksPassed += 1;

  // Active provider manager functions
  setActiveHardwareProvider(instanceA);
  assert.equal(getActiveHardwareProvider(), instanceA, "Active provider should be instanceA");
  await disconnectActiveHardwareProvider();
  assert.equal(getActiveHardwareProvider(), null, "Active provider should be null after disconnect");
  assert.equal(instanceA.isConnected(), false, "instanceA should be disconnected");
  totalSubchecksPassed += 3;

  console.log(`  ✓ Verified 18 state transitions, idempotency, reconnection, and multi-instance isolation`);
  totalTestsPassed++;

  // ==========================================================================
  // Suite 6: Ledger & Trezor Error Mapping & BIP-44 Path Serialization
  // ==========================================================================
  console.log("\n[Suite 6] Ledger & Trezor Error Mappings & BIP-44 Binary Serialization");

  // Ledger Error Mapping unit tests
  const ledgerErrorCases = [
    { input: { statusCode: 0x6985 }, expectedCode: "USER_REJECTED" },
    { input: { message: "User cancelled" }, expectedCode: "USER_REJECTED" },
    { input: { message: "TransportOpenUserCancelled" }, expectedCode: "USER_REJECTED" },
    { input: { statusCode: 0x6e00 }, expectedCode: "APP_NOT_OPEN" },
    { input: { statusCode: 0x6d00 }, expectedCode: "APP_NOT_OPEN" },
    { input: { message: "CLA_NOT_SUPPORTED" }, expectedCode: "APP_NOT_OPEN" },
    { input: { statusCode: 0x5515 }, expectedCode: "DEVICE_LOCKED" },
    { input: { message: "Locked device" }, expectedCode: "DEVICE_LOCKED" },
    { input: { statusCode: 0x6a80 }, expectedCode: "INVALID_PATH" },
    { input: { message: "No device selected" }, expectedCode: "DEVICE_NOT_CONNECTED" },
    { input: { message: "unable to claim interface" }, expectedCode: "DEVICE_NOT_CONNECTED" },
    { input: { message: "device disconnected" }, expectedCode: "DEVICE_NOT_CONNECTED" },
    { input: new Error("Random USB glitch"), expectedCode: "COMMUNICATION_ERROR" },
    { input: new HardwareWalletError("Custom", "TIMEOUT", "ledger"), expectedCode: "TIMEOUT" },
  ];

  for (const { input, expectedCode } of ledgerErrorCases) {
    const mapped = mapLedgerError(input);
    assert.ok(mapped instanceof HardwareWalletError, "Must return HardwareWalletError");
    assert.equal(mapped.code, expectedCode, `Ledger error mapping for ${JSON.stringify(input)}`);
    assert.equal(mapped.deviceType, "ledger");
    totalSubchecksPassed += 3;
  }

  // Trezor Error Mapping unit tests
  const trezorErrorCases = [
    { input: "Action cancelled by user", expectedCode: "USER_REJECTED" },
    { input: { error: "Cancelled" }, expectedCode: "USER_REJECTED" },
    { input: { message: "Permission denied" }, expectedCode: "USER_REJECTED" },
    { input: { error: "Iframe closed" }, expectedCode: "USER_REJECTED" },
    { input: { message: "Popup closed" }, expectedCode: "USER_REJECTED" },
    { input: "PIN cancelled", expectedCode: "USER_REJECTED" }, // Cancelled by user
    { input: "PIN required", expectedCode: "DEVICE_LOCKED" },
    { input: { error: "Device locked" }, expectedCode: "DEVICE_LOCKED" },
    { input: "Passphrase required", expectedCode: "DEVICE_LOCKED" },
    { input: "Device disconnected", expectedCode: "DEVICE_NOT_CONNECTED" },
    { input: "device not found", expectedCode: "DEVICE_NOT_CONNECTED" },
    { input: new Error("Random Trezor bridge error"), expectedCode: "COMMUNICATION_ERROR" },
    { input: new HardwareWalletError("Custom", "APP_NOT_OPEN", "trezor"), expectedCode: "APP_NOT_OPEN" },
  ];

  for (const { input, expectedCode } of trezorErrorCases) {
    const mapped = mapTrezorError(input);
    assert.ok(mapped instanceof HardwareWalletError, "Must return HardwareWalletError");
    assert.equal(mapped.code, expectedCode, `Trezor error mapping for ${JSON.stringify(input)}`);
    assert.equal(mapped.deviceType, "trezor");
    totalSubchecksPassed += 3;
  }

  // BIP-44 Path Serialization unit tests
  const path1 = "m/44'/3007'/0'/0/0";
  const bytes1 = serializeBip44Path(path1);
  assert.equal(bytes1[0], 5, "Path has 5 segments");
  assert.equal(bytes1.length, 1 + 5 * 4, "Total buffer length is 21 bytes");
  // Check hardened flag on first 3 elements (44', 3007', 0')
  const view1 = new DataView(bytes1.buffer, bytes1.byteOffset, bytes1.byteLength);
  assert.equal(view1.getUint32(1, false), (44 | 0x80000000) >>> 0, "Segment 0 is 44'");
  assert.equal(view1.getUint32(5, false), (3007 | 0x80000000) >>> 0, "Segment 1 is 3007'");
  assert.equal(view1.getUint32(9, false), (0 | 0x80000000) >>> 0, "Segment 2 is 0'");
  assert.equal(view1.getUint32(13, false), 0, "Segment 3 is 0 (non-hardened)");
  assert.equal(view1.getUint32(17, false), 0, "Segment 4 is 0 (non-hardened)");
  totalSubchecksPassed += 7;

  console.log(`  ✓ Verified ${ledgerErrorCases.length} Ledger mappings, ${trezorErrorCases.length} Trezor mappings, and BIP-44 binary serialization`);
  totalTestsPassed++;

  // ==========================================================================
  // Suite 7: Store Integration & Hardware Wallet State Management
  // ==========================================================================
  console.log("\n[Suite 7] Store Integration & Hardware State Persistence");
  const { useLedger } = await import("../src/lib/ledger/store.ts");

  const testPub = await provider.getPublicKey(0);
  const hwWalletRec = {
    type: "hardware" as const,
    deviceType: "mock" as const,
    address: testPub.address,
    index: 0,
    path: testPub.path,
    deviceInfo: {
      model: "Mock Hardware Wallet Simulator",
      label: "Kovanica Mock Device",
      version: "1.0.0-mock",
    },
  };

  // Set hardware wallet in store
  useLedger.getState().setWallet(hwWalletRec);
  const storedWallet = useLedger.getState().wallet;
  assert.ok(storedWallet, "Store wallet should be defined");
  assert.equal(storedWallet?.type, "hardware", "Wallet type should be hardware");
  if (storedWallet?.type === "hardware") {
    assert.equal(storedWallet.deviceType, "mock");
    assert.equal(storedWallet.address, testPub.address);
    assert.equal(storedWallet.index, 0);
    assert.equal(storedWallet.path, testPub.path);
    assert.equal(storedWallet.deviceInfo?.model, "Mock Hardware Wallet Simulator");
    assert.equal(storedWallet.mnemonic, undefined, "Hardware wallet MUST NOT have mnemonic");
  }
  totalSubchecksPassed += 7;

  // Test parseAccountOrPath fallback edge cases
  const fallbackCases = [
    { input: "", expectedPath: "m/", expectedAcc: 0 },
    { input: "   ", expectedPath: "m/", expectedAcc: 0 },
    { input: "gibberish", expectedPath: "m/gibberish", expectedAcc: 0 },
    { input: null as any, expectedPath: "m/44'/3007'/0'/0/0", expectedAcc: 0 },
    { input: undefined as any, expectedPath: "m/44'/3007'/0'/0/0", expectedAcc: 0 },
  ];
  for (const { input, expectedPath, expectedAcc } of fallbackCases) {
    const res = parseAccountOrPath(input);
    assert.equal(res.path, expectedPath);
    assert.equal(res.accountIndex, expectedAcc);
    totalSubchecksPassed += 2;
  }

  // Clear wallet from store
  useLedger.getState().setWallet(null);
  assert.equal(useLedger.getState().wallet, null, "Store wallet cleared cleanly");
  totalSubchecksPassed++;

  console.log("  ✓ Verified store hardware wallet record management & edge case path fallback safety");
  totalTestsPassed++;

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log("\n==================================================================");
  console.log(`  ALL ${totalTestsPassed} ADVERSARIAL STRESS SUITES PASSED! (${totalSubchecksPassed} assertions verified)`);
  console.log("==================================================================\n");
}

runAdversarialStressTests().catch((err) => {
  console.error("\n❌ Empirical Stress Test Failed:", err);
  process.exit(1);
});
