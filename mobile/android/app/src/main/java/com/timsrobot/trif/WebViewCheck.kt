package com.timsrobot.trif

/**
 * Whether this phone's WebView can run TRIF, checked before any WebView is made (a missing or too old WebView
 * would crash or silently drop the script worlds). TRIF needs script worlds in every frame
 * (`JS_INJECTION_IN_FRAME_AND_WORLD`): WebView 149 has them, 145 doesn't (the probe, 11-18). The feature decides; the
 * version number is only for the message.
 */
object WebViewCheck {
    const val MINIMUM = 149

    sealed interface Result {
        data object Ok : Result
        /** No WebView: switched off, or none installed. */
        data object Missing : Result
        /** A WebView without script worlds. [major] is its version (null when unreadable); [pkg] its package. */
        data class TooOld(val major: Int?, val pkg: String) : Result
    }

    /** The version's first number ("149.0.7827.5" → 149), null if there's none. */
    fun major(versionName: String?): Int? = versionName?.trim()?.substringBefore('.')?.toIntOrNull()

    /** [pkg]/[versionName]: the WebView package Android uses (null for none); [worlds]: it has script worlds. */
    fun decide(pkg: String?, versionName: String?, worlds: Boolean): Result = when {
        pkg == null -> Result.Missing
        worlds -> Result.Ok
        else -> Result.TooOld(major(versionName), pkg)
    }
}
