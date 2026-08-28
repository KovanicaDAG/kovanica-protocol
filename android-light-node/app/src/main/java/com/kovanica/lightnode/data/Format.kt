package com.kovanica.lightnode.data

import java.math.BigDecimal
import java.math.RoundingMode

private const val ATOM: ULong = 100_000_000uL

/**
 * Format an atom decimal string as a KVNC human string.
 * 1 KVNC = 100_000_000 atoms.
 */
internal fun formatKvnc(atoms: String): String {
    val atomDecimal = BigDecimal(atoms)
    val kvnc = atomDecimal.divide(BigDecimal(ATOM.toString()), 8, RoundingMode.HALF_UP)
    val plain = kvnc.stripTrailingZeros().toPlainString()
    return "$plain KVNC"
}
