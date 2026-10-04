/**
 * Amount conversion is the one place where this client could silently corrupt
 * value, because the node sends atom amounts as JSON numbers. These tests pin
 * the exact conversions and, just as importantly, the refusals: a float that
 * may have lost precision must throw, never round.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATOMS_PER_KVNC,
  MAX_SAFE_ATOMS,
  MAX_SUPPLY_ATOMS,
  MAX_SUPPLY_KVNC,
  atomsFromWire,
  atomsToKvnc,
  formatKvnc,
  kvncToAtoms,
} from "../src/amounts.ts";

describe("constants", () => {
  it("matches RFC-006", () => {
    assert.equal(ATOMS_PER_KVNC, 100_000_000n);
    assert.equal(MAX_SUPPLY_ATOMS, 9_020_000_000_000_000n);
    assert.equal(MAX_SUPPLY_KVNC, 90_200_000n);
    assert.equal(kvncToAtoms(MAX_SUPPLY_KVNC), MAX_SUPPLY_ATOMS);
  });

  it("records that MAX_SUPPLY is NOT safe as a JSON number", () => {
    // If this ever flips, the amount docs need revisiting: today supply figures
    // have to be read from the raw response text, not from parsed JSON.
    assert.equal(Number.isSafeInteger(Number(MAX_SUPPLY_ATOMS)), false);
    assert.equal(Number.isSafeInteger(Number(MAX_SAFE_ATOMS)), true);
  });
});

describe("atomsFromWire", () => {
  it("accepts exact integers and decimal strings", () => {
    assert.equal(atomsFromWire(0), 0n);
    assert.equal(atomsFromWire(42), 42n);
    assert.equal(atomsFromWire("9020000000000000"), 9_020_000_000_000_000n);
    assert.equal(atomsFromWire(7n), 7n);
  });

  it("refuses a float that may have lost precision", () => {
    assert.throws(() => atomsFromWire(Number(MAX_SAFE_ATOMS) + 2), /exact JSON integer range/);
  });

  it("refuses fractional, negative, and malformed values", () => {
    assert.throws(() => atomsFromWire(1.5), TypeError);
    assert.throws(() => atomsFromWire(-1), TypeError);
    assert.throws(() => atomsFromWire("1.5"), TypeError);
    assert.throws(() => atomsFromWire("-1"), TypeError);
    assert.throws(() => atomsFromWire("12a"), TypeError);
  });
});

describe("atomsToKvnc", () => {
  it("drops trailing zeros but keeps significant digits", () => {
    assert.equal(atomsToKvnc(0n), "0");
    assert.equal(atomsToKvnc(100_000_000n), "1");
    assert.equal(atomsToKvnc(150_000_000n), "1.5");
    assert.equal(atomsToKvnc(1n), "0.00000001");
    assert.equal(atomsToKvnc(12_345_678n), "0.12345678");
  });

  it("round-trips every KVNC boundary", () => {
    for (const kvnc of ["0", "1", "1.5", "0.00000001", "90.2", "90200000"]) {
      assert.equal(atomsToKvnc(kvncToAtoms(kvnc)), kvnc, kvnc);
    }
  });

  it("handles the full cap exactly", () => {
    assert.equal(atomsToKvnc(kvncToAtoms(MAX_SUPPLY_KVNC)), "90200000");
    // And from the wire side: the cap in atoms stays exact as a bigint.
    assert.equal(atomsFromWire(MAX_SUPPLY_ATOMS.toString()), MAX_SUPPLY_ATOMS);
  });
});

describe("kvncToAtoms", () => {
  it("pads short fractions and accepts numbers", () => {
    assert.equal(kvncToAtoms("0.5"), 50_000_000n);
    assert.equal(kvncToAtoms("0.0000001"), 10n);
    assert.equal(kvncToAtoms(1), 100_000_000n);
    assert.equal(kvncToAtoms("  2.25  "), 225_000_000n);
  });

  it("refuses sub-atom precision rather than rounding it away", () => {
    assert.throws(() => kvncToAtoms("0.000000001"), TypeError);
    assert.throws(() => kvncToAtoms("abc"), TypeError);
    assert.throws(() => kvncToAtoms(""), TypeError);
  });

  it("refuses an inexact float instead of trusting it", () => {
    assert.throws(() => kvncToAtoms(1e21), /cannot be represented exactly/);
  });
});

describe("formatKvnc", () => {
  it("truncates to the requested display precision", () => {
    assert.equal(formatKvnc(12_345_678n), "0.12345678");
    assert.equal(formatKvnc(12_345_678n, 4), "0.1234");
    assert.equal(formatKvnc(12_345_678n, 2), "0.12");
    assert.equal(formatKvnc(12_345_678n, 0), "0");
    assert.equal(formatKvnc(100_000_000n, 0), "1");
  });

  it("rejects a precision outside 0..8", () => {
    assert.throws(() => formatKvnc(1n, 9), RangeError);
    assert.throws(() => formatKvnc(1n, -1), RangeError);
    assert.throws(() => formatKvnc(1n, 1.5), RangeError);
  });
});