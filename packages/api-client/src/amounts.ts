/**
 * KVNC amount conversion.
 *
 * The node serialises atom amounts as **JSON numbers** (not strings), so every
 * amount that arrives through this client has already passed through an IEEE
 * 754 double. That is lossless only below 2^53-1 = 9_007_199_254_740_991 atoms
 * (≈ 90.07 KVNC *per balance*).
 *
 * It is NOT lossless for cumulative supply figures: MAX_SUPPLY is
 * 9_020_000_000_000_000 atoms, which is **above** 2^53-1, so `max_supply` and
 * anything that can approach it (`native_minted`, `total`, and in principle
 * `burned`) are rounded by the time JavaScript sees them. Do not do supply
 * arithmetic on those fields as parsed numbers — re-read them from the raw
 * response text, or use the `supply-calc_*` tooling which works in atoms.
 *
 * Everything in this module is `bigint`, so once a value is in hand it stays
 * exact. The helpers are strict: they reject a float that may have lost
 * precision rather than silently rounding.
 */

/** 1 KVNC = 100_000_000 atoms (RFC-006). */
export const ATOMS_PER_KVNC = 100_000_000n;

/** Decimal places in a KVNC amount. */
export const DECIMALS = 8;

/** Largest exactly-representable integer in a JSON number. */
export const MAX_SAFE_ATOMS = 9_007_199_254_740_991n;

/** RFC-006 hard cap, in atoms. Exceeds `MAX_SAFE_ATOMS` — read it from raw text. */
export const MAX_SUPPLY_ATOMS = 9_020_000_000_000_000n;

/** RFC-006 hard cap, in whole KVNC. */
export const MAX_SUPPLY_KVNC = 90_200_000n;

const INTEGER_TEXT = /^\d+$/;
const DECIMAL_TEXT = /^\d+(?:\.\d{1,8})?$/;

function fail(what: string, value: unknown): never {
  throw new TypeError(`${what}: expected a non-negative integer amount, got ${String(value)}`);
}

/**
 * Coerce a wire value to exact atoms.
 *
 * Accepts an integer-valued `number`, a decimal `string` of atoms, or a
 * `bigint`. A `number` that is fractional, negative, or above `MAX_SAFE_ATOMS`
 * throws — passing it through would propagate a rounding error that is very
 * hard to trace back to its source.
 */
export function atomsFromWire(value: number | string | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) fail("atomsFromWire", value);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) fail("atomsFromWire", value);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `atomsFromWire: ${value} exceeds the exact JSON integer range ` +
          `(${MAX_SAFE_ATOMS} atoms). Read the field from the raw response text.`,
      );
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!INTEGER_TEXT.test(value)) fail("atomsFromWire", value);
    return BigInt(value);
  }
  return fail("atomsFromWire", value);
}

/**
 * Format atoms as a KVNC decimal string with no trailing zeros.
 *
 * `atomsToKvnc(1n)` → `"0.00000001"`, `atomsToKvnc(100_000_000n)` → `"1"`.
 */
export function atomsToKvnc(atoms: number | string | bigint): string {
  const total = atomsFromWire(atoms);
  const whole = total / ATOMS_PER_KVNC;
  const frac = total % ATOMS_PER_KVNC;
  if (frac === 0n) return whole.toString();
  const digits = frac.toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${digits}`;
}

/**
 * Parse a KVNC decimal string into exact atoms.
 *
 * Rejects more than `DECIMALS` fractional digits rather than rounding, because
 * KVNC has no sub-atom representation to round to.
 */
export function kvncToAtoms(kvnc: string | number | bigint): bigint {
  const text = toDecimalText(kvnc);
  if (!DECIMAL_TEXT.test(text)) {
    throw new TypeError(`kvncToAtoms: expected up to ${DECIMALS} decimal places, got ${text}`);
  }
  const [whole, frac = ""] = text.split(".");
  const padded = frac.padEnd(DECIMALS, "0");
  return BigInt(whole as string) * ATOMS_PER_KVNC + BigInt(padded);
}

/**
 * Format atoms for display, trimming to `maxFractionDigits` (0..8).
 *
 * Truncating is a display choice only; it never affects a signed amount.
 */
export function formatKvnc(
  atoms: number | string | bigint,
  maxFractionDigits: number = DECIMALS,
): string {
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > DECIMALS) {
    throw new RangeError(`formatKvnc: maxFractionDigits must be an integer 0..${DECIMALS}`);
  }
  const text = atomsToKvnc(atoms);
  if (maxFractionDigits === DECIMALS || !text.includes(".")) return text;
  const [whole = "", frac = ""] = text.split(".");
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Normalise a KVNC amount to plain decimal text.
 *
 * `string` is trimmed as-is; `bigint` is exact; `number` goes through
 * {@link numberToDecimalText}, which refuses anything a float64 cannot hold
 * without loss.
 */
function toDecimalText(kvnc: string | number | bigint): string {
  if (typeof kvnc === "bigint") {
    if (kvnc < 0n) throw new RangeError(`kvncToAtoms: negative amount ${kvnc}`);
    return kvnc.toString();
  }
  return typeof kvnc === "number" ? numberToDecimalText(kvnc) : kvnc.trim();
}

/**
 * Render a `number` as plain decimal text without exponent notation.
 *
 * `String(1e21)` is `"1e+21"`, which no amount parser accepts, so large floats
 * have to be expanded before they can be read.
 */
function numberToDecimalText(value: number): string {
  if (!Number.isFinite(value) || value < 0) fail("kvncToAtoms", value);
  const text = String(value);
  if (!text.includes("e") && !text.includes("E")) return text;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `kvncToAtoms: ${value} cannot be represented exactly. Read the field from ` +
        "the raw response text.",
    );
  }
  return BigInt(value).toString();
}