package com.timsrobot.trif

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import org.junit.Test

class ModOfferTest {
    private fun m(sites: List<String>, from: String?, site: String = sites.first(), needs: List<ModNeed> = emptyList()) =
        InstalledMod(id = "$site/x", site = site, name = "X", sites = sites, code = "", cameFrom = from, needs = needs)

    private object CoreOnly : ModReader {
        override val version = "core"
        override fun read(text: String, file: String, site: String, here: String) = "{}"
        override fun check(text: String, file: String, site: String) = "{}"
        override fun core(name: String, args: String) = NodeCore.call(name, args)
    }
    private fun store(reader: ModReader?) =
        ModStore(ModFiles(Files.createTempDirectory("offer").toFile()) { it.run() }, reader) { 0L }

    /** The coral box's decision is the shared rule's, giving the iPhone's recorded answers (mod-offer-cases.json). */
    @Test fun elsewhereDecidedAsTheSharedCases() {
        val cases = JSONObject(generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "mobile/shared/core/mod-offer-cases.json") }.first { it.isFile }.readText()).getJSONArray("elsewhere")
        val s = store(CoreOnly)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONArray(i)
            val from = if (c.isNull(0)) null else c.getString(0)
            val sites = c.getJSONArray(2).let { a -> List(a.length()) { a.getString(it) } }
            val want: ModOffer.Place? = when (val w = c.get(3)) {
                is JSONObject -> if (w.optBoolean("every")) ModOffer.Place.Every
                    else ModOffer.Place.Others(w.getJSONArray("others").let { a -> List(a.length()) { a.getString(it) } }, w.getBoolean("also"))
                else -> null
            }
            assertEquals("case $i: $c", want, s.offerPlace(m(sites, from, site = c.getString(1))))
        }
        assertTrue(cases.length() > 10)
    }

    @Test fun noAnswerWarnsOfEverySite() {
        assertEquals(ModOffer.Place.Every, store(null).offerPlace(m(listOf("a.com"), "a.com")))
        assertNull(store(null).offerPlace(m(listOf("b.com"), null))) // (from a file or a code: no box)
    }

    @Test fun elsewhereWordsAsIphones() {
        assertNull(ModOffer.elsewhere(m(listOf("a.com"), "a.com"), null))
        assertNull(ModOffer.elsewhere(m(listOf("b.com"), null), ModOffer.Place.Every))
        assertEquals(ModOffer.Away("It runs on another site", "It came from a.com, but it runs on b.com. Add it only if you meant it to change that site."),
            ModOffer.elsewhere(m(listOf("b.com"), "a.com"), ModOffer.Place.Others(listOf("b.com"), false)))
        assertEquals("It came from a.com, but it also runs on b.com, c.com. Add it only if you meant it to change those sites.",
            ModOffer.elsewhere(m(listOf("a.com", "c.com", "b.com"), "a.com"), ModOffer.Place.Others(listOf("b.com", "c.com"), true))!!.text)
        assertEquals("It runs on every site", ModOffer.elsewhere(m(listOf("all-sites"), "a.com", site = "all-sites"), ModOffer.Place.Every)!!.title)
    }

    @Test fun findingsAsTheApprovalCard() {
        val x = m(listOf("a.com"), null, needs = listOf(
            ModNeed("power:net", "can reach the internet"), ModNeed("power:net2", "can reach the internet"),
            ModNeed("site:a.com:read", "per site"), ModNeed("power:together:read+net", "can read and send"),
            ModNeed("power:together:many:x", "Many powers at once."), ModNeed("match:b", "")))
        assertEquals(listOf("can reach the internet"), ModOffer.findings(x))
        assertEquals(listOf("can read and send" to false, "Many powers at once." to true), ModOffer.together(x))
    }
}
