package com.timsrobot.trif

import android.Manifest
import android.webkit.PermissionRequest

/**
 * A page asking for the camera, the microphone or the location (getUserMedia, geolocation). WKWebView asks the
 * person by itself, per site ("Allow “site” to use your camera?"); a WebView asks nobody, so TRIF does: its own
 * question per site first (a draft for Tim, after WebKit's), then, only if TRIF hasn't got it yet, Android's own
 * runtime permission ask (the system's dialog and words). Only what was asked is granted, and only what Android
 * granted. The answer is kept per site for the launch (Allow and Don't Allow), so a page can't ask again and again.
 * A tab behind, or TRIF not in front: no question, refused. Anything else a page asks for (protected media, MIDI):
 * refused, as WebView's default.
 */
object PageAsks {
    enum class Kind(val permissions: List<String>) {
        CAMERA(listOf(Manifest.permission.CAMERA)),
        MIC(listOf(Manifest.permission.RECORD_AUDIO)),
        // (either is enough: Android 12+ lets the person pick approximate)
        LOCATION(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)),
    }

    /** What a WebView PermissionRequest's resources are, of the ones TRIF asks about. */
    fun kinds(resources: Array<String>): Set<Kind> = resources.mapNotNull {
        when (it) {
            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Kind.CAMERA
            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Kind.MIC
            else -> null
        }
    }.toSet()

    fun resource(k: Kind) = when (k) {
        Kind.CAMERA -> PermissionRequest.RESOURCE_VIDEO_CAPTURE
        Kind.MIC -> PermissionRequest.RESOURCE_AUDIO_CAPTURE
        Kind.LOCATION -> null
    }

    /** The question's words (strings.xml) for what's asked. */
    fun question(kinds: Set<Kind>) = when {
        Kind.LOCATION in kinds -> R.string.page_ask_location
        Kind.CAMERA in kinds && Kind.MIC in kinds -> R.string.page_ask_camera_mic
        Kind.CAMERA in kinds -> R.string.page_ask_camera
        else -> R.string.page_ask_mic
    }

    /** The note when Android won't let TRIF have it (switched off for TRIF in Android's settings). */
    fun refusedNote(kinds: Set<Kind>) = when {
        Kind.LOCATION in kinds -> R.string.page_ask_off_location
        Kind.CAMERA in kinds && Kind.MIC in kinds -> R.string.page_ask_off_camera_mic
        Kind.CAMERA in kinds -> R.string.page_ask_off_camera
        else -> R.string.page_ask_off_mic
    }

    /** What Android must still give TRIF for these, given what it has (`has`). */
    fun missing(kinds: Set<Kind>, has: (String) -> Boolean): List<String> =
        kinds.filter { k -> k.permissions.none(has) }.flatMap { it.permissions }

    /** Of what was asked, what Android lets TRIF have (`has`, after its ask). */
    fun allowed(kinds: Set<Kind>, has: (String) -> Boolean): Set<Kind> = kinds.filter { k -> k.permissions.any(has) }.toSet()

    sealed class Decision {
        object Refuse : Decision()
        /** Kept from earlier this launch: these were allowed (empty: Don't Allow). */
        data class Known(val allowed: Set<Kind>) : Decision()
        object Ask : Decision()
    }

    /**
     * What to do with a page's ask: `onScreen` = its tab is the one shown and TRIF is in front; `asking` = a
     * question is already up (one at a time: a second ask is refused); `kept` = the site's answers this launch.
     */
    fun decide(kinds: Set<Kind>, onScreen: Boolean, asking: Boolean, kept: Map<Kind, Boolean>): Decision {
        if (kinds.isEmpty()) return Decision.Refuse
        if (kinds.all { it in kept }) return Decision.Known(kinds.filter { kept[it] == true }.toSet())
        if (!onScreen || asking) return Decision.Refuse
        return Decision.Ask
    }

    /** The answers this launch, per site (the page's origin) and kind. */
    class Kept {
        private val answers = mutableMapOf<String, MutableMap<Kind, Boolean>>()
        fun of(origin: String): Map<Kind, Boolean> = answers[key(origin)] ?: emptyMap()
        fun put(origin: String, kinds: Set<Kind>, allowed: Boolean) {
            val m = answers.getOrPut(key(origin)) { mutableMapOf() }
            kinds.forEach { m[it] = allowed }
        }
        private fun key(origin: String) = origin.trimEnd('/').lowercase()
    }

    /** The site as the question names it: the origin's host (and port when there is one), not its scheme. */
    fun site(origin: String): String = origin.trimEnd('/').substringAfter("://")
}

/** A page's download (setDownloadListener): a .js file of 2 MB at most goes to Add this mod? (iPhone's ModDownloads,
 *  Tim 11-16); anything else is let go, as on iPhone. */
object PageDownloads {
    const val MAX = 2_000_000L

    /** The file's name: Content-Disposition's filename* or filename, else the address's last part. */
    fun name(url: String, disposition: String?): String {
        val d = disposition.orEmpty()
        Regex("""filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)""").find(d)?.let {
            return runCatching { java.net.URLDecoder.decode(it.groupValues[1].trim(), "UTF-8") }.getOrDefault(it.groupValues[1].trim())
        }
        Regex("""filename\s*=\s*"([^"]*)"""").find(d)?.let { return it.groupValues[1] }
        Regex("""filename\s*=\s*([^;]+)""").find(d)?.let { return it.groupValues[1].trim() }
        if (url.startsWith("data:") || url.startsWith("blob:")) return ""
        return url.substringBefore('#').substringBefore('?').substringAfterLast('/')
    }

    /**
     * Taken (to Add this mod?) or let go. A .js name, or a page's own made file (blob:, data:) of JavaScript;
     * not over 2 MB when its length is known (-1: unknown, cut at 2 MB while reading).
     */
    fun wanted(url: String, disposition: String?, mime: String?, length: Long): Boolean {
        val scheme = url.substringBefore(':').lowercase()
        if (scheme !in setOf("http", "https", "blob", "data")) return false
        if (length > MAX) return false
        val n = name(url, disposition).lowercase()
        if (n.endsWith(".js")) return true
        return (scheme == "blob" || scheme == "data") && n.isEmpty() && (mime.orEmpty().lowercase().let { "javascript" in it })
    }

    /** A data: address's text (base64 or not), or null. */
    fun dataText(url: String): String? {
        if (!url.startsWith("data:")) return null
        val comma = url.indexOf(',').takeIf { it > 0 } ?: return null
        val head = url.substring(5, comma)
        val body = url.substring(comma + 1)
        return runCatching {
            if (head.endsWith(";base64")) String(java.util.Base64.getDecoder().decode(java.net.URLDecoder.decode(body, "UTF-8")), Charsets.UTF_8)
            else java.net.URLDecoder.decode(body.replace("+", "%2B"), "UTF-8")
        }.getOrNull()?.takeIf { it.length <= MAX }
    }
}
