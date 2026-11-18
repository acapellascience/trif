package com.timsrobot.trif

import com.timsrobot.trif.Scripts.World
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScriptsTest {
    private val text = { name: String -> "<$name>" }
    private fun names(l: List<Scripts.Injection>) = l.map { "${it.world.id}:${it.name}" }

    @Test fun noModsIsTrifsOwnOnly() {
        assertEquals(listOf("trif:world-call", "trif:webkit-bridge", "trif:kit", "trif:start-own", "page:start-page"),
            names(Scripts.all(Scripts.Plan(), text)))
        assertEquals("<web/start-own.js>({\"a.com\":[\"x\"]});", Scripts.base(text, "{\"a.com\":[\"x\"]}")[3].source)
    }

    @Test fun iphonesOrder() {
        val plan = Scripts.Plan(
            mods = listOf(
                Scripts.Plan.One("s", "S", "trif", "start"),
                Scripts.Plan.One("b", "B", "box", "end"),
                Scripts.Plan.One("f", "F", "page", "end", style = "CSS"),
            ),
            free = "PAGE" to "RELAY",
            bridged = listOf(listOf("*://a.com/*") to emptyList()),
        )
        val l = Scripts.mods(plan, text)
        assertEquals(listOf("trif:style-mirror", "trif:free-relay", "page:free-page", "trif-box:world-call", "trif-box:style-mirror",
            "trif-box:ses", "trif-box:sandbox-runtime", "page:page-bridge", "trif:s", "trif-box:b", "trif:f style", "page:f"), names(l))
        assertEquals(listOf(true, true, true, true, true, true, true, true, true, false, true, false), l.map { it.start })
        assertTrue(l.first { it.name == "ses" }.source.startsWith("globalThis.__trifT0 = performance.now();\n<ses.umd.min.js>"))
        assertEquals("<gen/page-bridge.js>([[[\"*://a.com/*\"],[]]]);", l.first { it.name == "page-bridge" }.source)
    }

    @Test fun onlyWhatsNeeded() {
        // (a boxed mod alone: no mirror in TRIF's world, no free pair; a free mod with no reader texts: no pair)
        val l = names(Scripts.mods(Scripts.Plan(listOf(Scripts.Plan.One("b", "B", "box", "start"), Scripts.Plan.One("f", "F", "page", "start"))), text))
        assertEquals(listOf("trif-box:world-call", "trif-box:style-mirror", "trif-box:ses", "trif-box:sandbox-runtime", "trif-box:b", "page:f"), l)
    }

    @Test fun guards() {
        assertEquals("if (window === window.top) {\nX\n}", Scripts.topOnly("X"))
        assertTrue(Scripts.all(Scripts.Plan(), text).all { it.source.startsWith("if (window === window.top) {\n") })
        assertEquals("X", Scripts.behind(emptyList(), "X"))
        val b = Scripts.behind(listOf("a.com"), "X")
        assertTrue(b.contains("[\"a.com\"].some(") && b.endsWith("\nX\n})();"))
    }

    @Test fun testModsFromJson() {
        val p = Scripts.planOf("""[{"id":"x","script":"1","world":"box","at":"end","off":["a.com"]},{"id":"y","script":"2"}]""")
        assertEquals(Scripts.Plan.One("x", "1", "box", "end", "", listOf("a.com")), p.mods[0])
        assertEquals(Scripts.Plan.One("y", "2", "trif", "start"), p.mods[1])
        assertEquals(World.BOX, Scripts.world("box"))
    }
}
