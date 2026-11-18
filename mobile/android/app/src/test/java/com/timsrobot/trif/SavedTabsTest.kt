package com.timsrobot.trif

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.nio.file.Files

class SavedTabsTest {
    @Test fun roundTrip() {
        val state = JSONObject().put("WEBVIEW_CHROMIUM_STATE", JSONObject().put("t", "bytes").put("v", "AAEC"))
        val s = SavedTabs(listOf(SavedTabs.One("a", "https://x.com/", "X", state), SavedTabs.One("b", null, "", null)), "b")
        val back = SavedTabs.parse(s.toJson())!!
        assertEquals(2, back.tabs.size)
        assertEquals("b", back.selected)
        assertEquals("https://x.com/", back.tabs[0].url)
        assertEquals("X", back.tabs[0].title)
        assertEquals("AAEC", back.tabs[0].state!!.getJSONObject("WEBVIEW_CHROMIUM_STATE").getString("v"))
        assertNull(back.tabs[1].url)
        assertNull(back.tabs[1].state)
    }

    @Test fun fileAndBadInput() {
        val dir = Files.createTempDirectory("tabs").toFile()
        val f = File(dir, "tabs.json")
        assertNull(SavedTabs.load(f))
        SavedTabs(listOf(SavedTabs.One("a", "https://x.com/", "X", null)), "a").save(f)
        assertEquals("a", SavedTabs.load(f)!!.selected)
        f.writeText("not json")
        assertNull(SavedTabs.load(f))
        assertEquals(1, SavedTabs.parse("""{"tabs":[{"id":"a"},{"url":"https://no-id/"}]}""")!!.tabs.size)
        dir.deleteRecursively()
    }

    @Test fun keepable() {
        assertEquals("https://x.com/", SavedTabs.keepable("https://x.com/"))
        assertEquals("http://localhost:8477/", SavedTabs.keepable("http://localhost:8477/"))
        assertNull(SavedTabs.keepable("about:blank"))
        assertNull(SavedTabs.keepable("data:text/html,hi"))
        assertNull(SavedTabs.keepable(null))
    }

    @Test fun order() {
        assertEquals(0, TabOrder.insertAt(-1, 0))
        assertEquals(2, TabOrder.insertAt(1, 3))
        assertEquals(3, TabOrder.insertAt(-1, 3))
        assertEquals(-1, TabOrder.afterClose(0, 1))
        assertEquals(0, TabOrder.afterClose(0, 3))
        assertEquals(1, TabOrder.afterClose(2, 3))
        assertEquals(1, TabOrder.afterClose(1, 3))
    }

    @Test fun aClosedWindowGoesBackToItsOpener() {
        // opener 0, window 1, another tab 2: back to 0, not 2
        assertEquals(0, TabOrder.afterClose(1, 3, opener = 0))
        // opener after the window (moved): its index shifts down by one
        assertEquals(1, TabOrder.afterClose(0, 3, opener = 2))
        // opener gone or none: the usual
        assertEquals(1, TabOrder.afterClose(1, 3, opener = -1))
        assertEquals(1, TabOrder.afterClose(1, 3, opener = 7))
        assertEquals(-1, TabOrder.afterClose(0, 1, opener = 0))
    }
}
