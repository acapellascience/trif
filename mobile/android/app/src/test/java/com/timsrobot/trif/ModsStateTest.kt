package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** The Mods tab's state (ModsState.build, iPhone's modsState) and the plan's signature (which tabs load again). */
class ModsStateTest {
    private val clock = 1_000_000_000_000L
    private val store = ModStore(ModFiles(Files.createTempDirectory("mods").toFile()) { it.run() }, ModStoreTest.FakeReader()) { clock }
    private fun add(name: String, vararg kv: Pair<String, Any>) =
        store.add(store.read(JSONObject().put("name", name).apply { kv.forEach { (k, v) -> put(k, v) } }.toString()).mod!!, "chat")
    private fun rows(s: JSONObject) = s.getJSONArray("mods").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private val url = "https://www.a.com/page"

    @Test fun listsTheSitesModsWithWhatThePageSaid() {
        val style = add("Big", "tier" to "style")
        val free = add("Free", "tier" to "free")
        add("Other", "site" to "b.com")
        store.setOn(free.id, false)
        val answer = ModsState.PageAnswer(url, setOf(style.id), listOf(style.id to "not mine"), listOf("${free.id}: boom"), clock)
        val s = ModsState.build(store, ModsState.Page(url, false, setOf(style.id), clock - 5000), answer, 7, clock)
        assertEquals("a.com", s.getString("site"))
        assertEquals("www.a.com", s.getString("host"))
        assertEquals(7, s.getInt("seq"))
        val r = rows(s)
        assertEquals(listOf("Big", "Free"), r.map { it.getString("name") })
        assertTrue(r[0].getBoolean("running"))
        assertTrue(r[0].getBoolean("rules"))
        assertEquals(0, r[0].getJSONArray("errors").length()) // (a box error is a boxed mod's only)
        assertFalse(r[1].getBoolean("on"))
        assertEquals("boom", r[1].getJSONArray("errors").getString(0))
        assertEquals(JSONObject.NULL, s.get("recheck"))
    }

    @Test fun startingNextLoadAndCant() {
        val free = add("Free", "tier" to "free")
        // (switched on since the page loaded: next load)
        var s = ModsState.build(store, ModsState.Page(url, false, emptySet(), clock - 5000), null, 1, clock)
        assertTrue(rows(s)[0].optBoolean("nextLoad"))
        // (loaded with it, asked too soon after the page finished: starting, and asked again)
        val soon = ModsState.PageAnswer(url, emptySet(), emptyList(), emptyList(), clock)
        s = ModsState.build(store, ModsState.Page(url, false, setOf(free.id), clock - 500), soon, 2, clock)
        assertTrue(rows(s)[0].optBoolean("starting"))
        assertTrue(s.getDouble("recheck") > 1.0)
        // (asked a while after: a free mod that didn't start can't run here)
        s = ModsState.build(store, ModsState.Page(url, false, setOf(free.id), clock - 5000), soon, 3, clock)
        assertTrue(rows(s)[0].optBoolean("cant"))
    }

    @Test fun holdsTrashAndPause() {
        val held = add("Clicker", "tier" to "boxed", "needs" to JSONArray().put(JSONObject().put("key", "click").put("fact", "Clicks").put("lines", JSONArray().put("h1"))))
        val gone = add("Gone")
        store.remove(gone.id)
        store.setGroup("boxed", false, "a.com")
        store.setPaused(true)
        val s = ModsState.build(store, ModsState.Page(url, true, null, null), null, 1, clock)
        val r = rows(s).single()
        assertEquals(held.id, r.getString("id"))
        assertEquals("click", r.getJSONObject("held").getJSONArray("needs").getString(0))
        assertTrue(r.getJSONObject("held").getBoolean("asks"))
        assertEquals("Gone", s.getString("deleted"))
        assertEquals("Gone", s.getJSONArray("trash").getJSONObject(0).getString("name"))
        assertEquals("sandboxed", s.getJSONArray("groupsOff").getString(0))
        assertTrue(s.getBoolean("paused"))
        assertTrue(s.getBoolean("loading"))
    }

    @Test fun planSignatureFollowsWhatRunsThere() {
        val m = add("Big")
        val before = store.plan().signature(url)
        assertTrue(before.startsWith(m.id))
        assertEquals("", store.plan().signature("https://b.com/"))
        add("Other", "site" to "b.com")
        assertEquals(before, store.plan().signature(url)) // (another site's mod: no reload here)
        store.setOn(m.id, false)
        assertNotEquals(before, store.plan().signature(url))
        assertEquals("", store.plan().signature(url))
    }
}
