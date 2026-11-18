package com.timsrobot.trif

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

/**
 * The browser's screen: the address bar, the shown tab's page, and a plain toolbar (back, forward, new tab, tabs).
 * The toolbar's look and the tab list's cards are the UI layer, held until the iPhone app's settles (Tim, 11-18):
 * this is only enough to use and test the tabs.
 */
class MainActivity : Activity() {
    private lateinit var browser: Browser
    private lateinit var field: EditText
    private lateinit var page: FrameLayout
    private lateinit var start: TextView
    private lateinit var list: ScrollView
    private lateinit var back: Button
    private lateinit var forward: Button
    private lateinit var tabsButton: Button
    private var listShown = false

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        field = EditText(this).apply {
            hint = getString(R.string.address_hint)
            setSingleLine()
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { v, action, _ ->
                if (action == EditorInfo.IME_ACTION_GO) { go(v.text.toString()); true } else false
            }
        }
        start = TextView(this).apply {
            text = getString(R.string.start_empty)
            setTextColor(Color.GRAY)
            textSize = 16f
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, resources.displayMetrics.heightPixels / 4, 0, 0)
            setBackgroundColor(Color.WHITE)
        }
        list = ScrollView(this).apply { setBackgroundColor(Color.rgb(242, 242, 247)); visibility = View.GONE }
        page = FrameLayout(this)
        back = toolButton("‹", getString(R.string.back)) { browser.current?.web?.goBack() }
        forward = toolButton("›", getString(R.string.forward)) { browser.current?.web?.goForward() }
        val plus = toolButton("+", getString(R.string.new_tab_button)) { showList(false); newTab() }
        tabsButton = toolButton("1", "") { showList(!listShown) }
        val bar = LinearLayout(this).apply {
            listOf(back, forward, plus, tabsButton).forEach { addView(it, LinearLayout.LayoutParams(0, -2, 1f)) }
        }
        val middle = FrameLayout(this).apply {
            addView(page, -1, -1); addView(start, -1, -1); addView(list, -1, -1)
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            addView(field, LinearLayout.LayoutParams(-1, -2))
            addView(middle, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(bar, LinearLayout.LayoutParams(-1, -2))
        })
        browser = Browser(this) { refresh() }
        browser.restore()
        open(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(intent)
    }

    /** A link opened with the app: in the shown tab if it's empty, else in a new tab. */
    private fun open(intent: Intent?) {
        val url = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString ?: return
        intent.data = null
        showList(false)
        if (browser.current?.url == null) browser.go(url) else browser.newTab(url)
    }

    private fun toolButton(glyph: String, label: String, tap: () -> Unit) =
        Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            text = glyph; textSize = 22f; contentDescription = label; setOnClickListener { tap() }
        }

    private fun newTab() {
        browser.newTab()
        field.requestFocus()
        getSystemService(InputMethodManager::class.java).showSoftInput(field, 0)
    }

    private fun go(text: String) {
        if (browser.current?.web == null) return
        if (!browser.go(text)) return
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(field.windowToken, 0)
        field.clearFocus()
        browser.current?.web?.requestFocus()
    }

    /** Shows what the browser holds now: the shown tab's page, its address, the buttons, the tab list. */
    private fun refresh() {
        val tab = browser.current ?: return
        val wv = tab.web
        if (wv != null && wv.parent !== page) {
            page.removeAllViews()
            (wv.parent as? ViewGroup)?.removeView(wv)
            page.addView(wv, -1, -1)
            // (the field would take the focus as the old page goes: the new tab's + asks for it again itself)
            field.clearFocus()
            wv.requestFocus()
        }
        start.visibility = if (tab.url == null && wv?.url == null) View.VISIBLE else View.GONE
        if (!field.hasFocus()) field.setText(tab.url ?: "")
        back.isEnabled = wv?.canGoBack() == true
        forward.isEnabled = wv?.canGoForward() == true
        val n = browser.tabs.size
        tabsButton.text = "$n"
        tabsButton.contentDescription = getString(R.string.tabs_button, n)
        if (listShown) fillList()
        backChanged()
    }

    private fun showList(show: Boolean) {
        listShown = show
        list.visibility = if (show) View.VISIBLE else View.GONE
        if (show) {
            browser.save()
            fillList()
        }
        backChanged()
    }

    /** The tab list: each tab's title and site, a tap to show it, × to close it. */
    private fun fillList() {
        val newTab = getString(R.string.new_tab)
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 16, 24, 16) }
        rows.addView(TextView(this).apply {
            text = resources.getQuantityString(R.plurals.tabs_title, browser.tabs.size, browser.tabs.size)
            textSize = 17f; setPadding(16, 8, 16, 16); gravity = Gravity.CENTER_HORIZONTAL
        })
        for (t in browser.tabs) {
            val row = LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                setBackgroundColor(if (t === browser.current) Color.rgb(220, 235, 220) else Color.WHITE)
                setPadding(32, 20, 8, 20)
                setOnClickListener { browser.select(t); showList(false) }
            }
            val words = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            words.addView(TextView(this).apply { text = t.label(newTab); textSize = 16f; setSingleLine() })
            if (t.host.isNotEmpty()) words.addView(TextView(this).apply {
                text = t.host; textSize = 13f; setTextColor(Color.GRAY); setSingleLine()
            })
            row.addView(words, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(Button(this, null, android.R.attr.borderlessButtonStyle).apply {
                text = "×"; textSize = 20f
                contentDescription = getString(R.string.close_tab, t.label(newTab))
                setOnClickListener { browser.close(t) }
            }, LinearLayout.LayoutParams(-2, -2))
            rows.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 12 })
        }
        list.removeAllViews()
        list.addView(rows)
    }

    override fun onPause() {
        super.onPause()
        browser.save()
    }

    // Back: closes the tab list, else goes back in the page while it can, else the system's own back (predictive
    // back stays on: the callback is registered only while there's somewhere to go back to).
    private fun backInApp(): Boolean {
        if (listShown) { showList(false); return true }
        val wv = browser.current?.web ?: return false
        if (!wv.canGoBack()) return false
        wv.goBack(); return true
    }

    private val backCallback: Any? = if (Build.VERSION.SDK_INT >= 33) OnBackInvokedCallback { backInApp() } else null
    private var backRegistered = false

    private fun backChanged() {
        if (Build.VERSION.SDK_INT < 33) return
        val want = listShown || browser.current?.web?.canGoBack() == true
        if (want == backRegistered) return
        val cb = backCallback as OnBackInvokedCallback
        if (want) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
        else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(cb)
        backRegistered = want
    }

    @Deprecated("Android 10-12 only; 13+ uses the OnBackInvokedCallback above")
    override fun onBackPressed() {
        if (!backInApp()) super.onBackPressed()
    }
}
