package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject

// An installed mod as the iPhone app keeps one (Mods.swift InstalledMod and its parts), the same fields under the same
// JSON keys, so the two apps' files read alike. Times are epoch milliseconds (iPhone: Swift Dates). Pure: no Android.

/** What a mod needs the person's OK for (modfile.js needsOf): a key, the fact shown, the power, the lines it covers. */
data class ModNeed(val key: String, val fact: String, val power: String? = null, val lines: List<String>? = null) {
    fun json() = JSONObject().put("key", key).put("fact", fact).apply {
        power?.let { put("power", it) }; lines?.let { put("lines", JSONArray(it)) }
    }
    companion object {
        fun of(o: JSONObject) = ModNeed(o.optString("key"), o.optString("fact"), o.str("power"), o.optJSONArray("lines")?.strings())
    }
}

data class PowerFact(val power: String, val fact: String)
data class ModRisk(val tier: Int, val why: String? = null)

/** An earlier version, in History: stamp (its id), when, its file, how it came (chat, import, edit, undo, restore…). */
data class ModVersion(val stamp: String, val at: Long, val code: String, val source: String)

/** While a change waits for the person's OK: the version that last ran, which keeps running. */
data class RanVersion(val code: String, val script: String, val world: String, val at: String, val style: String? = null)

data class InstalledMod(
    val id: String,                 // site/name, as desktop's ids
    val site: String,               // the folder it's kept under: a host, or all-sites
    val name: String,
    val description: String = "",
    val tier: String = "free",      // style, boxed or free
    val sites: List<String> = emptyList(),
    val matches: List<String> = emptyList(),
    val excludes: List<String> = emptyList(),
    val powers: List<String> = emptyList(),
    val powerArgs: Map<String, List<String>> = emptyMap(),
    val facts: List<PowerFact> = emptyList(),
    val warnings: List<String> = emptyList(),
    val risk: ModRisk? = null,
    val hash: String = "",
    val needs: List<ModNeed> = emptyList(),
    val code: String,               // the file
    /** What runs: the mod behind a check of the page's address (made by the reader; not kept, made again at start). */
    val script: String = "",
    val world: String = "page",     // trif, box or page
    val at: String = "end",         // start or end
    /** A free mod's style section (the reader's styleScript); "" without one. Not kept either. */
    val styleScript: String = "",
    val on: Boolean = true,
    /** Sites it's switched off on (a mod for several sites: its switch is the site's). */
    val offSites: List<String> = emptyList(),
    /** What the person allowed it: {need key: [line hashes]} (allowed.json's shape). */
    val allowed: Map<String, List<String>> = emptyMap(),
    /** How it came: chat, import, link, pasted, edit, computer. */
    val source: String = "chat",
    /** Why it's off and marked: import (new) or update (updated), until it's switched on. */
    val newOff: String? = null,
    val added: Long = System.currentTimeMillis(),
    val history: List<ModVersion> = emptyList(),
    val ran: RanVersion? = null,
    /** What an edit or a restore asks about beyond the code's needs (ModStore.changeNeeds); kept apart from `needs`. */
    val extraNeeds: List<ModNeed> = emptyList(),
    /** (offered, not kept) the site it came from: a chat's, or the page it was pasted on; null from a file or a code. */
    val cameFrom: String? = null,
) {
    val everywhere get() = site == "all-sites"
    /** Its file's name, as desktop keeps it (sites/<site>/<name>.js): read again, it keeps its id. */
    val file get() = "${id.substringAfterLast('/').ifEmpty { "mod" }}.js"
    /** A mod for several sites (or every site) has a switch per site (desktop's isMultiSite). */
    val multiSite get() = ModRuns.multiSite(everywhere, sites)
    /** The needs not yet allowed (modfile.js waiting): what a hold waits for. */
    val waiting get() = (needs + extraNeeds).filter { n ->
        val ok = allowed[n.key] ?: return@filter true
        (n.lines ?: emptyList()).any { it !in ok }
    }
    val held get() = waiting.isNotEmpty()
    /** A change on hold: the version before runs meanwhile. */
    val pending get() = held && ran != null

    /** As kept (iPhone's encode, at most ten earlier versions) and with what the reader made of it (script and
     *  styleScript, which iPhone makes again at each start): a start needs no reader, only a new reader reads again. */
    fun json(): JSONObject = JSONObject()
        .put("id", id).put("site", site).put("name", name).put("description", description).put("tier", tier)
        .put("sites", JSONArray(sites)).put("matches", JSONArray(matches)).put("excludes", JSONArray(excludes))
        .put("powers", JSONArray(powers)).put("powerArgs", lists(powerArgs))
        .put("facts", JSONArray(facts.map { JSONObject().put("power", it.power).put("fact", it.fact) }))
        .put("warnings", JSONArray(warnings)).put("hash", hash).put("needs", JSONArray(needs.map(ModNeed::json)))
        .put("code", code).put("script", script).put("styleScript", styleScript).put("world", world).put("at", at).put("on", on).put("offSites", JSONArray(offSites))
        .put("allowed", lists(allowed)).put("source", source).put("added", added)
        .put("history", JSONArray(history.take(10).map {
            JSONObject().put("stamp", it.stamp).put("at", it.at).put("code", it.code).put("source", it.source)
        }))
        .put("extraNeeds", JSONArray(extraNeeds.map(ModNeed::json)))
        .apply {
            risk?.let { r -> put("risk", JSONObject().put("tier", r.tier).apply { r.why?.let { put("why", it) } }) }
            newOff?.let { put("newOff", it) }
            ran?.let { r ->
                put("ran", JSONObject().put("code", r.code).put("script", r.script).put("world", r.world).put("at", r.at)
                    .apply { r.style?.let { put("style", it) } })
            }
        }

    companion object {
        /** A kept mod (every field but id, name and code optional, as iPhone's decoder). */
        fun of(o: JSONObject) = InstalledMod(
            id = o.getString("id"), name = o.getString("name"), code = o.getString("code"),
            site = o.optString("site"), description = o.optString("description"), tier = o.optString("tier", "free"),
            sites = o.optJSONArray("sites").strings(), matches = o.optJSONArray("matches").strings(),
            excludes = o.optJSONArray("excludes").strings(), powers = o.optJSONArray("powers").strings(),
            powerArgs = o.optJSONObject("powerArgs").lists(),
            facts = o.optJSONArray("facts").objects().map { PowerFact(it.optString("power"), it.optString("fact")) },
            warnings = o.optJSONArray("warnings").strings(),
            risk = o.optJSONObject("risk")?.takeIf { it.has("tier") }?.let { ModRisk(it.getInt("tier"), it.str("why")) },
            hash = o.optString("hash"), needs = o.optJSONArray("needs").objects().map(ModNeed::of),
            script = o.optString("script"), world = o.optString("world", "page"), at = o.optString("at", "end"),
            styleScript = o.optString("styleScript"),
            on = o.optBoolean("on", true), offSites = o.optJSONArray("offSites").strings(),
            allowed = o.optJSONObject("allowed").lists(), source = o.optString("source", "chat"), newOff = o.str("newOff"),
            added = o.optLong("added", System.currentTimeMillis()),
            history = o.optJSONArray("history").objects().map {
                ModVersion(it.optString("stamp"), it.optLong("at"), it.optString("code"), it.optString("source"))
            },
            ran = o.optJSONObject("ran")?.let {
                RanVersion(it.optString("code"), it.optString("script"), it.optString("world"), it.optString("at"), it.str("style"))
            },
            extraNeeds = o.optJSONArray("extraNeeds").objects().map(ModNeed::of),
        )

        private fun lists(m: Map<String, List<String>>) = JSONObject().apply { m.forEach { (k, v) -> put(k, JSONArray(v)) } }
    }
}

/** A mod in Recently deleted: when, and by whom (you, or computer: a sync). */
data class DeletedMod(val mod: InstalledMod, val at: Long, val by: String) {
    val id get() = "${mod.id}@$at"
    fun json() = JSONObject().put("mod", mod.json()).put("at", at).put("by", by)
    companion object {
        fun of(o: JSONObject) = DeletedMod(InstalledMod.of(o.getJSONObject("mod")), o.optLong("at"), o.optString("by", "you"))
    }
}

/** Sites as the Mods tab groups them: a host's registrable part (en.wikipedia.org → wikipedia.org). Mods.swift Site. */
object Site {
    private val twoPart = setOf("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp",
        "or.jp", "com.br", "com.mx", "co.in", "co.kr", "com.cn", "com.tw", "com.hk", "co.za", "com.sg", "com.tr", "com.ar", "qc.ca")

    fun of(host: String): String {
        val h = host.lowercase().removePrefix("www.")
        if (h.isEmpty() || h == "all-sites" || h.all { it.isDigit() || it == '.' } || '.' !in h) return h
        val parts = h.split('.')
        if (parts.size <= 2) return h
        val last2 = parts.takeLast(2).joinToString(".")
        return if (last2 in twoPart) parts.takeLast(3).joinToString(".") else last2
    }

    /** Whether `host` is `site` or under it. */
    fun hostIsIn(host: String, site: String): Boolean {
        val h = host.lowercase().removePrefix("www.")
        return h == site || h.endsWith(".$site")
    }
}

internal fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k) else null
internal fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONObject?.lists(): Map<String, List<String>> =
    if (this == null) emptyMap() else keys().asSequence().associateWith { optJSONArray(it).strings() }
