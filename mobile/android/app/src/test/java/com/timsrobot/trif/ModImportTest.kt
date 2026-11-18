package com.timsrobot.trif

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ModImportTest {
    private fun zip(vararg files: Pair<String, ByteArray>, stored: Boolean = false): ByteArray = ByteArrayOutputStream().also { b ->
        ZipOutputStream(b).use { z ->
            for ((n, d) in files) {
                val e = ZipEntry(n)
                if (stored) { e.method = ZipEntry.STORED; e.size = d.size.toLong(); e.crc = java.util.zip.CRC32().apply { update(d) }.value }
                z.putNextEntry(e); z.write(d); z.closeEntry()
            }
        }
    }.toByteArray()

    @Test fun filesAndZips() {
        val f = ModImport.Found()
        ModImport.take(f, "a.com-one.js", "// one".toByteArray())
        ModImport.take(f, "notes.txt", "x".toByteArray())
        ModImport.take(f, ".hidden.js", "x".toByteArray())
        ModImport.take(f, "History.json", "{}".toByteArray())
        ModImport.take(f, "gone.js", null)
        ModImport.take(f, "b.com mods.zip", zip(
            "b.com mods/" to ByteArray(0),
            "b.com mods/two.js" to "// two".toByteArray(),
            "__MACOSX/b.com mods/._two.js" to "junk".toByteArray(),
            "inner.zip" to zip("three.js" to "// three".toByteArray(), stored = true),
        ))
        assertEquals(listOf("a.com-one.js" to "// one", "two.js" to "// two", "three.js" to "// three"), f.mods)
        assertEquals(listOf("notes.txt", "History.json", "gone.js"), f.skipped)
    }

    @Test fun zipLimits() {
        val big = ByteArray(700) { 'a'.code.toByte() }
        val got = ModImport.unzip(zip("small.js" to "s".toByteArray(), "big.js" to big, "after.js" to "t".toByteArray()), 600)
        assertEquals(listOf("small.js", "after.js"), got.map { it.first })   // (each at most a sixth: 100 bytes)
        assertTrue(ModImport.unzip("not a zip".toByteArray(), 600).isEmpty())
        val f = ModImport.Found()
        ModImport.take(f, "bad.js", byteArrayOf(0xff.toByte(), 0xfe.toByte()))
        assertEquals(listOf("bad.js"), f.skipped)
    }

    @Test fun sendingOut() {
        val a = InstalledMod(id = "a.com/dark-mode", site = "a.com", name = "Dark mode", code = "// a")
        val b = InstalledMod(id = "en.a.com/wide", site = "en.a.com", name = "Wide", code = "// b")
        val c = InstalledMod(id = "b.com/x", site = "b.com", name = "X", code = "// c")
        assertEquals("a.com-dark-mode.js", ModImport.fileName(a, true))
        assertEquals("dark-mode.js", ModImport.fileName(a, false))
        assertEquals(listOf(a, b), ModImport.ofSite(listOf(a, b, c), "a.com"))
        val dir = Files.createTempDirectory("export").toFile()
        val files = ModImport.write(listOf(a, b), dir, "a.com mods")!!
        assertEquals(listOf("a.com mods/dark-mode.js", "a.com mods/wide.js"), files.map { it.relativeTo(dir).path })
        assertEquals("// b", files[1].readText())
        assertEquals("a.com-dark-mode.js", ModImport.write(listOf(a), dir)!!.single().name)
        assertNull(ModImport.write(listOf(a), java.io.File("/dev/null/x")))
    }

    @Test fun words() {
        assertEquals("Imported 1 mod: A. Like any mod from outside, it starts off, and waits for your OK if its code can do more than change the page.",
            ModImport.said(listOf("A"), emptyList(), emptyList()))
        assertEquals("Nothing TRIF can import there: a.txt.", ModImport.said(emptyList(), emptyList(), listOf("a.txt")))
        assertEquals("Nothing to import there.", ModImport.said(emptyList(), emptyList(), emptyList()))
        assertEquals("Couldn't import x.js: why", ModImport.said(emptyList(), listOf("Couldn't import x.js: why"), emptyList()))
    }
}
