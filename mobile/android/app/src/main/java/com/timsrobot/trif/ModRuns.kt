package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject

/**
 * What runs (docs/MOBILE-BEHAVIOUR.md, Mods and holds): a mod's switch (the whole mod's, or a mod for several sites:
 * its switch on each), the tiers switched off on a site, Pause all, and which mods run on a page (MatchPattern). The
 * phones' shared rule: mobile/shared/core/mod-store.js (TrifCore.modStore: multiSite, isOn, running, off, setOn,
 * setGroup) and core/match.js (TrifCore.match). As on iPhone (ModRuns.swift): a switch's tap calls through
 * (ModStore.setOn / setGroup); `running`, `isOn`, `off` and MatchPattern stay Kotlin twins, held to the same cases
 * (mod-runs-cases.json, ModRunsTest): they're asked on every page load for every mod. Pure: no Android.
 */
object ModRuns {
    /** A mod for several sites (or every site) has a switch per site (desktop's isMultiSite; core multiSite). */
    fun multiSite(everywhere: Boolean, sites: List<String>) = everywhere || sites.map(Site::of).toSet().size > 1

    /** Whether a mod is switched on (for a site: its switch there). The twin of core isOn. */
    fun isOn(m: InstalledMod, site: String?): Boolean {
        if (!m.on) return false
        if (site.isNullOrEmpty()) return true
        return !(m.multiSite && site in m.offSites)
    }

    /** Whether a mod's @match (and @exclude) covers an address. The twin of core match.applies. */
    fun applies(matches: List<String>, excludes: List<String>, u: WebAddress?): Boolean =
        u != null && MatchPattern.any(matches, u) && !MatchPattern.any(excludes, u)

    /** The mods that run on a page: each one's index, and whether the version kept runs (a change waits). The twin of
     *  core running. */
    fun running(mods: List<InstalledMod>, paused: Boolean, groupsOff: Map<String, List<String>>, url: String): List<Pair<Int, Boolean>> {
        if (paused) return emptyList()
        val u = WebAddress.of(url)
        val site = Site.of(u?.host ?: "")
        val tiersOff = groupsOff[site].orEmpty()
        val out = ArrayList<Pair<Int, Boolean>>()
        mods.forEachIndexed { i, m ->
            if (!m.on) return@forEachIndexed
            val held = m.held
            if ((held && m.ran == null) || m.tier in tiersOff || (m.multiSite && site in m.offSites) || !applies(m.matches, m.excludes, u)) return@forEachIndexed
            out += i to (held && m.ran != null)
        }
        return out
    }

    /** The sites a mod's script checks it's off on: its own switch's (a mod for several sites), and its tier's.
     *  Sorted. The twin of core off. */
    fun off(m: InstalledMod, groupsOff: Map<String, List<String>>): List<String> =
        ((if (m.multiSite) m.offSites else emptyList()) + groupsOff.filter { m.tier in it.value }.keys).toSortedSet().toList()

    /** What the rules read of a mod (iPhone's InstalledMod.holdFacts and runFacts). */
    fun facts(m: InstalledMod): JSONObject = JSONObject().put("tier", m.tier).put("site", m.site).put("matches", JSONArray(m.matches))
        .put("needs", JSONArray(m.needs.map(ModNeed::json))).put("extraNeeds", JSONArray(m.extraNeeds.map(ModNeed::json)))
        .put("allowed", JSONObject().apply { m.allowed.forEach { (k, v) -> put(k, JSONArray(v)) } }).put("ran", m.ran != null)
        .put("on", m.on).put("sites", JSONArray(m.sites)).put("offSites", JSONArray(m.offSites)).put("excludes", JSONArray(m.excludes))
}

/**
 * An address as the match rule reads it (core match.js's parts): scheme and host in lower case (a host without its
 * port or an IPv6 host's brackets, as iPhone's URL gives it), the path and "?" + query as written (no fragment).
 * Android's pages arrive already canonical from Chromium (percent-encoded, punycode hosts), so cutting the string is
 * enough here: parsing stays platform.
 */
data class WebAddress(val scheme: String, val host: String, val pathQuery: String) {
    fun json(): JSONObject = JSONObject().put("scheme", scheme).put("host", host).put("path", pathQuery)

    companion object {
        fun of(url: String): WebAddress? {
            val sep = url.indexOf("://").takeIf { it > 0 } ?: return null
            val scheme = url.substring(0, sep).lowercase()
            val rest = url.substring(sep + 3).substringBefore('#')
            val end = rest.indexOfFirst { it == '/' || it == '?' }.let { if (it < 0) rest.length else it }
            var host = rest.substring(0, end).substringAfterLast('@')
            host = if (host.startsWith("[")) host.substring(1).substringBefore(']') else host.substringBefore(':')
            val pq = rest.substring(end)
            return WebAddress(scheme, host.lowercase(), if (pq.startsWith("/")) pq else "/$pq")
        }
    }
}

/** Chrome-style match patterns (https://x.com/ and any path, any scheme on x.com and under it, <all_urls>), as
 *  modfile.js matchesUrl tests them. The twin of core match.js (one, any). */
object MatchPattern {
    fun any(patterns: List<String>, url: String): Boolean = any(patterns, WebAddress.of(url))
    fun any(patterns: List<String>, u: WebAddress?): Boolean = u != null && patterns.any { one(it, u) }

    /** <all_urls> any http(s) page; scheme `*` http or https only, else http or https exactly (as written); host `*`
     *  any, a leading `*.` the base itself or under it, else exactly (any case; another `*` or a port covers nothing);
     *  the path a whole-string glob over path and query. */
    fun one(p: String, u: WebAddress): Boolean {
        val web = u.scheme == "http" || u.scheme == "https"
        if (p == "<all_urls>") return web
        val sep = p.indexOf("://").takeIf { it >= 0 } ?: return false
        val ps = p.substring(0, sep)
        val rest = p.substring(sep + 3)
        val slash = rest.indexOf('/').takeIf { it >= 0 } ?: return false
        val ph = rest.substring(0, slash).lowercase()
        val path = rest.substring(slash)
        if (ps == "*") { if (!web) return false } else if (ps != u.scheme || !(ps == "http" || ps == "https")) return false
        if (ph != "*") {
            if (ph.startsWith("*.")) { val base = ph.substring(2); if (u.host != base && !u.host.endsWith(".$base")) return false }
            else if ('*' in ph || u.host != ph) return false
        }
        return glob(path, u.pathQuery)
    }

    /** A whole-string glob: `*` any run of characters (line breaks too), anything else itself (UTF-16 units). */
    fun glob(pat: String, s: String): Boolean {
        val parts = pat.split('*')
        if (parts.size == 1) return pat == s
        val first = parts[0]; val last = parts[parts.size - 1]
        if (s.length < first.length + last.length || !s.startsWith(first) || !s.endsWith(last)) return false
        var at = first.length
        val end = s.length - last.length
        for (i in 1 until parts.size - 1) {
            val j = s.indexOf(parts[i], at)
            if (j < 0 || j + parts[i].length > end) return false
            at = j + parts[i].length
        }
        return true
    }
}
