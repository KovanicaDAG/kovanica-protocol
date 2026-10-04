package com.kovanica.wallet.util

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Exact conversion between KVNC and atoms.
 *
 * The chain's smallest unit is the atom and 1 KVNC is 100,000,000 atoms, so
 * there are exactly 8 decimal places of precision. Every input the user can
 * type is parsed as a decimal — never as a [Double] — because binary floating
 * point cannot represent values like `0.1` exactly and a wallet must not
 * round a balance in either direction.
 */
object Kvnc {

    /** Atoms per KVNC. Identical to `ATOM` in the node's RFC-006 parameters. */
    const val ATOMS_PER_KVNC = 100_000_000L

    /** Decimal places in a KVNC amount: 10^8 atoms = 1 KVNC. */
    const val KVNC_DECIMALS = 8

    /** Largest amount the chain can express, in atoms (MAX_SUPPLY is smaller). */
    private val MAX_ATOMS = BigDecimal.valueOf(Long.MAX_VALUE)

    /**
     * Parse a user-entered KVNC amount into atoms.
     *
     * Returns `null` — never a partial or rounded value — when the text is
     * blank, not a decimal number, negative, finer than one atom, or larger
     * than [Long.MAX_VALUE] atoms. Callers must treat `null` as a validation
     * error; silently substituting `0` here is what let a 1.5 KVNC send go out
     * as a 1-atom transaction.
     */
    fun parseToAtoms(input: String): Long? {
        val text = input.trim()
        if (text.isEmpty()) return null

        val amount = text.toBigDecimalOrNull() ?: return null
        if (amount.signum() < 0) return null

        // UNNECESSARY throws rather than rounding, so an amount that is not a
        // whole number of atoms is rejected instead of quietly losing value.
        val atoms = try {
            amount
                .setScale(KVNC_DECIMALS, RoundingMode.UNNECESSARY)
                .movePointRight(KVNC_DECIMALS)
        } catch (_: ArithmeticException) {
            return null
        }

        if (atoms > MAX_ATOMS) return null
        return atoms.toLong()
    }

    /**
     * Render atoms as a KVNC decimal string for display, e.g. `150000000`
     * becomes `"1.5"`. Trailing zeros in the fraction are trimmed; an exact
     * whole amount renders without a decimal point at all.
     */
    fun formatFromAtoms(atoms: Long): String {
        val kvnc = BigDecimal(atoms)
            .movePointLeft(KVNC_DECIMALS)
            .stripTrailingZeros()
        return if (kvnc.scale() <= 0) kvnc.toBigInteger().toString()
        else kvnc.toPlainString()
    }
}
