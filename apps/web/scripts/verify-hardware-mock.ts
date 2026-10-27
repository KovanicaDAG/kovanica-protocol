import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  MockHardwareProvider,
  getHardwareProvider,
  getActiveHardwareProvider,
  setActiveHardwareProvider,
  formatDerivationPath,
  KOVANICA_COIN_TYPE,
  HardwareWalletError,
} from "../src/lib/wallet/hardware/index.ts";
import { hexToKvnc, parseAddr } from "../src/lib/wallet/address.ts";

ed.hashes.sha512 = sha512;

async function runVerification() {
  console.log("=================================================");
  console.log("  Kovanica Hardware Wallet - Verification Suite  ");
  console.log("=================================================\n");

  let passedTests = 0;

  // Test 1: Interface & Provider Factory
  console.log("[Test 1] Provider Factory & Registration");
  const factoryMock = getHardwareProvider("mock");
  assert.ok(factoryMock instanceof MockHardwareProvider, "Factory should return MockHardwareProvider instance");
  assert.equal(factoryMock.deviceType, "mock", "Device type should be 'mock'");
  setActiveHardwareProvider(factoryMock);
  assert.equal(getActiveHardwareProvider(), factoryMock, "Active provider should be set");
  console.log("  ✓ Provider factory and active provider registry working");
  passedTests++;

  // Test 2: Connection & Device Info
  console.log("\n[Test 2] Connection & Device Info");
  const provider = new MockHardwareProvider();
  assert.equal(provider.isConnected(), false, "Provider initially not connected");
  assert.equal(provider.getDeviceInfo(), null, "Device info initially null");

  const deviceInfo = await provider.connect();
  assert.equal(provider.isConnected(), true, "Provider should be connected");
  assert.equal(deviceInfo.type, "mock", "Device info type should be 'mock'");
  assert.equal(deviceInfo.connected, true, "Device info connected should be true");
  assert.ok(deviceInfo.model, "Device model should be defined");
  console.log(`  ✓ Connected to ${deviceInfo.model} (v${deviceInfo.version})`);
  passedTests++;

  // Test 3: Account Derivation & BIP-44 Paths
  console.log("\n[Test 3] BIP-44 Derivation Paths & Key Generation");
  const accounts = [0, 1, 2];
  const keys: Array<{ account: number; path: string; publicKey: string; address: string; kvncAddress: string }> = [];

  for (const acc of accounts) {
    const expectedPath = `m/44'/${KOVANICA_COIN_TYPE}'/${acc}'/0/0`;
    assert.equal(formatDerivationPath(acc, 0, 0), expectedPath, `Path formatting for account ${acc}`);

    const pubResult = await provider.getPublicKey(acc);
    assert.equal(pubResult.path, expectedPath, `Exported path matches expected for account ${acc}`);
    assert.match(pubResult.publicKey, /^[0-9a-f]{64}$/, `Public key for account ${acc} must be 64-hex lowercase`);
    assert.equal(pubResult.address, pubResult.publicKey, "Kovanica raw address matches 64-hex public key");

    const kvncAddr = hexToKvnc(pubResult.address);
    assert.ok(kvncAddr.startsWith("kvnc") && kvncAddr.endsWith("dag"), `Formatted address ${kvncAddr} should start with kvnc and end with dag`);
    assert.equal(parseAddr(kvncAddr), parseAddr(pubResult.address), "Parsed kvnc...dag address matches versioned 66-hex");

    keys.push({
      account: acc,
      path: pubResult.path,
      publicKey: pubResult.publicKey,
      address: pubResult.address,
      kvncAddress: kvncAddr,
    });

    console.log(`  ✓ Account ${acc}:`);
    console.log(`      Path:     ${pubResult.path}`);
    console.log(`      Pubkey:   ${pubResult.publicKey.slice(0, 16)}...${pubResult.publicKey.slice(-8)}`);
    console.log(`      Address:  ${kvncAddr}`);
  }

  // Ensure accounts derive distinct keys
  assert.notEqual(keys[0].publicKey, keys[1].publicKey, "Account 0 and 1 keys must differ");
  assert.notEqual(keys[1].publicKey, keys[2].publicKey, "Account 1 and 2 keys must differ");
  console.log("  ✓ Multi-account uniqueness verified");
  passedTests++;

  // Test 4: Transaction Signing & Genuine Ed25519 Cryptographic Verification
  console.log("\n[Test 4] Transaction Signing & Ed25519 Cryptographic Verification");
  const testAccount = 0;
  const fromAddr = keys[0].address;
  const toAddr = keys[1].address;
  const amountAtoms = 100_000_000; // 1 KVNC
  const feeAtoms = 10_000;
  const outpoints = "tx_genesis_001:0";

  // Compute standard sighash: SHA256(from|to|amount|outpoints|fee)
  const payloadStr = `${fromAddr}|${toAddr}|${amountAtoms}|${outpoints}|${feeAtoms}`;
  const sighashBytes = sha256(utf8ToBytes(payloadStr));
  const sighashHex = bytesToHex(sighashBytes).toLowerCase();

  console.log(`  Payload:   ${payloadStr.slice(0, 40)}...`);
  console.log(`  Sighash:   ${sighashHex}`);

  // Request hardware signature
  const statusUpdates: string[] = [];
  const signResult = await provider.signTransaction(testAccount, sighashHex, {
    onStatusChange: (status) => statusUpdates.push(status),
  });

  assert.equal(signResult.sighash, sighashHex, "Sign result returns matching sighash");
  assert.equal(signResult.path, keys[0].path, "Sign result returns derivation path");
  assert.match(signResult.signature, /^[0-9a-f]{128}$/, "Signature must be 128-hex lowercase (64 bytes)");
  console.log(`  Signature: ${signResult.signature.slice(0, 24)}...${signResult.signature.slice(-16)}`);

  // Cryptographic verification: ed.verify(sig, msg, pubKey)
  const isValidSig = ed.verify(
    hexToBytes(signResult.signature),
    hexToBytes(sighashHex),
    hexToBytes(keys[0].publicKey)
  );

  assert.equal(isValidSig, true, "Ed25519 signature verification MUST pass against exported public key");
  console.log("  ✓ Ed25519 signature cryptographically verified with @noble/ed25519.verify()");

  // Negative signature verification check (tampered message should fail)
  const tamperedSighash = sighashHex.slice(0, -2) + "00";
  const isTamperedValid = ed.verify(
    hexToBytes(signResult.signature),
    hexToBytes(tamperedSighash),
    hexToBytes(keys[0].publicKey)
  );
  assert.equal(isTamperedValid, false, "Tampered sighash must fail signature verification");
  console.log("  ✓ Tamper resistance verified (invalid sighash fails verification)");
  passedTests++;

  // Test 5: Error Simulation & Edge Case Handling
  console.log("\n[Test 5] Error Simulation & Edge Cases");

  // User rejection simulation
  provider.setSimulatedError("USER_REJECTED");
  await assert.rejects(
    async () => provider.signTransaction(0, sighashHex),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError, "Should be HardwareWalletError");
      assert.equal(err.code, "USER_REJECTED", "Error code should be USER_REJECTED");
      return true;
    },
    "User rejection should throw USER_REJECTED error"
  );
  console.log("  ✓ USER_REJECTED simulated error correctly handled");

  // Device locked simulation
  provider.setSimulatedError("DEVICE_LOCKED");
  await assert.rejects(
    async () => provider.getPublicKey(0),
    (err: any) => {
      assert.equal(err.code, "DEVICE_LOCKED", "Error code should be DEVICE_LOCKED");
      return true;
    },
    "Device locked should throw DEVICE_LOCKED error"
  );
  console.log("  ✓ DEVICE_LOCKED simulated error correctly handled");

  // Reset simulation
  provider.resetSimulation();

  // Invalid sighash check
  await assert.rejects(
    async () => provider.signTransaction(0, "invalid-sighash"),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError, "Should reject invalid sighash");
      return true;
    },
    "Invalid sighash hex should be rejected"
  );
  console.log("  ✓ Invalid sighash validation correctly enforced");

  // Disconnection behavior
  await provider.disconnect();
  assert.equal(provider.isConnected(), false, "Provider should be disconnected");
  await assert.rejects(
    async () => provider.getPublicKey(0),
    (err: any) => {
      assert.equal(err.code, "DEVICE_NOT_CONNECTED");
      return true;
    },
    "Disconnected provider should reject calls with DEVICE_NOT_CONNECTED"
  );
  console.log("  ✓ Disconnect and disconnected state enforcement verified");
  passedTests++;

  console.log("\n=================================================");
  console.log(`  All ${passedTests} Test Suites Passed Successfully!  `);
  console.log("=================================================\n");
}

runVerification().catch((err) => {
  console.error("\n❌ Verification Failed:", err);
  process.exit(1);
});
