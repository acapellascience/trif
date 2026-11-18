package com.timsrobot.trif

import org.json.JSONArray

/**
 * The scripts every page gets at its start, as the iPhone app puts them in (Browser.swift `base()`, Mods.swift
 * `ModStore.userScripts`): which text, in which world, at the start or the end of the page. Pure: the texts come
 * from `text` (the app's assets: web/, gen/, shared/, js/ and SES, made at build time from the shared code), so
 * a unit test can pass its own. Browser puts the list into each WebView (Worlds.install).
 *
 * The worlds: TRIF's ("trif": kit.js, the style mods, a free mod's style section), the box ("trif-box": SES and
 * TRIF's sandbox runtime, the boxed mods) and the page's own (free mods). As on desktop and iPhone, only a tab's
 * main frame gets them (Android puts a script in every frame its origin rules allow: each is guarded here).
 */
object Scripts {
    enum class World(val id: String) { TRIF("trif"), BOX("trif-box"), PAGE("page") }

    /** One script: its text, its world, at the page's start (else at its end, once the document is read). */
    data class Injection(val world: World, val start: Boolean, val source: String, val name: String)

    /** What the mods put in (iPhone's ModStore.ScriptPlan): made by the mod store; empty while there are none. */
    data class Plan(
        val mods: List<One> = emptyList(),
        /** modfile.js freePageScript and freeRelayScript (from mods.js), when the reader gave them. */
        val free: Pair<String, String>? = null,
        /** The [matches, excludes] of the boxed mods allowed site-data: page-bridge.js goes on their pages. */
        val bridged: List<Pair<List<String>, List<String>>> = emptyList(),
    ) {
        /** One mod as the reader made it: its script (it checks its own @match), world (trif/box/page), at
         *  (start/end), a free mod's style section, the sites it's switched off on, and its @match / @exclude
         *  (the script checks them itself; kept here for [signature]). */
        data class One(val id: String, val script: String, val world: String, val at: String, val style: String = "",
                       val off: List<String> = emptyList(), val matches: List<String> = emptyList(),
                       val excludes: List<String> = emptyList())
        /** The mods of this plan that run on a page at `url`. */
        fun runningOn(url: String): List<One> {
            val site = Site.of(WebAddress.of(url)?.host ?: "")
            return mods.filter { site !in it.off && MatchPattern.any(it.matches, url) && !MatchPattern.any(it.excludes, url) }
        }
        /** What runs on a page at `url` under this plan, as one string: a page loaded under one plan whose
         *  signature differs under the next loads again (iPhone's refreshIfStale; docs/MOBILE-BEHAVIOUR.md). */
        fun signature(url: String): String = runningOn(url).map { o ->
            "${o.id}:${Integer.toHexString(listOf(o.script, o.world, o.at, o.style).fold(17) { a, s -> 31 * a + s.hashCode() })}"
        }.sorted().joinToString(",")
        val mirrorTrif get() = mods.any { it.world == "trif" || it.style.isNotEmpty() }
        val hasFree get() = free != null && mods.any { it.world == "page" }
        val box get() = mods.any { it.world == "box" }
    }

    fun world(w: String) = when (w) { "box" -> World.BOX; "page" -> World.PAGE; else -> World.TRIF }

    /** Main frame only, as desktop (allFrames: false) and iPhone (forMainFrameOnly). */
    fun topOnly(s: String) = "if (window === window.top) {\n$s\n}"

    /** A mod's text behind the check of the sites it's switched off on (iPhone's ModStore.build `behind`). */
    fun behind(off: List<String>, s: String): String {
        if (off.isEmpty()) return s
        return "(function () { const h = location.hostname.replace(/^www\\./, ''); if (${JSONArray(off)}.some((s) => h === s || h.endsWith('.' + s))) return;\n$s\n})();"
    }

    /**
     * TRIF's own, every page (iPhone's base()): the app's message adapter first in TRIF's world (window.webkit
     * .messageHandlers.trif, as the iPhone scripts post to it), kit.js, start-own.js with the hide rules, and
     * start-page.js in the page's world. Each world TRIF calls into gets js/world-call.js. (iPhone's stall watch,
     * background play and video resume are Swift strings there: they come with the features they serve.)
     */
    fun base(text: (String) -> String, rules: String = "{}"): List<Injection> = listOf(
        Injection(World.TRIF, true, text("js/world-call.js"), "world-call"),
        Injection(World.TRIF, true, text("js/webkit-bridge.js"), "webkit-bridge"),
        Injection(World.TRIF, true, text("shared/kit.js"), "kit"),
        Injection(World.TRIF, true, text("web/start-own.js") + "($rules);", "start-own"),
        Injection(World.PAGE, true, text("web/start-page.js"), "start-page"),
    )

    /** The mods' scripts, in iPhone's order (ModStore.userScripts(from:)). */
    fun mods(plan: Plan, text: (String) -> String): List<Injection> {
        val out = mutableListOf<Injection>()
        // (first in each world with a mod: a style element the page's policy refuses still applies)
        if (plan.mirrorTrif) out += Injection(World.TRIF, true, text("web/style-mirror.js"), "style-mirror")
        // (where a free mod may run: window.trif.log/warn/error in the page's world, their relay in TRIF's)
        plan.free?.takeIf { plan.hasFree }?.let { (page, relay) ->
            out += Injection(World.TRIF, true, relay, "free-relay")
            out += Injection(World.PAGE, true, page, "free-page")
        }
        if (plan.box) {
            out += Injection(World.BOX, true, text("js/world-call.js"), "world-call")
            out += Injection(World.BOX, true, text("web/style-mirror.js"), "style-mirror")
            out += Injection(World.BOX, true, "globalThis.__trifT0 = performance.now();\n" + text("ses.umd.min.js"), "ses")
            out += Injection(World.BOX, true, text("gen/sandbox-runtime.js"), "sandbox-runtime")
        }
        if (plan.bridged.isNotEmpty()) {
            val pairs = JSONArray(plan.bridged.map { (m, x) -> JSONArray(listOf(JSONArray(m), JSONArray(x))) })
            out += Injection(World.PAGE, true, text("gen/page-bridge.js") + "($pairs);", "page-bridge")
        }
        for (m in plan.mods) {
            // (a free mod's style section first, at the page's start whenever its code runs, as desktop's is)
            if (m.style.isNotEmpty()) out += Injection(World.TRIF, true, behind(m.off, m.style), "${m.id} style")
            out += Injection(world(m.world), m.at == "start", behind(m.off, m.script), m.id)
        }
        return out
    }

    /** All of a page's scripts, each guarded to the main frame. */
    fun all(plan: Plan, text: (String) -> String, rules: String = "{}"): List<Injection> =
        (base(text, rules) + mods(plan, text)).map { it.copy(source = topOnly(it.source)) }

    /** A plan from a list of mods as JSON ([{id, script, world, at, style, off}]): the debug build's test mods. */
    fun planOf(json: String): Plan {
        val a = JSONArray(json)
        val mods = (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            val off = o.optJSONArray("off")
            Plan.One(o.getString("id"), o.getString("script"), o.optString("world", "trif"), o.optString("at", "start"),
                o.optString("style", ""), off?.let { l -> (0 until l.length()).map { l.getString(it) } } ?: emptyList())
        }
        return Plan(mods)
    }
}
