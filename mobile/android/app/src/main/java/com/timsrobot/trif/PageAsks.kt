package com.timsrobot.trif

import android.Manifest
import android.webkit.PermissionRequest

/**
 * A page asking for the camera, the microphone or the location (getUserMedia, geolocation). WKWebView asks the
 * person by itself, per site ("Allow “site” to use your camera?"); a WebView asks nobody, so TRIF does: its own
 * question per site first (a draft for Tim, after WebKit's), then, only if TRIF hasn't got it yet, Android's own
 * runtime permission ask (the system's dialog and words). Only what was asked is granted, and only what Android
 * granted. The answer is kept per site for the launch (Allow and Don't Allow), so a page can't ask again and again.
 * A tab behind, or TRIF not in front: no question, refused.
 *
 * Protected (DRM) video (Tim 11-18): as Chrome on Android (its Site settings → Protected content: allowed by default,
 * per-site exceptions kept for good): allowed without a question, unless switched off for the site (the Mods tab's ⋯,
 * "Protected content on {site}"). That choice lasts across launches, in a small file; the other answers last
 * for the launch. Anything else (MIDI): refused, as WebView's default.
 */
object PageAsks {
    /** `lasting`: its answer is kept across launches. */
    enum class Kind(val permissions: List<String>, val lasting: Boolean = false) {
        CAMERA(listOf(Manifest.permission.CAMERA)),
        MIC(listOf(Manifest.permission.RECORD_AUDIO)),
        // (either is enough: Android 12+ lets the person pick approximate)
        LOCATION(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)),
        PROTECTED(emptyList(), lasting = true),
    }

    /** What a WebView PermissionRequest's resources are, of the ones TRIF asks about. */
    fun kinds(resources: Array<String>): Set<Kind> = resources.mapNotNull {
        when (it) {
            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Kind.CAMERA
            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Kind.MIC
            PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID -> Kind.PROTECTED
            else -> null
        }
    }.toSet()

    fun resource(k: Kind) = when (k) {
        Kind.CAMERA -> PermissionRequest.RESOURCE_VIDEO_CAPTURE
        Kind.MIC -> PermissionRequest.RESOURCE_AUDIO_CAPTURE
        Kind.PROTECTED -> PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
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
    fun allowed(kinds: Set<Kind>, has: (String) -> Boolean): Set<Kind> =
        kinds.filter { k -> k.permissions.isEmpty() || k.permissions.any(has) }.toSet()

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
        // (protected video: never asked, Chrome's default; only a site switched off is refused; never folded into a
        // camera ask)
        if (Kind.PROTECTED in kinds) return if (kinds.size > 1) Decision.Refuse else Decision.Known(if (protectedOn(kept)) kinds else emptySet())
        if (kinds.all { it in kept }) return Decision.Known(kinds.filter { kept[it] == true }.toSet())
        if (!onScreen || asking) return Decision.Refuse
        return Decision.Ask
    }

    /** Protected video on a site, given its kept answers: on unless switched off. */
    fun protectedOn(kept: Map<Kind, Boolean>) = kept[Kind.PROTECTED] != false

    /**
     * The answers per site (the page's origin) and kind: this launch's, and the lasting kinds' from `file` (one
     * "<origin> <KIND> 1|0" a line; a missing or unreadable file = none kept).
     */
    class Kept(private val file: java.io.File? = null) {
        private val answers = mutableMapOf<String, MutableMap<Kind, Boolean>>()
        init {
            runCatching { file?.takeIf { it.exists() }?.readLines() }.getOrNull()?.forEach { line ->
                val p = line.trim().split(' ')
                val k = Kind.entries.firstOrNull { it.name == p.getOrNull(1) }
                if (p.size == 3 && k != null && k.lasting) answers.getOrPut(p[0]) { mutableMapOf() }[k] = p[2] == "1"
            }
        }
        fun of(origin: String): Map<Kind, Boolean> = answers[key(origin)] ?: emptyMap()
        fun put(origin: String, kinds: Set<Kind>, allowed: Boolean) {
            val m = answers.getOrPut(key(origin)) { mutableMapOf() }
            kinds.forEach { m[it] = allowed }
            if (file != null && kinds.any { it.lasting }) save(file)
        }
        private fun save(f: java.io.File) = runCatching {
            val text = answers.flatMap { (o, m) -> m.filterKeys { it.lasting }.map { (k, v) -> "$o ${k.name} ${if (v) 1 else 0}\n" } }.joinToString("")
            val tmp = java.io.File(f.path + ".tmp"); tmp.writeText(text); tmp.renameTo(f)
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
