package com.timsrobot.trif

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModOfferTest {
    private fun m(sites: List<String>, from: String?, site: String = sites.first(), needs: List<ModNeed> = emptyList()) =
        InstalledMod(id = "$site/x", site = site, name = "X", sites = sites, code = "", cameFrom = from, needs = needs)

    @Test fun elsewhereWarnsAsIphoneDoes() {
        assertNull(m(listOf("a.com"), "a.com").let(ModOffer::elsewhere))
        assertNull(m(listOf("b.com"), null).let(ModOffer::elsewhere)) // (from a file or a code: no warning)
        assertEquals(ModOffer.Away("It runs on another site", "It came from a.com, but it runs on b.com. Add it only if you meant it to change that site."),
            ModOffer.elsewhere(m(listOf("b.com"), "a.com")))
        assertEquals("It came from a.com, but it also runs on b.com, c.com. Add it only if you meant it to change those sites.",
            ModOffer.elsewhere(m(listOf("a.com", "c.com", "b.com"), "a.com"))!!.text)
        assertEquals("It runs on every site", ModOffer.elsewhere(m(listOf("all-sites"), "a.com", site = "all-sites"))!!.title)
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
