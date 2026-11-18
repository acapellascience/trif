package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** What runs: the Kotlin twins (ModRuns, MatchPattern) give the shared cases' answers (mod-runs-cases.json, the
 *  iPhone's), and what Kotlin hands the shared setOn / setGroup reads as the cases' records do. */
class ModRunsTest {
    private val cases = JSONObject(generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "mobile/shared/core/mod-runs-cases.json") }.first { it.isFile }.readText())
    private val records = cases.getJSONArray("mods").objects()
    private val mods = records.map { o ->
        InstalledMod.of(JSONObject(o.toString()).put("id", "x/y").put("name", "y").put("code", "")
            .put("ran", if (o.getBoolean("ran")) JSONObject().put("code", "").put("script", "").put("world", "trif").put("at", "end") else JSONObject.NULL))
    }
    private fun parts(o: Any?) = (o as? JSONObject)?.let { WebAddress(it.getString("scheme"), it.getString("host"), it.getString("path")) }
    private fun groups(o: JSONObject) = o.lists()
    private fun site(a: JSONArray, i: Int): String? = if (a.isNull(i)) null else a.getString(i)

    @Test fun matchTwin() {
        val m = cases.getJSONObject("match")
        val patterns = m.getJSONArray("patterns").strings()
        val urls = m.getJSONArray("urls")
        val one = m.getJSONArray("one")
        var n = 0
        for (u in 0 until urls.length()) {
            val p = parts(urls.getJSONArray(u).opt(1))
            patterns.forEachIndexed { i, pat ->
                val want = one.getString(u)[i] == '1'
                assertEquals("one $pat ${urls.getJSONArray(u).getString(0)}", want, p != null && MatchPattern.one(pat, p)); n++
            }
        }
        assertTrue(n > 3000)
    }

    /** WebAddress.of cuts an address as iPhone's URL does, for addresses as Chromium hands them (canonical). The
     *  others (unencoded é, spaces, brackets, "https:x.com/", "not a url") never reach it from a WebView. */
    @Test fun addressesAsIphoneCutsThem() {
        val urls = cases.getJSONObject("match").getJSONArray("urls")
        var n = 0
        for (u in 0 until urls.length()) {
            val url = urls.getJSONArray(u).getString(0)
            if (!Regex("^[a-z]+://[a-z0-9.\\-\\[\\]:@]+(/[\\w\\-.~%!$&'()*+,;=:@/]*)?([?#][\\w\\-.~%!$&'()*+,;=:@/?#]*)?$").matches(url) || "://[a-z]+:[a-z]+@".toRegex().containsMatchIn(url)) continue
            assertEquals(url, parts(urls.getJSONArray(u).opt(1)), WebAddress.of(url)); n++
        }
        assertTrue("$n", n > 35)
    }

    @Test fun isOnTwin() {
        val sites = cases.getJSONArray("isOnSites")
        for (c in cases.getJSONArray("isOn").let { a -> (0 until a.length()).map(a::getJSONArray) }) {
            val want = c.getJSONArray(1)
            for (i in 0 until sites.length()) assertEquals("isOn ${c.getInt(0)} ${site(sites, i)}", want.getBoolean(i), ModRuns.isOn(mods[c.getInt(0)], site(sites, i)))
        }
    }

    @Test fun offTwin() {
        val choices = cases.getJSONArray("groupsChoices").objects().map(::groups)
        for (c in cases.getJSONArray("off").let { a -> (0 until a.length()).map(a::getJSONArray) }) {
            val want = c.getJSONArray(1)
            choices.forEachIndexed { i, g -> assertEquals("off ${c.getInt(0)} $i", want.getJSONArray(i).strings(), ModRuns.off(mods[c.getInt(0)], g)) }
        }
    }

    @Test fun runningTwin() {
        val urls = cases.getJSONArray("runUrls")
        for (c in cases.getJSONArray("running").let { a -> (0 until a.length()).map(a::getJSONArray) }) {
            val list = c.getJSONArray(0).let { a -> (0 until a.length()).map { mods[a.getInt(it)] } }
            val g = groups(c.getJSONObject(1)); val paused = c.getBoolean(2); val want = c.getJSONArray(3)
            for (i in 0 until urls.length()) {
                val got = ModRuns.running(list, paused, g, urls.getJSONArray(i).getString(0))
                val w = want.getJSONArray(i).let { a -> (0 until a.length()).map { a.getJSONArray(it).let { p -> p.getInt(0) to p.getBoolean(1) } } }
                assertEquals("running ${c.getJSONArray(0)} ${urls.getJSONArray(i).getString(0)}", w, got)
            }
        }
    }

    /** setOn and setGroup call through: Kotlin's facts read as the cases' records, so the shared rule's answers are the
     *  iPhone's. */
    @Test fun switchesCallThrough() {
        records.forEachIndexed { i, o ->
            val f = ModRuns.facts(mods[i])
            for (k in o.keys()) assertEquals("facts $i $k", o.get(k).toString(), f.get(k).toString())
        }
        for (c in cases.getJSONArray("setOn").let { a -> (0 until a.length()).map(a::getJSONArray) }) {
            val r = c.getInt(0); val want = c.getJSONObject(3)
            val args = JSONArray().put(ModRuns.facts(mods[r])).put(c.getBoolean(1)).put(c.opt(2))
            val got = JSONObject(NodeCore.call("modStore.setOn", args.toString())!!)
            assertEquals("setOn $c", want.getBoolean("on"), got.getBoolean("on"))
            assertEquals("setOn $c", want.getJSONArray("offSites").strings(), got.getJSONArray("offSites").strings())
        }
        for (c in cases.getJSONArray("setGroup").let { a -> (0 until a.length()).map(a::getJSONArray) }) {
            val args = JSONArray().put(c.get(0)).put(c.get(1)).put(c.get(2)).put(c.get(3))
            assertEquals("setGroup $c", groups(c.getJSONObject(4)), groups(JSONObject(NodeCore.call("modStore.setGroup", args.toString())!!)))
        }
    }
}
