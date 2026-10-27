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
  parseAccountOrPath,
  validateSighash,
  KOVANICA_COIN_TYPE,
  HardwareWalletError,
} from "../src/lib/wallet/hardware/index.ts";
import { hexToKvnc, parseAddr, isAddr } from "../src/lib/wallet/address.ts";
import { MIN_FEE } from "../src/lib/networkConstants";
import {
  localReset,
  localFaucet,
  localPrepare,
  localSubmit,
  localProduce,
  localUtxos,
  localHistory,
} from "../src/lib/api/node.server.ts";

ed.hashes.sha512 = sha512;

async function runE2EHardwareChallenge() {
  console.log("================================================================================");
  console.log("  CHALLENGER 2: End-to-End Integration & Adversarial Test Suite for Hardware Wallet");
  console.log("================================================================================\n");

  let suitesPassed = 0;
  let assertionsCount = 0;

  function countAssert(fn: () => void) {
    fn();
    assertionsCount++;
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: MockHardwareProvider Lifecycle, Derivation & Encoding
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("[SUITE 1] MockHardwareProvider Connection, BIP-44 Derivation & Address Encoding");
  console.log("--------------------------------------------------------------------------------");

  const provider = new MockHardwareProvider();
  countAssert(() => assert.equal(provider.isConnected(), false, "Provider must start disconnected"));
  countAssert(() => assert.equal(provider.getDeviceInfo(), null, "Device info must start null"));

  const connectInfo = await provider.connect();
  countAssert(() => assert.equal(provider.isConnected(), true, "Provider must be connected"));
  countAssert(() => assert.equal(connectInfo.type, "mock", "Device type must be 'mock'"));
  countAssert(() => assert.equal(connectInfo.connected, true, "Device info connected flag must be true"));
  countAssert(() => assert.ok(connectInfo.model?.length, "Device model string must be populated"));

  // Verify accounts 0, 1, and 2
  const acc0 = await provider.getPublicKey(0);
  const acc1 = await provider.getPublicKey(1);
  const acc2 = await provider.getPublicKey(2);

  countAssert(() => assert.equal(acc0.path, `m/44'/${KOVANICA_COIN_TYPE}'/0'/0/0`));
  countAssert(() => assert.equal(acc1.path, `m/44'/${KOVANICA_COIN_TYPE}'/1'/0/0`));
  countAssert(() => assert.equal(acc2.path, `m/44'/${KOVANICA_COIN_TYPE}'/2'/0/0`));

  countAssert(() => assert.match(acc0.publicKey, /^[0-9a-f]{64}$/, "Acc 0 pubkey must be 64 lowercase hex chars"));
  countAssert(() => assert.match(acc1.publicKey, /^[0-9a-f]{64}$/, "Acc 1 pubkey must be 64 lowercase hex chars"));
  countAssert(() => assert.match(acc2.publicKey, /^[0-9a-f]{64}$/, "Acc 2 pubkey must be 64 lowercase hex chars"));

  // Check multi-account uniqueness
  countAssert(() => assert.notEqual(acc0.publicKey, acc1.publicKey, "Acc 0 and Acc 1 must have distinct pubkeys"));
  countAssert(() => assert.notEqual(acc1.publicKey, acc2.publicKey, "Acc 1 and Acc 2 must have distinct pubkeys"));

  // Check address encoding
  const acc0Kvnc = hexToKvnc(acc0.address);
  const acc1Kvnc = hexToKvnc(acc1.address);
  countAssert(() => assert.ok(acc0Kvnc.startsWith("kvnc") && acc0Kvnc.endsWith("dag"), "kvnc...dag format"));
  countAssert(() => assert.equal(parseAddr(acc0Kvnc), parseAddr(acc0.address), "parseAddr(hexToKvnc(addr)) == parseAddr(addr)"));
  countAssert(() => assert.equal(parseAddr(acc0.address), `00${acc0.address}`, "parseAddr(rawHex) == versioned 66-hex"));
  countAssert(() => assert.equal(isAddr(acc0.address), true, "isAddr(rawHex) == true"));
  countAssert(() => assert.equal(isAddr(acc0Kvnc), true, "isAddr(kvnc...dag) == true"));

  console.log(`  ✓ Account 0: Path=${acc0.path} Pubkey=${acc0.publicKey.slice(0, 16)}...`);
  console.log(`  ✓ Account 1: Path=${acc1.path} Pubkey=${acc1.publicKey.slice(0, 16)}...`);
  console.log(`  ✓ Account 2: Path=${acc2.path} Pubkey=${acc2.publicKey.slice(0, 16)}...`);
  console.log("  ✓ Suite 1 passed.\n");
  suitesPassed++;

  // ---------------------------------------------------------------------------
  // SECTION 2: Full End-to-End Transaction Flow (Prepare -> Sign -> Submit -> Produce)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("[SUITE 2] End-to-End Flow: localFaucet -> localPrepare -> HW Sign -> localSubmit -> localProduce");
  console.log("--------------------------------------------------------------------------------");

  localReset();

  const initialAmount = 100_000_000; // 1 KVNC
  const sendAmount = 40_000_000;     // 0.4 KVNC
  const expectedFee = MIN_FEE;       // RFC-006 fee floor: max(1, subsidy / 500_000)

  // Step 1: Fund Account 0
  const faucetRes = localFaucet(acc0.address, String(initialAmount));
  countAssert(() => assert.equal(typeof faucetRes === "object" && (faucetRes as any).ok, true, "Faucet must succeed"));

  const utxosBefore = localUtxos(acc0.address);
  countAssert(() => assert.equal(typeof utxosBefore === "object" && (utxosBefore as any).balance, initialAmount, "Account 0 funded"));

  // Step 2: Prepare transaction from Account 0 -> Account 1
  const prep = localPrepare(acc0.address, acc1.address, String(sendAmount));
  countAssert(() => assert.equal(typeof prep === "object" && (prep as any).ok, true, "localPrepare must return success"));
  if (typeof prep === "string") throw new Error(`localPrepare failed: ${prep}`);

  countAssert(() => assert.match(prep.sighash, /^[0-9a-f]{64}$/, "Sighash must be 64-hex string (32 bytes)"));
  countAssert(() => assert.equal(prep.fee, expectedFee, `Fee must be MIN_FEE (${MIN_FEE} atoms)`));
  countAssert(() => assert.equal(prep.change, initialAmount - sendAmount - expectedFee, "Change calculation matches"));
  console.log(`  ✓ Transaction prepared: sighash = ${prep.sighash}`);

  // Step 3: Sign sighash with MockHardwareProvider for Account 0
  const statusUpdates: string[] = [];
  const signResult = await provider.signTransaction(0, prep.sighash, {
    onStatusChange: (s) => statusUpdates.push(s),
  });

  countAssert(() => assert.equal(signResult.sighash, prep.sighash, "Sign result must match prepared sighash"));
  countAssert(() => assert.equal(signResult.path, acc0.path, "Sign result must return account 0 path"));
  countAssert(() => assert.match(signResult.signature, /^[0-9a-f]{128}$/, "Signature must be 128 lowercase hex (64 bytes)"));
  countAssert(() => assert.ok(statusUpdates.length >= 2, "Status callbacks must be invoked"));
  console.log(`  ✓ Hardware signed: signature = ${signResult.signature.slice(0, 32)}...`);

  // Step 4: Cryptographic Verification via @noble/ed25519.verify()
  const isSigValid = ed.verify(
    hexToBytes(signResult.signature),
    hexToBytes(prep.sighash),
    hexToBytes(acc0.publicKey)
  );
  countAssert(() => assert.equal(isSigValid, true, "Ed25519 signature verification MUST pass against Account 0 pubkey"));
  console.log("  ✓ Cryptographic verification @noble/ed25519.verify() PASSED");

  // Step 5: Submit transaction to localSubmit
  const submitRes = localSubmit(acc0.address, acc1.address, String(sendAmount), signResult.signature);
  countAssert(() => assert.equal(typeof submitRes === "object" && (submitRes as any).ok, true, "localSubmit must succeed"));
  if (typeof submitRes === "string") throw new Error(`localSubmit failed: ${submitRes}`);
  console.log(`  ✓ Transaction submitted to mempool: tx id = ${(submitRes as any).tx}`);

  // Step 6: Produce block to mine the pending mempool transaction
  const produceRes = localProduce();
  countAssert(() => assert.equal(typeof produceRes === "object" && (produceRes as any).ok, true, "localProduce must mine block"));

  // Step 7: Verify updated balances and history
  const acc0UtxosAfter = localUtxos(acc0.address);
  const acc1UtxosAfter = localUtxos(acc1.address);
  countAssert(() => assert.equal((acc0UtxosAfter as any).balance, initialAmount - sendAmount - expectedFee, "Account 0 balance reduced"));
  countAssert(() => assert.equal((acc1UtxosAfter as any).balance, sendAmount, "Account 1 received transferred amount"));

  const hist0 = localHistory(acc0.address);
  const hist1 = localHistory(acc1.address);
  countAssert(() => assert.ok(Array.isArray((hist0 as any).txs) && (hist0 as any).txs.length >= 2, "Account 0 has faucet + out txs"));
  countAssert(() => assert.ok(Array.isArray((hist1 as any).txs) && (hist1 as any).txs.length >= 1, "Account 1 has in tx"));
  console.log(`  ✓ Balances verified: Acc 0 = ${(acc0UtxosAfter as any).balance}, Acc 1 = ${(acc1UtxosAfter as any).balance}`);
  console.log("  ✓ Suite 2 passed.\n");
  suitesPassed++;

  // ---------------------------------------------------------------------------
  // SECTION 3: Multi-Hop Hardware Chained Transfer (Account 1 -> Account 2)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("[SUITE 3] Chained Multi-Hop Transfer: Account 1 signs and spends to Account 2");
  console.log("--------------------------------------------------------------------------------");

  const transfer2Amount = 15_000_000;
  const prep2 = localPrepare(acc1.address, acc2.address, String(transfer2Amount));
  countAssert(() => assert.equal(typeof prep2 === "object" && (prep2 as any).ok, true, "Account 1 localPrepare must succeed"));
  if (typeof prep2 === "string") throw new Error(`prep2 failed: ${prep2}`);

  // Account 1 signs via hardware provider
  const signResult2 = await provider.signTransaction(1, prep2.sighash);
  countAssert(() => assert.equal(signResult2.path, acc1.path, "Sign result matches Account 1 path"));

  // Verify Account 1 signature
  const isSig2Valid = ed.verify(
    hexToBytes(signResult2.signature),
    hexToBytes(prep2.sighash),
    hexToBytes(acc1.publicKey)
  );
  countAssert(() => assert.equal(isSig2Valid, true, "Account 1 signature cryptographically valid"));

  // Submit and produce
  const submitRes2 = localSubmit(acc1.address, acc2.address, String(transfer2Amount), signResult2.signature);
  countAssert(() => assert.equal(typeof submitRes2 === "object" && (submitRes2 as any).ok, true, "Account 1 submit succeeds"));
  const produceRes2 = localProduce();
  countAssert(() => assert.equal(typeof produceRes2 === "object" && (produceRes2 as any).ok, true, "produce block succeeds"));

  const acc1BalanceFinal = (localUtxos(acc1.address) as any).balance;
  const acc2BalanceFinal = (localUtxos(acc2.address) as any).balance;
  countAssert(() => assert.equal(acc1BalanceFinal, sendAmount - transfer2Amount - expectedFee, "Acc 1 balance correctly decremented"));
  countAssert(() => assert.equal(acc2BalanceFinal, transfer2Amount, "Acc 2 balance correctly credited"));
  console.log(`  ✓ Chained transaction confirmed: Acc 1 = ${acc1BalanceFinal}, Acc 2 = ${acc2BalanceFinal}`);
  console.log("  ✓ Suite 3 passed.\n");
  suitesPassed++;

  // ---------------------------------------------------------------------------
  // SECTION 4: Adversarial Tamper & Mutation Challenge (Cryptographic & Protocol)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("[SUITE 4] Adversarial Tamper & Mutation Tests");
  console.log("--------------------------------------------------------------------------------");

  // Attack 1: Mutated Signature Bytes (Bit-flip in 128-hex signature)
  const validSig = signResult.signature;
  const tamperedSigByte0 = (validSig[0] === "a" ? "b" : "a") + validSig.slice(1);
  const tamperedSigByteLast = validSig.slice(0, -1) + (validSig.slice(-1) === "0" ? "1" : "0");
  const tamperedSigMid = validSig.slice(0, 64) + (validSig[64] === "f" ? "0" : "f") + validSig.slice(65);

  countAssert(() => assert.equal(
    ed.verify(hexToBytes(tamperedSigByte0), hexToBytes(prep.sighash), hexToBytes(acc0.publicKey)),
    false,
    "Tampered byte 0 in signature MUST fail cryptographic verification"
  ));
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(tamperedSigByteLast), hexToBytes(prep.sighash), hexToBytes(acc0.publicKey)),
    false,
    "Tampered last byte in signature MUST fail cryptographic verification"
  ));
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(tamperedSigMid), hexToBytes(prep.sighash), hexToBytes(acc0.publicKey)),
    false,
    "Tampered middle byte in signature MUST fail cryptographic verification"
  ));
  console.log("  ✓ Attack 1 (Mutated Signature): Cryptographic verifier reliably rejected all tampered signatures");

  // Attack 2: Mutated Sighash (Altered Transaction Payload / Amount / Recipient)
  const tamperedSighash1 = prep.sighash.slice(0, -2) + (prep.sighash.slice(-2) === "00" ? "11" : "00");
  const tamperedSighash2 = "00".repeat(32);
  const tamperedSighash3 = "ff".repeat(32);

  countAssert(() => assert.equal(
    ed.verify(hexToBytes(validSig), hexToBytes(tamperedSighash1), hexToBytes(acc0.publicKey)),
    false,
    "Altered sighash 1 MUST fail verification against original signature"
  ));
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(validSig), hexToBytes(tamperedSighash2), hexToBytes(acc0.publicKey)),
    false,
    "Zeroed sighash MUST fail verification against original signature"
  ));
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(validSig), hexToBytes(tamperedSighash3), hexToBytes(acc0.publicKey)),
    false,
    "All-0xFF sighash MUST fail verification against original signature"
  ));
  console.log("  ✓ Attack 2 (Mutated Sighash): Cryptographic verifier rejected all altered payloads");

  // Attack 3: Public Key Impersonation / Substitution
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(validSig), hexToBytes(prep.sighash), hexToBytes(acc1.publicKey)),
    false,
    "Account 0 signature MUST NOT verify against Account 1 public key"
  ));
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(validSig), hexToBytes(prep.sighash), hexToBytes(acc2.publicKey)),
    false,
    "Account 0 signature MUST NOT verify against Account 2 public key"
  ));
  console.log("  ✓ Attack 3 (Key Confusion): Cross-account public key verification rejected");

  // Attack 4: Cross-Account Signature Substitution
  const acc1SignedAcc0Sighash = await provider.signTransaction(1, prep.sighash);
  countAssert(() => assert.equal(
    ed.verify(hexToBytes(acc1SignedAcc0Sighash.signature), hexToBytes(prep.sighash), hexToBytes(acc0.publicKey)),
    false,
    "Account 1 signing Account 0's sighash MUST NOT verify under Account 0's pubkey"
  ));
  console.log("  ✓ Attack 4 (Cross-Account Signing): Signatures from other accounts cannot authorize Account 0 transactions");

  // Attack 5: Node / localSubmit Format Checks & Boundary Enforcement
  const invalidSigTooShort = validSig.slice(0, 126); // 63 bytes
  const invalidSigTooLong = validSig + "00";         // 65 bytes
  const invalidSigNonHex = "x".repeat(128);          // Non-hex chars
  const invalidSigEmpty = "";

  countAssert(() => assert.equal(
    localSubmit(acc0.address, acc1.address, "1000", invalidSigTooShort),
    "sig must be 64 bytes",
    "localSubmit rejects 63-byte signature"
  ));
  countAssert(() => assert.equal(
    localSubmit(acc0.address, acc1.address, "1000", invalidSigTooLong),
    "sig must be 64 bytes",
    "localSubmit rejects 65-byte signature"
  ));
  countAssert(() => assert.equal(
    localSubmit(acc0.address, acc1.address, "1000", invalidSigNonHex),
    "sig must be 64 bytes",
    "localSubmit rejects non-hex signature"
  ));
  countAssert(() => assert.equal(
    localSubmit(acc0.address, acc1.address, "1000", invalidSigEmpty),
    "sig must be 64 bytes",
    "localSubmit rejects empty signature"
  ));
  countAssert(() => assert.equal(
    localSubmit(acc0.address, acc1.address, "1000", null),
    "sig must be 64 bytes",
    "localSubmit rejects null signature"
  ));
  console.log("  ✓ Attack 5 (Malformed Submissions): localSubmit rejects malformed signature formats");

  // Attack 6: Invalid / Insufficient balance & address parameters in localPrepare
  countAssert(() => assert.equal(
    localPrepare(null, acc1.address, "1000"),
    "from address required",
    "localPrepare requires from address"
  ));
  countAssert(() => assert.equal(
    localPrepare(acc0.address, null, "1000"),
    "to address required",
    "localPrepare requires to address"
  ));
  countAssert(() => assert.equal(
    localPrepare(acc0.address, acc1.address, "0"),
    "amount required",
    "localPrepare requires positive amount"
  ));
  countAssert(() => assert.equal(
    localPrepare(acc0.address, acc1.address, "-500"),
    "amount required",
    "localPrepare rejects negative amount"
  ));
  countAssert(() => assert.equal(
    localPrepare(acc0.address, acc1.address, "9999999999999"),
    "insufficient balance",
    "localPrepare rejects spending more than available balance"
  ));
  console.log("  ✓ Attack 6 (Parameter Validation): localPrepare enforces address & balance invariants");
  console.log("  ✓ Suite 4 passed.\n");
  suitesPassed++;

  // ---------------------------------------------------------------------------
  // SECTION 5: Provider Error Modes, Status Callbacks, Delays & Simulation
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("[SUITE 5] Hardware Provider Error Simulation & Fault Injection");
  console.log("--------------------------------------------------------------------------------");

  // Test USER_REJECTED
  provider.setSimulatedError("USER_REJECTED");
  await assert.rejects(
    async () => provider.signTransaction(0, prep.sighash),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "USER_REJECTED");
      assert.equal(err.deviceType, "mock");
      return true;
    },
    "USER_REJECTED error code thrown on rejection"
  );
  countAssert(() => {});

  // Test DEVICE_LOCKED
  provider.setSimulatedError("DEVICE_LOCKED");
  await assert.rejects(
    async () => provider.getPublicKey(0),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "DEVICE_LOCKED");
      return true;
    }
  );
  countAssert(() => {});

  // Test APP_NOT_OPEN
  provider.setSimulatedError("APP_NOT_OPEN");
  await assert.rejects(
    async () => provider.signTransaction(0, prep.sighash),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "APP_NOT_OPEN");
      return true;
    }
  );
  countAssert(() => {});

  // Test TIMEOUT
  provider.setSimulatedError("TIMEOUT");
  await assert.rejects(
    async () => provider.signTransaction(0, prep.sighash),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "TIMEOUT");
      return true;
    }
  );
  countAssert(() => {});

  provider.resetSimulation();

  // Test Simulated Latency
  provider.setSimulatedDelay(50);
  const tStart = Date.now();
  await provider.signTransaction(0, prep.sighash);
  const elapsed = Date.now() - tStart;
  countAssert(() => assert.ok(elapsed >= 40, `Simulated delay must take at least 40ms (took ${elapsed}ms)`));
  provider.resetSimulation();

  // Test Disconnection Guards
  await provider.disconnect();
  countAssert(() => assert.equal(provider.isConnected(), false));
  await assert.rejects(
    async () => provider.getPublicKey(0),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "DEVICE_NOT_CONNECTED");
      return true;
    }
  );
  countAssert(() => {});

  await assert.rejects(
    async () => provider.signTransaction(0, prep.sighash),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "DEVICE_NOT_CONNECTED");
      return true;
    }
  );
  countAssert(() => {});

  // Test Invalid Sighash Formats on Connected Provider
  await provider.connect();
  await assert.rejects(
    async () => provider.signTransaction(0, "abc"),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      assert.equal(err.code, "UNKNOWN");
      return true;
    }
  );
  countAssert(() => {});

  await assert.rejects(
    async () => provider.signTransaction(0, "g".repeat(64)),
    (err: any) => {
      assert.ok(err instanceof HardwareWalletError);
      return true;
    }
  );
  countAssert(() => {});

  // Test validateSighash direct helper
  countAssert(() => assert.throws(() => validateSighash("not-a-sighash"), /Invalid sighash format/));
  countAssert(() => assert.equal(validateSighash(prep.sighash).length, 32));

  // Test parseAccountOrPath helper
  const parsed0 = parseAccountOrPath(0);
  const parsedStr = parseAccountOrPath("m/44'/3007'/7'/0/0");
  const parsedBare = parseAccountOrPath("44'/3007'/12'/0/0");
  countAssert(() => assert.equal(parsed0.accountIndex, 0));
  countAssert(() => assert.equal(parsed0.path, "m/44'/3007'/0'/0/0"));
  countAssert(() => assert.equal(parsedStr.accountIndex, 7));
  countAssert(() => assert.equal(parsedStr.path, "m/44'/3007'/7'/0/0"));
  countAssert(() => assert.equal(parsedBare.accountIndex, 12));
  countAssert(() => assert.equal(parsedBare.path, "m/44'/3007'/12'/0/0"));

  console.log("  ✓ Suite 5 passed.\n");
  suitesPassed++;

  console.log("================================================================================");
  console.log(`  ALL ${suitesPassed} TEST SUITES PASSED! (${assertionsCount} assertions verified)`);
  console.log("================================================================================\n");
}

runE2EHardwareChallenge().catch((err) => {
  console.error("\n❌ E2E HARDWARE CHALLENGE FAILED:", err);
  process.exit(1);
});
