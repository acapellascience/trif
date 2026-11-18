package com.timsrobot.trif

import com.timsrobot.trif.PageAsks.Decision
import com.timsrobot.trif.PageAsks.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageAsksTest {
    private val cam = "android.webkit.resource.VIDEO_CAPTURE"
    private val mic = "android.webkit.resource.AUDIO_CAPTURE"

    private val drm = "android.webkit.resource.PROTECTED_MEDIA_ID"

    @Test fun kindsAreCameraMicAndProtected() {
        assertEquals(setOf(Kind.CAMERA, Kind.MIC), PageAsks.kinds(arrayOf(cam, mic)))
        assertEquals(setOf(Kind.PROTECTED), PageAsks.kinds(arrayOf(drm, "android.webkit.resource.MIDI_SYSEX")))
        assertEquals(emptySet<Kind>(), PageAsks.kinds(arrayOf("android.webkit.resource.MIDI_SYSEX")))
        assertEquals(cam, PageAsks.resource(Kind.CAMERA))
        assertEquals(drm, PageAsks.resource(Kind.PROTECTED))
    }

    @Test fun protectedVideoAsChrome() {
        val p = setOf(Kind.PROTECTED)
        // (Chrome on Android's default: allowed with no question, even behind; refused only when switched off)
        assertEquals(Decision.Known(p), PageAsks.decide(p, true, false, emptyMap()))
        assertEquals(Decision.Known(p), PageAsks.decide(p, false, true, emptyMap()))
        assertEquals(Decision.Known(emptySet()), PageAsks.decide(p, true, false, mapOf(Kind.PROTECTED to false)))
        assertEquals(Decision.Known(p), PageAsks.decide(p, true, false, mapOf(Kind.PROTECTED to true, Kind.CAMERA to false)))
        assertEquals(Decision.Refuse, PageAsks.decide(p + Kind.CAMERA, true, false, emptyMap()))
        // (no Android permission behind it)
        assertEquals(emptyList<String>(), PageAsks.missing(p) { false })
        assertEquals(p, PageAsks.allowed(p) { false })
    }

    @Test fun protectedAnswersLastAcrossLaunches() {
        val f = java.io.File.createTempFile("page-asks", ".txt").apply { delete() }
        try {
            val k = PageAsks.Kept(f)
            k.put("https://Stream.example/", setOf(Kind.PROTECTED), true)
            k.put("https://other.example", setOf(Kind.PROTECTED), false)
            k.put("https://stream.example", setOf(Kind.CAMERA), true)
            val next = PageAsks.Kept(f) // a new launch
            assertEquals(mapOf(Kind.PROTECTED to true), next.of("https://stream.example"))
            assertEquals(mapOf(Kind.PROTECTED to false), next.of("https://other.example"))
            k.put("https://other.example", setOf(Kind.PROTECTED), true)
            assertEquals(mapOf(Kind.PROTECTED to true), PageAsks.Kept(f).of("https://other.example"))
            f.writeText("junk\nhttps://x.example CAMERA 1\n")
            assertTrue(PageAsks.Kept(f).of("https://x.example").isEmpty())
        } finally { f.delete() }
    }

    @Test fun decide() {
        val both = setOf(Kind.CAMERA, Kind.MIC)
        assertEquals(Decision.Ask, PageAsks.decide(both, onScreen = true, asking = false, kept = emptyMap()))
        assertEquals(Decision.Refuse, PageAsks.decide(both, onScreen = false, asking = false, kept = emptyMap()))
        assertEquals(Decision.Refuse, PageAsks.decide(both, onScreen = true, asking = true, kept = emptyMap()))
        assertEquals(Decision.Refuse, PageAsks.decide(emptySet(), true, false, emptyMap()))
        // (answered earlier this launch: kept, even behind; only part answered: asked again)
        assertEquals(Decision.Known(both), PageAsks.decide(both, false, false, mapOf(Kind.CAMERA to true, Kind.MIC to true)))
        assertEquals(Decision.Known(emptySet()), PageAsks.decide(both, true, false, mapOf(Kind.CAMERA to false, Kind.MIC to false)))
        assertEquals(Decision.Known(setOf(Kind.MIC)), PageAsks.decide(setOf(Kind.MIC), true, false, mapOf(Kind.CAMERA to false, Kind.MIC to true)))
        assertEquals(Decision.Ask, PageAsks.decide(both, true, false, mapOf(Kind.MIC to true)))
    }

    @Test fun keptPerSite() {
        val k = PageAsks.Kept()
        k.put("https://Meet.example/", setOf(Kind.CAMERA), true)
        assertEquals(mapOf(Kind.CAMERA to true), k.of("https://meet.example"))
        assertTrue(k.of("https://other.example").isEmpty())
        assertTrue(k.of("http://meet.example").isEmpty())
        assertEquals("localhost:8477", PageAsks.site("http://localhost:8477/"))
    }

    @Test fun androidPermissions() {
        val loc = setOf(Kind.LOCATION)
        assertEquals(listOf("android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"), PageAsks.missing(loc) { false })
        // (approximate alone is enough)
        assertEquals(emptyList<String>(), PageAsks.missing(loc) { it.endsWith("COARSE_LOCATION") })
        assertEquals(loc, PageAsks.allowed(loc) { it.endsWith("COARSE_LOCATION") })
        assertEquals(setOf(Kind.MIC), PageAsks.allowed(setOf(Kind.CAMERA, Kind.MIC)) { it.endsWith("RECORD_AUDIO") })
        assertEquals(listOf("android.permission.CAMERA"), PageAsks.missing(setOf(Kind.CAMERA, Kind.MIC)) { it.endsWith("RECORD_AUDIO") })
        assertEquals(R.string.page_ask_camera_mic, PageAsks.question(setOf(Kind.CAMERA, Kind.MIC)))
        assertEquals(R.string.page_ask_location, PageAsks.question(loc))
    }

    @Test fun downloadNames() {
        assertEquals("calmer.js", PageDownloads.name("http://x/stand-in-file/calmer.js", "attachment; filename=\"calmer.js\""))
        assertEquals("my mod.js", PageDownloads.name("http://x/get?id=3", "attachment; filename*=UTF-8''my%20mod.js"))
        assertEquals("a.js", PageDownloads.name("http://x/get", "attachment; filename=a.js; size=3"))
        assertEquals("mod.js", PageDownloads.name("https://x/dir/mod.js?v=2#top", null))
        assertEquals("", PageDownloads.name("blob:https://x/1234-5678", ""))
    }

    @Test fun downloadsWanted() {
        assertTrue(PageDownloads.wanted("https://x/mod.js", null, "text/javascript", 300))
        assertTrue(PageDownloads.wanted("https://x/f", "attachment; filename=\"Mod.JS\"", "application/octet-stream", -1))
        assertFalse(PageDownloads.wanted("https://x/mod.js", null, "text/javascript", 2_000_001))
        assertFalse(PageDownloads.wanted("https://x/photo.png", null, "image/png", 300))
        assertFalse(PageDownloads.wanted("ftp://x/mod.js", null, null, 3))
        assertTrue(PageDownloads.wanted("blob:https://x/1234", "", "text/javascript", 40))
        assertFalse(PageDownloads.wanted("blob:https://x/1234", "", "image/png", 40))
        assertTrue(PageDownloads.wanted("data:text/javascript;base64,Ly8=", null, "text/javascript", 4))
    }

    @Test fun dataText() {
        assertEquals("// hi", PageDownloads.dataText("data:text/javascript;base64,Ly8gaGk="))
        assertEquals("a + b", PageDownloads.dataText("data:text/javascript,a%20+%20b"))
        assertEquals(null, PageDownloads.dataText("https://x"))
    }
}
