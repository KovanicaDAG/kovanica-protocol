package com.kovanica.lightnode.ui.util

import java.math.BigInteger

/**
 * Kovanica uses the same Base58 alphabet as Bitcoin for the human-readable
 * `kvnc…dag` address form. No checksum is appended — the address bytes are
 * encoded directly.
 */
object Base58 {
    private const val ALPHABET =
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    fun encode(data: ByteArray): String {
        if (data.isEmpty()) return ""
        val leadingZeros = data.indexOfFirst { it != 0.toByte() }
            .let { if (it == -1) data.size else it }

        val number = BigInteger(1, data)
        if (number == BigInteger.ZERO) {
            return ALPHABET[0].toString().repeat(data.size)
        }

        val sb = StringBuilder()
        var remaining = number
        val base = BigInteger.valueOf(58)
        while (remaining > BigInteger.ZERO) {
            val rem = remaining.mod(base).toInt()
            sb.append(ALPHABET[rem])
            remaining = remaining.divide(base)
        }
        sb.reverse()
        return "1".repeat(leadingZeros) + sb.toString()
    }
}
