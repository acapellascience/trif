package com.timsrobot.trif

import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipInputStream

/**
 * Bringing mods in from people's other browsers, and sending them out (iPhone's Import.swift ModFiles and Zip).
 *
 * In: what desktop TRIF exports (helper/lib/share.js: a mod's file, <site>-<mod>.js, or a site's mods, a folder
 * "<site> mods" of .js files, which reaches a phone as its files or as a .zip), picked with Import mod… or opened with
 * TRIF / shared to it. Zips are gone through (zips in zips too); names starting with "." and __MACOSX/ are left out.
 * Another browser's history export (.json): Android has no history yet, so it's skipped (said as not importable).
 * Out: a mod as its file <site>-<mod>.js; a site's mods as <mod>.js each (iPhone's folder "<site> mods").
 * Pure: no Android.
 */
object ModImport {
    /** At most this much read in all (a mod is small; iPhone's limit, sized for history exports). */
    const val LIMIT = 64 shl 20

    class Found {
        val mods = mutableListOf<Pair<String, String>>()
        val skipped = mutableListOf<String>()
        /** what's left to read */
        var budget = LIMIT
    }

    /** One file picked or opened: its name and bytes (null: it couldn't be read, or it's over what's left). */
    fun take(found: Found, name: String, data: ByteArray?) {
        val last = name.substringAfterLast('/')
        val lower = name.lowercase()
        if (last.startsWith(".") || "__macosx/" in lower) return
        if (data == null) { found.skipped += last; return }
        when {
            lower.endsWith(".js") -> {
                val text = runCatching { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(data)).toString() }.getOrNull()
                if (text != null) found.mods += last to text else found.skipped += last
            }
            lower.endsWith(".zip") -> unzip(data, found.budget).forEach { (n, d) -> take(found, n, d) }
            else -> found.skipped += last
        }
    }

    /** A zip's files (stored or deflated), each at most a sixth of `limit` and all together at most `limit` unpacked
     *  (iPhone's Zip.entries). A broken or unreadable zip gives what was read before the break. */
    fun unzip(zip: ByteArray, limit: Int): List<Pair<String, ByteArray>> {
        val out = mutableListOf<Pair<String, ByteArray>>()
        var total = 0
        runCatching {
            ZipInputStream(ByteArrayInputStream(zip)).use { z ->
                while (true) {
                    val e = z.nextEntry ?: break
                    if (e.isDirectory) continue
                    val most = minOf(limit / 6, limit - total)
                    val data = z.readNBytes(most + 1)
                    if (data.size > most) continue
                    out += e.name to data
                    total += data.size
                }
            }
        }
        return out
    }

    /** A mod's file name when sent out: alone, <site>-<mod>.js (desktop's export name); with its site's, <mod>.js. */
    fun fileName(m: InstalledMod, alone: Boolean): String {
        val parts = m.id.split('/')
        val name = parts.last().ifEmpty { "mod" }
        return if (alone) "${parts.first().ifEmpty { "mod" }}-$name.js" else "$name.js"
    }

    /** Mods as files under `dir` (made fresh): one alone, or several in a folder "<site> mods". */
    fun write(mods: List<InstalledMod>, dir: File, folder: String? = null): List<File>? = runCatching {
        val d = if (folder != null) File(dir, folder) else dir
        d.mkdirs()
        mods.map { m -> File(d, fileName(m, folder == null)).apply { writeText(m.code) } }
    }.getOrNull()

    /** A fresh folder for files sent out (<cache>/export/<n>: the share sheet reads them through FileProvider,
     *  res/xml/shared_files.xml); the ones sent before are cleared. */
    fun exportDir(cache: File): File {
        val root = File(cache, "export")
        root.deleteRecursively()
        return File(root, System.currentTimeMillis().toString(36)).apply { mkdirs() }
    }

    /** Export all mods for {site}: their files in a folder "<site> mods"; null if there are none (or no room). */
    fun exportSite(mods: List<InstalledMod>, site: String, cache: File): List<File>? =
        ofSite(mods, site).takeIf { it.isNotEmpty() }?.let { write(it, exportDir(cache), "$site mods") }

    /** The mods a site's Export all sends: those kept under the site or a host in it (iPhone's exportSite). */
    fun ofSite(mods: List<InstalledMod>, site: String) = mods.filter { it.site == site || Site.hostIsIn(it.site, site) }

    /** What the status strip says after an import (iPhone's importFiles words). */
    fun said(added: List<String>, failed: List<String>, skipped: List<String>): String {
        val said = mutableListOf<String>()
        val one = added.size == 1
        if (added.isNotEmpty()) said += "Imported ${if (one) "1 mod" else "${added.size} mods"}: ${added.joinToString(", ")}. " +
            "Like any mod from outside, ${if (one) "it starts" else "they start"} off, and ${if (one) "waits" else "each waits"} " +
            "for your OK if ${if (one) "its" else "its own"} code can do more than change the page."
        said += failed
        if (said.isEmpty()) said += if (skipped.isEmpty()) "Nothing to import there." else "Nothing TRIF can import there: ${skipped.take(5).joinToString(", ")}."
        return said.joinToString(" ")
    }
}
