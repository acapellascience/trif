package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject

/**
 * What the Mods tab's page (mods.html, mods-page.js) shows for the shown tab's site: iPhone's Browser.modsState, in
 * the shape the desktop panel's status has its mods. Pure, so it's tested without a device; ModsPanel calls it on
 * the store thread with what the page last said.
 */
object ModsState {
    /** How long after its page finished loading a mod has to say it started before the tab says it couldn't. */
    const val START_GRACE_MS = 2000L

    /** What the shown page said: which mods started there (__trifRan, each world) and their errors, and when. */
    data class PageAnswer(val url: String, val ran: Set<String>, val boxErrors: List<Pair<String, String>>,
                          val pageErrors: List<String>, val at: Long)

    /** The shown tab as the Mods tab needs it: its address, whether it's loading, which mods its page loaded with
     *  (null: not loaded under a plan yet) and when it finished loading. */
    data class Page(val url: String, val loading: Boolean, val loadedIds: Set<String>?, val finishedAt: Long?)

    fun build(store: ModStore, page: Page, answer: PageAnswer?, seq: Int, now: Long = System.currentTimeMillis()): JSONObject {
        val url = page.url
        val host = WebAddress.of(url)?.host ?: ""
        val site = Site.of(host)
        val listed = store.mods.filter { m ->
            m.everywhere || Site.of(m.site) == site || m.sites.any { Site.of(it) == site } || (url.isNotEmpty() && store.applies(m, url))
        }
        val said = answer?.takeIf { it.url == url }
        val ran = said?.ran ?: emptySet()
        val errors = mutableMapOf<String, MutableList<String>>()
        said?.boxErrors?.forEach { (id, message) -> if (listed.any { it.id == id && it.world == "box" }) errors.getOrPut(id) { mutableListOf() } += message }
        said?.pageErrors?.forEach { line ->
            listed.firstOrNull { it.world == "page" && line.startsWith("${it.id}:") }?.let { m ->
                errors.getOrPut(m.id) { mutableListOf() } += line.substring(m.id.length + 1).trim()
            }
        }
        // (the page's answer is the last word on which mods started only once it was asked a while after the page
        // finished loading: before that a mod switched on may simply not have started yet. iPhone, 11-18)
        val finished = if (page.loading) null else page.finishedAt
        val settled = finished != null && said != null && said.at - finished >= START_GRACE_MS
        var starting = false
        val rows = JSONArray()
        for (m in listed) {
            val applies = url.isNotEmpty() && store.applies(m, url)
            val on = store.isOn(m, site)
            val tierOff = store.groupOff(m.tier, site)
            val row = JSONObject()
                .put("id", m.id).put("name", m.name).put("description", m.description).put("tier", m.tier)
                .put("rules", m.tier == "style").put("sandboxed", m.tier == "boxed")
                .put("powers", JSONArray(m.powers))
                .put("powerInfo", JSONObject()
                    .put("facts", JSONArray(m.facts.map { JSONObject().put("power", it.power).put("fact", it.fact) }))
                    .put("warnings", JSONArray(m.warnings)))
                .put("matches", JSONArray(m.matches)).put("sites", JSONArray(m.sites)).put("site", m.site).put("file", m.file)
                .put("multi", m.multiSite).put("on", on).put("applies", applies).put("running", m.id in ran)
                .put("errors", JSONArray(errors[m.id].orEmpty())).put("imported", m.source == "import")
                .put("history", m.history.size)
            m.risk?.let { row.put("risk", JSONObject().put("tier", it.tier).put("why", it.why ?: "")) }
            m.newOff?.let { row.put("newOff", it) }
            if (m.held) {
                row.put(if (m.pending) "pending" else "held", JSONObject()
                    .put("needs", JSONArray(m.waiting.map { it.key })).put("facts", JSONArray(m.waiting.map { it.fact }))
                    .put("asks", m.tier == "boxed").put("by", m.source).put("site", m.site).put("hash", m.hash))
            }
            // (one that should be running here and isn't said to be: switched on since this page loaded, so it starts
            // at the next load; loaded with it and not settled yet: starting; loaded with it, settled, and a free mod:
            // the page's own world wouldn't run it. Only that last is an error)
            if (on && !tierOff && !m.held && applies && !store.paused && m.id !in ran) {
                when {
                    page.loadedIds?.contains(m.id) != true -> row.put("nextLoad", true)
                    !settled -> { row.put("starting", true); starting = true }
                    m.tier == "free" -> row.put("cant", true)
                }
            }
            rows.put(row)
        }
        val tiers = mapOf("style" to "rules", "boxed" to "sandboxed", "free" to "page")
        val recheck = if (!starting) JSONObject.NULL
            else maxOf(0.2, ((finished ?: now) + START_GRACE_MS + 100 - now) / 1000.0)
        return JSONObject()
            .put("site", site).put("host", host).put("url", url).put("loading", page.loading)
            .put("mods", rows)
            .put("groupsOff", JSONArray(store.groupsOff[site].orEmpty().mapNotNull { tiers[it] }))
            // (no hide rules (pointing) nor phone sync nor safe mode on Android yet)
            .put("hidden", JSONArray())
            .put("deleted", store.lastDeleted?.name ?: JSONObject.NULL)
            .put("sync", JSONObject.NULL)
            .put("trash", JSONArray(store.trash.map {
                JSONObject().put("entry", it.id).put("name", it.mod.name).put("site", if (it.mod.everywhere) "every site" else it.mod.site)
            }))
            .put("paused", store.paused)
            .put("switchedOff", JSONObject.NULL)
            .put("seq", seq)
            .put("recheck", recheck)
    }
}
