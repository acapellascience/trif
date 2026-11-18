package com.timsrobot.trif

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLinksTest {
    @Test fun kinds() {
        assertEquals(AppLinks.Kind.WEB, AppLinks.kind("https://example.com"))
        assertEquals(AppLinks.Kind.WEB, AppLinks.kind("HTTP://example.com"))
        assertEquals(AppLinks.Kind.STAY, AppLinks.kind("about:blank"))
        assertEquals(AppLinks.Kind.STAY, AppLinks.kind("blob:https://x/1"))
        assertEquals(AppLinks.Kind.NEVER, AppLinks.kind("javascript:alert(1)"))
        assertEquals(AppLinks.Kind.NEVER, AppLinks.kind("file:///sdcard/x"))
        assertEquals(AppLinks.Kind.NEVER, AppLinks.kind("content://x/y"))
        assertEquals(AppLinks.Kind.NEVER, AppLinks.kind("no scheme"))
        assertEquals(AppLinks.Kind.OWN, AppLinks.kind("trif://mods"))
        assertEquals(AppLinks.Kind.OTHER, AppLinks.kind("tel:+15555550100"))
        assertEquals(AppLinks.Kind.OTHER, AppLinks.kind("mailto:a@b.c"))
        assertEquals(AppLinks.Kind.OTHER, AppLinks.kind("market://details?id=x"))
        assertEquals(AppLinks.Kind.OTHER, AppLinks.kind("fb-messenger://user/1"))
        assertEquals(AppLinks.Kind.OTHER, AppLinks.kind("intent://x#Intent;scheme=zoomus;package=us.zoom.videomeetings;end"))
    }

    @Test fun intentsForThisAppAreOwn() {
        assertEquals(AppLinks.Kind.OWN, AppLinks.kind("intent://x#Intent;scheme=https;package=com.timsrobot.trif;end"))
        assertEquals(AppLinks.Kind.OWN, AppLinks.kind("intent://x#Intent;component=com.timsrobot.trif/.MainActivity;end"))
        assertEquals(AppLinks.Kind.OWN, AppLinks.kind("intent://mods#Intent;scheme=trif;end"))
        assertEquals(AppLinks.Kind.OWN, AppLinks.kind("android-app://com.timsrobot.trif/https/example.com"))
        assertEquals(AppLinks.Kind.OTHER, AppLinks.kind("intent://x#Intent;scheme=https;package=com.timsrobot.trifx;end"))
    }

    @Test fun decisions() {
        assertEquals(AppLinks.Decision.Open, AppLinks.decide(tapped = true, mainFrame = false, askedThisLoad = true, asking = true, mayAsk = false))
        assertEquals(AppLinks.Decision.Ask, AppLinks.decide(tapped = false, mainFrame = true, askedThisLoad = false, asking = false))
        assertTrue(AppLinks.decide(false, mainFrame = false, askedThisLoad = false, asking = false) is AppLinks.Decision.Drop)
        assertTrue(AppLinks.decide(false, mainFrame = true, askedThisLoad = true, asking = false) is AppLinks.Decision.Drop)
        assertTrue(AppLinks.decide(false, mainFrame = true, askedThisLoad = false, asking = true) is AppLinks.Decision.Drop)
        assertTrue(AppLinks.decide(false, mainFrame = true, askedThisLoad = false, asking = false, mayAsk = false) is AppLinks.Decision.Drop)
    }

    @Test fun taps() {
        assertTrue(AppLinks.isTap(gesture = true, sinceLift = 200, touching = false))
        assertTrue(AppLinks.isTap(gesture = true, sinceLift = null, touching = true))
        assertFalse(AppLinks.isTap(gesture = true, sinceLift = 4000, touching = false))
        assertFalse(AppLinks.isTap(gesture = false, sinceLift = 100, touching = true))
        assertFalse(AppLinks.isTap(gesture = true, sinceLift = null, touching = false))
    }

    @Test fun fallbacks() {
        assertEquals("http://localhost:8477/plain.html",
            AppLinks.fallback("intent://p#Intent;scheme=x;S.browser_fallback_url=http%3A%2F%2Flocalhost%3A8477%2Fplain.html;end"))
        assertNull(AppLinks.fallback("intent://p#Intent;scheme=x;S.browser_fallback_url=javascript%3Aalert(1);end"))
        assertNull(AppLinks.fallback("intent://p#Intent;scheme=x;end"))
        assertNull(AppLinks.fallback("tel:1"))
    }

    @Test fun loggedIsSchemeOnly() {
        assertEquals("mailto:", AppLinks.logged("mailto:someone@example.com"))
        assertEquals("tel:", AppLinks.logged("TEL:+1555"))
    }
}
