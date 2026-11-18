package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * What's kept of the tabs between launches (noBackupFilesDir/tabs.json, as iPhone's tabs.json kept out of backups):
 * each tab's id, address, title and back/forward list, and which tab was shown. The back/forward list is the
 * WebView's own saveState() bundle written as plain JSON (BundleJson), never a marshalled Parcel (Android says those
 * mustn't be stored); if the WebView can't read it back (a WebView update), the tab opens at its address instead.
 */
data class SavedTabs(val tabs: List<One>, val selected: String?) {
    data class One(val id: String, val url: String?, val title: String, val state: JSONObject?)

    fun toJson(): String = JSONObject().apply {
        put("tabs", JSONArray().apply {
            tabs.forEach { t ->
                put(JSONObject().apply {
                    put("id", t.id)
                    t.url?.let { put("url", it) }
                    put("title", t.title)
                    t.state?.let { put("state", it) }
                })
            }
        })
        selected?.let { put("selected", it) }
    }.toString()

    fun save(file: File) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(toJson())
        tmp.renameTo(file)
    }

    companion object {
        fun parse(text: String): SavedTabs? = try {
            val o = JSONObject(text)
            val list = o.optJSONArray("tabs") ?: JSONArray()
            val tabs = (0 until list.length()).mapNotNull { i ->
                val t = list.optJSONObject(i) ?: return@mapNotNull null
                val id = t.optString("id").ifEmpty { return@mapNotNull null }
                One(id, t.optString("url").ifEmpty { null }, t.optString("title"), t.optJSONObject("state"))
            }
            SavedTabs(tabs, o.optString("selected").ifEmpty { null })
        } catch (e: Exception) { null }

        fun load(file: File): SavedTabs? = if (file.exists()) parse(file.readText()) else null

        /** An address worth keeping for a tab: a web page's, not a blank or local page's. */
        fun keepable(url: String?): String? = url?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
    }
}

/** Where tabs go, as on iPhone: a new tab right after the shown one; closing the shown tab shows the one in its place. */
object TabOrder {
    fun insertAt(current: Int, count: Int): Int = if (current in 0 until count) current + 1 else count

    /** After closing the tab at [closed] (of [count] before closing): the index to show, or -1 for "make a new tab". */
    fun afterClose(closed: Int, count: Int): Int = if (count <= 1) -1 else minOf(closed, count - 2)
}
