package com.kovanica.lightnode.data

object Format {
    private const val ATOM = 100_000_000L

    /** Format atoms as KVNC with 8 decimals */
    fun atomsToKvnc(atoms: Long): String {
        val whole = atoms / ATOM
        val frac = atoms % ATOM
        return if (frac == 0L) {
            whole.toString()
        } else {
            "$whole.${frac.toString().padStart(8, '0').removeSuffix("0")}"
        }
    }

    /** Parse KVNC string to atoms (supports up to 8 decimals) */
    fun kvncToAtoms(kvnc: String): Long? {
        return try {
            val parts = kvnc.split(".")
            val whole = parts[0].toLong()
            val frac = if (parts.size > 1) {
                parts[1].padEnd(8, '0').take(8).toLong()
            } else 0L
            whole * ATOM + frac
        } catch (e: Exception) {
            null
        }
    }

    /** Short address for display (first 8 + last 8) */
    fun shortAddress(address: String): String {
        if (address.length <= 20) return address
        return "${address.substring(0, 12)}…${address.substring(address.length - 8)}"
    }
}