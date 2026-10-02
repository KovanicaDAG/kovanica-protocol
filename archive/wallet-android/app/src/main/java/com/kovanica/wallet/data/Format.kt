package com.kovanica.wallet.data

import com.kovanica.wallet.model.ATOM
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Format an atom amount as a human KVNC string.
 * 1 KVNC = 100,000,000 atoms (8 decimals).
 */
internal fun formatKvnc(atoms: Long, withSymbol: Boolean = true): String {
    val kvnc = BigDecimal(atoms)
        .divide(BigDecimal(ATOM.toString()), 8, RoundingMode.HALF_UP)
        .stripTrailingZeros()
        .toPlainString()
    return if (withSymbol) "$kvnc KVNC" else kvnc
}

internal fun formatBalance(atoms: Long): String = formatKvnc(atoms)
