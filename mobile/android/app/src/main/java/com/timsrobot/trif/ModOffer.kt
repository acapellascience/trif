package com.timsrobot.trif

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * "Add this mod?" (iPhone's ModOfferView): a whole mod pasted or shared to TRIF, said before it's added: its name, tier
 * and description, a warning when it runs on another site than the one it came from, Runs on, its powers, what TRIF
 * found (the Mods tab's approval card's words), the free-mod warning, Add it · Cancel, then its code. Plain native
 * views for now (its look is UI layer); the words are iPhone's.
 */
object ModOffer {
    data class Away(val title: String, val text: String)

    /** The approval card's own lines: each need's fact but the "together" warnings and per-site keys. */
    fun findings(m: InstalledMod): List<String> = m.needs
        .filter { it.fact.isNotEmpty() && !it.key.startsWith("power:together:") && !Regex("^site:.+:[a-z+-]+$").matches(it.key) }
        .map { it.fact }.distinct()

    /** The "Together, it …" warnings (a "many" one is said as it is): fact to many. */
    fun together(m: InstalledMod): List<Pair<String, Boolean>> = m.needs
        .filter { it.key.startsWith("power:together:") && it.fact.isNotEmpty() }.distinctBy { it.fact }
        .map { it.fact to it.key.startsWith("power:together:many:") }

    /** Where it runs, beside the site it came from: the shared rule's decision (ModStore.offerPlace). */
    sealed interface Place {
        data object Every : Place
        data class Others(val sites: List<String>, val also: Boolean) : Place
    }

    /** It runs on a site other than the one it came from (or on every site): the warning's words (iPhone's). */
    fun elsewhere(m: InstalledMod, place: Place?): Away? {
        val from = m.cameFrom?.takeIf { it.isNotEmpty() } ?: return null
        return when (place) {
            null -> null
            Place.Every -> Away("It runs on every site", "It came from $from, but it runs on every site you visit, not just $from. Add it only if you meant it to.")
            is Place.Others -> {
                val one = place.sites.size == 1
                Away(if (one) "It runs on another site" else "It runs on other sites",
                    "It came from $from, but it ${if (place.also) "also " else ""}runs on ${place.sites.joinToString(", ")}. " +
                        "Add it only if you meant it to change ${if (one) "that site" else "those sites"}.")
            }
        }
    }

    fun tierName(m: InstalledMod) = when (m.tier) { "style" -> "Style mod"; "boxed" -> "Boxed mod"; else -> "Free mod" }

    /** The panel's colours (sidepanel.css --led-green, --led-yellow, --led-coral; light). */
    private const val CORAL = 0xFFC2512D.toInt()
    private fun colour(m: InstalledMod) = when (m.tier) { "style" -> 0xFF1F8A5B.toInt(); "boxed" -> 0xFF9A7300.toInt(); else -> CORAL }

    /** Shows the sheet. `add` on Add it, `closed` on Cancel or back (declined). */
    fun show(a: Activity, m: InstalledMod, away: Away?, add: () -> Unit, closed: () -> Unit): Dialog {
        val d = Dialog(a, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
        val dp = a.resources.displayMetrics.density
        val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding((20 * dp).toInt(), (12 * dp).toInt(), (20 * dp).toInt(), (24 * dp).toInt()) }
        fun text(t: String, size: Float = 15f, bold: Boolean = false, color: Int = Color.BLACK, mono: Boolean = false, top: Int = 0) =
            TextView(a).apply {
                text = t; textSize = size; setTextColor(color); setTextIsSelectable(mono)
                typeface = if (mono) Typeface.MONOSPACE else if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                if (bold && mono) setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            }.also { v -> col.addView(v, LinearLayout.LayoutParams(-1, -2).apply { topMargin = (top * dp).toInt() }) }
        fun header(t: String) = text(t, 13f, bold = true, color = Color.DKGRAY, top = 18)

        text(a.getString(R.string.add_this_mod), 17f, bold = true).gravity = Gravity.CENTER
        text(m.name, 17f, bold = true, top = 14)
        text(tierName(m), 12f, bold = true, color = colour(m))
        if (m.description.isNotEmpty()) text(m.description, 14f, color = Color.DKGRAY)
        // (Tim, 11-17: a mod that runs on another site than the one it came from stands out, first thing)
        away?.let { w ->
            text("⚠ ${w.title}", 14f, bold = true, color = CORAL, top = 16)
            text(w.text, 13f, color = CORAL)
        }
        header("Runs on"); text(m.sites.joinToString(", "), 13f, mono = true)
        if (m.powers.isNotEmpty()) { header("Asks for these powers"); text(m.powers.joinToString(", "), 13f, mono = true) }
        val asks = m.tier == "boxed"
        val found = findings(m); val tog = together(m)
        if (found.isNotEmpty() || tog.isNotEmpty()) {
            header(if (asks) "It asks for these powers. TRIF holds it to them:" else "TRIF found that this mod:")
            found.forEach { f -> text(if (asks) "It $f." else f, 13f, top = 4) }
            tog.forEach { (f, many) -> text(if (many) f else "Together, it $f.", 13f, color = CORAL, top = 4) }
        }
        if (m.tier == "free") text("A free mod can do anything the page can do, including posting or sending as you. Only enable free mods that you trust.", 13f, color = CORAL, top = 16)
        // (the buttons before the code: Tim, 11-16, "sometimes you don't wanna read the code")
        var decided = false
        fun button(t: String, bold: Boolean, tap: () -> Unit) = Button(a, null, android.R.attr.borderlessButtonStyle).apply {
            text = t; isAllCaps = false; gravity = Gravity.START or Gravity.CENTER_VERTICAL
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setOnClickListener { decided = true; d.dismiss(); tap() }
        }.also { col.addView(it, LinearLayout.LayoutParams(-1, -2)) }
        col.addView(android.view.View(a), LinearLayout.LayoutParams(-1, (12 * dp).toInt()))
        button(a.getString(R.string.add_it), true, add)
        button(a.getString(R.string.cancel), false, closed)
        header("Its code")
        val code = TextView(a).apply { text = m.code; textSize = 11f; typeface = Typeface.MONOSPACE; setTextColor(Color.BLACK); setTextIsSelectable(true) }
        col.addView(HorizontalScrollView(a).apply { addView(code) }, LinearLayout.LayoutParams(-1, -2))

        d.setContentView(ScrollView(a).apply { setBackgroundColor(Color.WHITE); addView(col) },
            ViewGroup.LayoutParams(-1, -1))
        d.setOnDismissListener { if (!decided) closed() }
        d.show()
        return d
    }
}
