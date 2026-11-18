package com.timsrobot.trif

import android.os.SystemClock
import android.view.MotionEvent
import android.view.View

/**
 * Links that aren't web pages (tel:, mailto:, sms:, geo:, market:, intent:, an app's own scheme): handed to
 * Android, as iPhone's AppLinks hands them to iOS (Tim, 11-18). Only at once when the person tapped; a page (or a
 * mod) trying it by itself gets the question instead, at most one at a time and one a load; never from a frame
 * inside the page unless tapped. http/https always stay in TRIF (the default-browser rules). No Android classes
 * here, so the unit tests run on the JVM.
 */
object AppLinks {
    enum class Kind {
        /** http/https: TRIF's own business */
        WEB,
        /** about:, blob:, data:: they stay in the WebView */
        STAY,
        /** javascript: (runs in its page, never anywhere else), file:, content: (never opened) */
        NEVER,
        /** trif: and the app's other schemes, or an intent: for this app: never handed out (the page opening TRIF) */
        OWN,
        /** anything else: another app's */
        OTHER,
    }

    sealed class Decision {
        /** to Android now (the person tapped) */
        object Open : Decision()
        /** the question first */
        object Ask : Decision()
        /** nothing (and why, for the log) */
        data class Drop(val why: String) : Decision()
    }

    const val PACKAGE = "com.timsrobot.trif"
    val ownSchemes = setOf("trif", "trifpanel")

    fun scheme(url: String): String = url.substringBefore(':', "").lowercase().takeIf { s ->
        s.isNotEmpty() && s[0].isLetter() && s.all { it.isLetterOrDigit() || it in "+-." }
    } ?: ""

    fun kind(url: String): Kind {
        val s = scheme(url)
        return when {
            s.isEmpty() -> Kind.NEVER
            s == "http" || s == "https" -> Kind.WEB
            s in setOf("about", "blob", "data") -> Kind.STAY
            s in setOf("javascript", "file", "content") -> Kind.NEVER
            s in ownSchemes -> Kind.OWN
            (s == "intent" || s == "android-app") && forThisApp(url) -> Kind.OWN
            else -> Kind.OTHER
        }
    }

    /** An intent: (or android-app:) link naming this app, its package or one of its schemes. */
    private fun forThisApp(url: String): Boolean {
        if (scheme(url) == "android-app") return url.substringAfter("://").substringBefore('/') == PACKAGE
        val extras = ";" + url.substringAfter("#Intent;", "") + ";"
        return extras.contains(";package=$PACKAGE;") || extras.contains("component=$PACKAGE/") ||
            ownSchemes.any { extras.contains(";scheme=$it;") }
    }

    /**
     * What to do with another app's link.
     * - tapped: the person tapped it (a link or form, their finger on the page a moment ago)
     * - mainFrame: the page itself (or a new window), not a frame inside it
     * - askedThisLoad: the question was already put for this page's load (answered either way)
     * - asking: a question is up now
     * - mayAsk: the page is on the screen and the app in front
     */
    fun decide(tapped: Boolean, mainFrame: Boolean, askedThisLoad: Boolean, asking: Boolean, mayAsk: Boolean = true): Decision = when {
        tapped -> Decision.Open
        !mayAsk -> Decision.Drop("not tapped, not on the screen")
        !mainFrame -> Decision.Drop("a frame inside the page, not tapped")
        asking -> Decision.Drop("a question is already up")
        askedThisLoad -> Decision.Drop("asked once on this page already")
        else -> Decision.Ask
    }

    /**
     * Counts as tapped when the WebView says a gesture led to it (Chromium's: a tap's activation lasts ~5 s, so a
     * script can borrow it) and the person's finger was on the page just now, as iPhone's.
     */
    fun isTap(gesture: Boolean, sinceLift: Long?, touching: Boolean): Boolean =
        gesture && (touching || (sinceLift != null && sinceLift in 0 until TAP_WINDOW_MS))
    const val TAP_WINDOW_MS = 1500L

    /** An intent: link's S.browser_fallback_url, if it's a web page (what Chrome opens when no app takes it). */
    fun fallback(url: String): String? {
        if (scheme(url) != "intent") return null
        val raw = url.substringAfter("#Intent;", "").split(';').firstOrNull { it.startsWith("S.browser_fallback_url=") }
            ?.substringAfter('=') ?: return null
        val decoded = runCatching { java.net.URLDecoder.decode(raw, "UTF-8") }.getOrNull() ?: return null
        return decoded.takeIf { kind(it) == Kind.WEB }
    }

    /** What the log may say about it: the scheme only (a mailto:'s address or a tel:'s number is the person's). */
    fun logged(url: String) = "${scheme(url).ifEmpty { "?" }}:"
}

/**
 * When the person's finger was last on a page: what tells a tapped link from a page's script ([AppLinks.isTap]).
 * Only watches: never takes, delays or cancels a touch.
 */
object TouchClock {
    private var lastLift: Long? = null
    private var down = 0

    fun tapped(gesture: Boolean) =
        AppLinks.isTap(gesture, lastLift?.let { SystemClock.uptimeMillis() - it }, down > 0)

    fun watch(v: View) = v.setOnTouchListener { _, e ->
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> down++
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_CANCEL -> {
                down = if (e.actionMasked == MotionEvent.ACTION_CANCEL) 0 else maxOf(0, down - 1)
                lastLift = SystemClock.uptimeMillis()
            }
        }
        false
    }
}
