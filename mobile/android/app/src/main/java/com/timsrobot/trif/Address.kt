package com.timsrobot.trif

import java.net.URLEncoder

/** What the address field's text means (the iPhone's Browser.address(for:), Tim 11-15, as Chrome). */
object Address {
    private val scheme = Regex("^[a-z][a-z0-9+.-]*://")
    private val port = Regex(":\\d+$")
    private val ipv4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

    /**
     * A search on Google when it has a space, or no dot and isn't localhost or an IP address; otherwise an address,
     * https:// added when it has no scheme (http:// for localhost). Null for nothing typed.
     */
    fun resolve(text: String): String? {
        val entry = text.trim()
        if (entry.isEmpty()) return null
        val lower = entry.lowercase()
        if (scheme.containsMatchIn(lower)) return entry
        if (listOf("about:", "data:", "trif:").any { lower.startsWith(it) }) return entry
        val host = lower.substringBefore('/').replace(port, "")
        val local = host == "localhost" || host.endsWith(".localhost")
        val ip = ipv4.matches(host) || host.startsWith("[")
        if (entry.contains(' ') || (!entry.contains('.') && !local && !ip)) {
            return "https://www.google.com/search?q=" + URLEncoder.encode(entry, "UTF-8").replace("+", "%20")
        }
        return (if (local) "http://" else "https://") + entry
    }
}
