package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ModStoreTest {
    /** A stand-in reader: a "mod file" here is JSON {name, site, tier, matches, needs, powers, check}; the answer is
     *  shaped as mods.js readMod's (id site/name, script and world made from it). */
    private class FakeReader(override val version: String = "r1") : ModReader {
        override fun read(text: String, file: String, site: String, here: String): String {
            val d = runCatching { JSONObject(text) }.getOrElse { return JSONObject().put("error", "there is no mod file").toString() }
            val s = site.ifEmpty { d.optString("site", "a.com") }
            val name = file.removeSuffix(".js").ifEmpty { d.optString("name") }
            val tier = d.optString("tier", "style")
            return JSONObject().put("id", "$s/$name").put("site", s).put("name", d.optString("name")).put("tier", tier)
                .put("sites", d.optJSONArray("sites") ?: JSONArray().put(s))
                .put("matches", d.optJSONArray("matches") ?: JSONArray().put("*://*.$s/*"))
                .put("powers", d.optJSONArray("powers") ?: JSONArray()).put("needs", d.optJSONArray("needs") ?: JSONArray())
                .put("code", text).put("script", "run(${d.optString("v", "1")})")
                .put("world", when (tier) { "boxed" -> "box"; "free" -> "page"; else -> "trif" }).put("at", "start")
                .toString()
        }
        override fun check(text: String, file: String, site: String) =
            JSONObject().put("ok", !text.contains("broken")).toString()
        override val free = "P" to "R"
    }

    private var clock = 1_000_000_000_000L
    private val dir: File = Files.createTempDirectory("mods").toFile()
    private fun store(reader: ModReader? = FakeReader()) = ModStore(ModFiles(dir) { it.run() }, reader) { clock }
    private fun mod(name: String, vararg kv: Pair<String, Any>) =
        JSONObject().put("name", name).apply { kv.forEach { (k, v) -> put(k, v) } }.toString()
    private fun need(key: String, vararg lines: String) = JSONArray().put(JSONObject().put("key", key).put("fact", "f").put("lines", JSONArray(lines.toList())))
    private fun ModStore.addText(text: String, source: String = "chat") = add(read(text).mod!!, source)

    @Test fun sites() {
        assertEquals("facebook.com", Site.of("m.facebook.com"))
        assertEquals("bbc.co.uk", Site.of("www.news.bbc.co.uk"))
        assertEquals("127.0.0.1", Site.of("127.0.0.1"))
        assertEquals("localhost", Site.of("localhost"))
        assertTrue(Site.hostIsIn("www.en.wikipedia.org", "wikipedia.org"))
        assertFalse(Site.hostIsIn("notwikipedia.org", "wikipedia.org"))
    }

    @Test fun matchPatterns() {
        fun m(p: String, u: String) = MatchPattern.any(listOf(p), u)
        assertTrue(m("https://x.com/*", "https://x.com/a?b=1"))
        assertTrue(m("https://x.com/*", "https://X.com"))
        assertFalse(m("https://x.com/*", "http://x.com/"))
        assertTrue(m("*://*.x.com/*", "http://m.x.com:8080/p#frag"))
        assertTrue(m("*://*.x.com/*", "https://x.com/"))
        assertFalse(m("*://*.x.com/*", "https://notx.com/"))
        assertFalse(m("*://*/*", "ftp://x.com/"))
        assertTrue(m("<all_urls>", "http://localhost:8477/a"))
        assertFalse(m("<all_urls>", "about:blank"))
        assertTrue(m("https://x.com/a.b/*", "https://x.com/a.b/c"))
        assertFalse(m("https://x.com/a.b/*", "https://x.com/aXb/c"))
        assertTrue(m("https://x.com/%E2%9C%93*", "https://x.com/%E2%9C%93/x"))
        assertTrue(m("https://x.com/search?q=*", "https://x.com/search?q=cats"))
        assertFalse(m("https://x.com/home", "https://x.com/home/more"))
        assertFalse(m("https://*x.com/*", "https://ax.com/"))
    }

    @Test fun keptAsIphoneKeepsThem() {
        val m = InstalledMod(id = "a.com/x", site = "a.com", name = "X", code = "C", script = "S", styleScript = "Y",
            needs = listOf(ModNeed("power:net", "f", "net", listOf("h1"))), risk = ModRisk(2, "why"), newOff = "import",
            history = (1..12).map { ModVersion("$it", it.toLong(), "c$it", "chat") }, ran = RanVersion("c", "s", "box", "end"))
        val o = m.json()
        assertEquals("S", o.getString("script")); assertEquals("Y", o.getString("styleScript"))
        assertEquals(10, o.getJSONArray("history").length())
        val back = InstalledMod.of(JSONObject(o.toString()))
        assertEquals(m.copy(history = m.history.take(10)), back)
        // (only id, name and code are needed)
        val bare = InstalledMod.of(JSONObject("""{"id":"x","name":"X","code":"C"}"""))
        assertEquals("free", bare.tier); assertEquals("page", bare.world); assertEquals("end", bare.at); assertTrue(bare.on)
    }

    @Test fun readersAnswer() {
        val r = ModStore.build("""{"id":"a.com/x","site":"a.com","name":"X","tier":"boxed","matches":["*://a.com/*"],"code":"C",
            "script":"S","world":"box","at":"end","powerInfo":{"facts":[{"power":"net","fact":"talks"}],"warnings":["w"]},
            "risk":{"tier":1},"needs":[{"key":"power:net","fact":"talks","power":"net","lines":["l"]}],"powerArgs":{"net":["x.com"]}}""")
        val m = r.mod!!
        assertEquals(listOf(PowerFact("net", "talks")), m.facts)
        assertEquals(listOf("w"), m.warnings)
        assertEquals(ModRisk(1, null), m.risk)
        assertEquals(mapOf("net" to listOf("x.com")), m.powerArgs)
        assertTrue(m.held)
        assertEquals("it's broken", ModStore.build("""{"error":"it's broken"}""").error)
        assertTrue(ModStore.build("nope").error!!.startsWith("the mod reader gave nothing back"))
        assertEquals("the mod reader didn't start", store(null).read("x").error)
    }

    @Test fun addingAndImporting() {
        val s = store()
        val a = s.addText(mod("A"))
        assertTrue(a.on); assertNull(a.newOff)
        val b = s.addText(mod("B", "site" to "b.com"), "import")
        assertFalse(b.on); assertEquals("import", b.newOff)
        assertEquals(listOf(a), s.running("https://www.a.com/page"))
        assertEquals(emptyList<InstalledMod>(), s.running("https://b.com/"))
        // (a new version: the one before in History; an import of it is off and marked updated)
        clock += 1000
        val a2 = s.addText(mod("A", "v" to 2), "import")
        assertEquals(1, a2.history.size); assertEquals(mod("A"), a2.history[0].code); assertEquals("import", a2.history[0].source)
        assertFalse(a2.on); assertEquals("update", a2.newOff)
        s.setOn("a.com/A", true)
        assertNull(s.mods.first { it.id == "a.com/A" }.newOff)
        // (the same code again adds no history)
        assertEquals(1, s.addText(mod("A", "v" to 2)).history.size)
        // (History keeps 30 days)
        clock += 31 * ModStore.DAY
        assertEquals(1, s.addText(mod("A", "v" to 3)).history.size)
    }

    @Test fun readNamedKeepsTheId() {
        val s = store()
        s.add(s.read(mod("A"), file = "first.js").mod!!, "chat")
        assertEquals("a.com/first", s.readNamed(mod("A", "v" to 2), "a.com").mod!!.id)
        assertEquals("a.com/B", s.readNamed(mod("B"), "a.com").mod!!.id)
    }

    @Test fun holdsWaitForAllow() {
        val s = store()
        // (new and held: it doesn't run until Allow)
        val h = s.addText(mod("H", "tier" to "boxed", "needs" to need("power:net", "l1")))
        assertTrue(h.held); assertFalse(h.pending)
        assertTrue(s.running("https://a.com/").isEmpty())
        assertTrue(s.plan().mods.isEmpty())
        s.approve("a.com/H")
        assertEquals(listOf("a.com/H"), s.running("https://a.com/").map { it.id })
        assertEquals(mapOf("power:net" to listOf("l1")), s.mods[0].allowed)
        // (a later version needing nothing more runs without asking; one needing more waits, the one before runs)
        assertFalse(s.addText(mod("H", "tier" to "boxed", "v" to 2, "needs" to need("power:net", "l1"))).held)
        val p = s.addText(mod("H", "tier" to "boxed", "v" to 3, "needs" to need("power:net", "l1", "l2")))
        assertTrue(p.pending)
        assertEquals("run(2)", p.ran!!.script)
        assertEquals(listOf("run(2)"), s.plan().mods.map { it.script })
        assertEquals(1, s.running("https://a.com/").size)
        // (Don't allow: the version before is back, this one in History)
        s.reject("a.com/H")
        val back = s.mods[0]
        assertEquals("run(2)", back.script); assertFalse(back.held); assertNull(back.ran)
        assertEquals("undo", back.history[0].source); assertTrue(back.history[0].code.contains("\"v\":3"))
        // (Don't allow on a new mod: deleted, to Recently deleted)
        s.addText(mod("N", "needs" to need("power:x", "z")))
        s.reject("a.com/N")
        assertTrue(s.mods.none { it.id == "a.com/N" }); assertEquals("a.com/N", s.trash[0].mod.id)
    }

    @Test fun deletingAndRecentlyDeleted() {
        val s = store()
        s.addText(mod("A")); s.addText(mod("B"))
        s.remove("a.com/A")
        assertEquals(listOf("a.com/B"), s.mods.map { it.id })
        assertEquals("a.com/A", s.lastDeleted?.id)
        s.undoDelete()
        assertTrue(s.mods.any { it.id == "a.com/A" }); assertTrue(s.trash.isEmpty()); assertNull(s.lastDeleted)
        s.remove("a.com/A", by = "computer")
        assertNull(s.lastDeleted)
        val entry = s.trash[0].id
        assertTrue(s.restoreDeleted(entry))
        assertFalse(s.restoreDeleted(entry))
        // (one with its id here now: not restored)
        s.remove("a.com/A"); s.addText(mod("A"))
        assertFalse(s.restoreDeleted(s.trash[0].id))
        // (30 days)
        s.remove("a.com/B")
        clock += 31 * ModStore.DAY
        assertEquals(2, s.trash.size)
        assertTrue(store().trash.isEmpty()) // (pruned at the next start)
    }

    @Test fun switchesTiersAndPause() {
        val s = store()
        s.addText(mod("M", "sites" to JSONArray(listOf("a.com", "b.com")), "matches" to JSONArray(listOf("*://a.com/*", "*://b.com/*"))))
        s.addText(mod("F", "tier" to "free", "v" to "f"))
        assertEquals(2, s.running("https://a.com/").size)
        s.setOn("a.com/M", false, "b.com")
        assertTrue(s.mods[0].on); assertEquals(listOf("b.com"), s.mods[0].offSites)
        assertTrue(s.running("https://b.com/").isEmpty()); assertEquals(2, s.running("https://a.com/").size)
        assertFalse(s.isOn(s.mods[0], "b.com")); assertTrue(s.isOn(s.mods[0], "a.com"))
        s.setGroup("free", false, "a.com")
        assertEquals(listOf("a.com/M"), s.running("https://a.com/").map { it.id })
        val plan = s.plan()
        assertEquals(listOf("b.com"), plan.mods.first { it.id == "a.com/M" }.off)
        assertEquals(listOf("a.com"), plan.mods.first { it.id == "a.com/F" }.off)
        s.setGroup("free", true, "a.com")
        assertTrue(s.groupsOff.isEmpty())
        s.setPaused(true)
        assertTrue(s.running("https://a.com/").isEmpty()); assertTrue(s.plan().mods.isEmpty())
        s.setPaused(false)
        // (a mod for one site: the switch is the whole mod's)
        s.setOn("a.com/F", false, "a.com")
        assertFalse(s.mods[1].on); assertTrue(s.mods[1].offSites.isEmpty())
    }

    @Test fun signatureChangesOnlyWithWhatRunsThere() {
        val s = store()
        s.addText(mod("A")); s.addText(mod("B", "site" to "b.com"))
        val a = s.signature("https://a.com/"); val b = s.signature("https://b.com/")
        s.addText(mod("B", "site" to "b.com", "v" to 2))
        assertEquals(a, s.signature("https://a.com/"))
        assertNotEquals(b, s.signature("https://b.com/"))
        s.setOn("a.com/A", false)
        assertEquals("", s.signature("https://a.com/"))
    }

    @Test fun keptAcrossLaunches() {
        val s = store()
        s.reread() // (a first reader: its version and free pair kept)
        s.addText(mod("A")); s.addText(mod("B")); s.remove("a.com/B")
        s.setGroup("style", false, "x.com"); s.setOn("a.com/A", false)
        val noReader = store(null)
        assertEquals(listOf("a.com/A"), noReader.mods.map { it.id })
        assertEquals("run(1)", noReader.mods[0].script) // (kept: a start needs no reader)
        assertFalse(noReader.needsReading)
        assertTrue(noReader.plan().mods.isEmpty()) // (A is off)
        assertEquals("P" to "R", noReader.plan().free) // (the reader's free pair, kept)
        assertEquals(mapOf("x.com" to listOf("style")), noReader.groupsOff)
        assertEquals("a.com/B", noReader.trash[0].mod.id)
        val again = store()
        again.reread()
        assertEquals("run(1)", again.mods[0].script); assertFalse(again.mods[0].on)
        // (a mod gone from the list loses its file)
        again.remove("a.com/A")
        assertEquals(listOf("order.json"), File(dir, "mods").list()!!.toList())
    }

    @Test fun editsAndRestores() {
        val s = store()
        s.addText(mod("E", "tier" to "boxed", "needs" to need("power:net", "l")))
        s.approve("a.com/E")
        assertEquals("the check said no", s.saveEdit("a.com/E", "broken").check.let { if (!it.optBoolean("ok")) "the check said no" else "?" })
        // (an edit that runs on another site asks; the version before keeps running)
        val e = s.saveEdit("a.com/E", mod("E", "tier" to "boxed", "v" to 2, "needs" to need("power:net", "l"),
            "matches" to JSONArray(listOf("*://*.a.com/*", "*://b.com/*"))))
        val m = e.mod!!
        assertEquals(listOf("match:*://b.com/*"), m.waiting.map { it.key })
        assertTrue(m.pending); assertEquals("run(1)", m.ran!!.script)
        assertEquals(e.stamp, m.history[0].stamp); assertEquals("edit", m.history[0].source)
        s.approve("a.com/E")
        // (restore the first version: it ran on a.com only, so nothing new to ask)
        clock += 5
        assertTrue(s.restore("a.com/E", m.history[0].stamp))
        val r = s.mods[0]
        assertEquals("run(1)", r.script); assertFalse(r.held); assertEquals("restore", r.history[0].source)
        assertFalse(s.restore("a.com/E", "nope"))
        // (becoming a free mod asks)
        assertEquals(listOf("tier:free"), ModStore.changeNeeds(r.copy(tier = "free", needs = emptyList()), r).map { it.key })
    }
}
