package com.timsrobot.trif

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
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
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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
        val check = checkWebView()
        if (check != WebViewCheck.Result.Ok) return showWebViewProblem(check)
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
        debug(intent)
        browser.restore()
        open(intent)
    }

    /**
     * A debug build's test hooks (tests: base64 in the extras, so adb's quoting can't spoil them):
     * `trif.testMods` = a list of mods as JSON (Scripts.planOf), put in as the mod store's will be;
     * `trif.call` = "world:code" (trif, box or page), run on the shown tab's page, its answer logged ("call: …").
     */
    private fun debug(intent: Intent?) {
        if (intent == null || applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        val b64 = { k: String -> intent.getStringExtra(k)?.let { String(android.util.Base64.decode(it, android.util.Base64.DEFAULT)) } }
        b64("trif.testMods")?.let { browser.plan = Scripts.planOf(it) }
        b64("trif.call")?.let { c ->
            val world = c.substringBefore(':')
            browser.call(Scripts.world(world), c.substringAfter(':')) { a ->
                android.util.Log.i("TRIF", "call: $world ${if (a.ok) "ok ${a.value}" else "error ${a.error}"}")
            }
        }
        intent.removeExtra("trif.testMods"); intent.removeExtra("trif.call")
    }

    /**
     * The WebView check, before any WebView is made. A debug build can pretend (tests): the extra
     * `trif.pretendWebView` = a version ("145.0.1" → too old, "149…" → fine) or "none" (no WebView).
     */
    private fun checkWebView(): WebViewCheck.Result {
        val pretend = intent?.getStringExtra("trif.pretendWebView")
            ?.takeIf { applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 }
        if (pretend != null) {
            val major = WebViewCheck.major(pretend)
            return WebViewCheck.decide(if (pretend == "none") null else "com.google.android.webview", pretend,
                major != null && major >= WebViewCheck.MINIMUM)
        }
        val pkg = runCatching { WebViewCompat.getCurrentWebViewPackage(this) }.getOrNull()
        val worlds = pkg != null &&
            runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD) }
                .getOrDefault(false)
        val result = WebViewCheck.decide(pkg?.packageName, pkg?.versionName, worlds)
        if (result != WebViewCheck.Result.Ok) android.util.Log.i("TRIF", "webview: $result")
        return result
    }

    /** No usable WebView: what's wrong and a way to the Play Store, instead of the browser. */
    private fun showWebViewProblem(problem: WebViewCheck.Result) {
        val (title, body, pkg) = when (problem) {
            is WebViewCheck.Result.TooOld -> Triple(getString(R.string.webview_old_title),
                problem.major?.let { getString(R.string.webview_old_body, it, WebViewCheck.MINIMUM) }
                    ?: getString(R.string.webview_old_body_unknown, WebViewCheck.MINIMUM), problem.pkg)
            else -> Triple(getString(R.string.webview_missing_title), getString(R.string.webview_missing_body),
                "com.google.android.webview")
        }
        val pad = (24 * resources.displayMetrics.density).toInt()
        // (padding on an inner layout: fitsSystemWindows replaces a view's own padding with the system bars')
        val words = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(TextView(context).apply { text = title; textSize = 22f; setTextColor(Color.BLACK) })
            addView(TextView(context).apply {
                text = body; textSize = 16f; setTextColor(Color.DKGRAY); setPadding(0, pad / 2, 0, pad)
            })
            addView(Button(context).apply {
                text = getString(R.string.webview_update)
                setOnClickListener {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))
                    } catch (_: ActivityNotFoundException) {
                        Toast.makeText(context, R.string.app_link_no_app, Toast.LENGTH_LONG).show()
                    }
                }
            }, LinearLayout.LayoutParams(-2, -2))
        }
        setContentView(FrameLayout(this).apply {
            fitsSystemWindows = true
            setBackgroundColor(Color.WHITE)
            addView(words, -1, -1)
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (::browser.isInitialized) { debug(intent); open(intent) }
    }

    /**
     * A link opened with the app (TRIF as the default browser, or chosen for a link): in the shown tab if it's
     * empty, else in a new tab, the address exactly as given. Only http/https: the activity is exported, so any
     * other scheme (javascript:, file:, intent:…) sent to it is ignored.
     */
    private fun open(intent: Intent?) {
        val url = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data
            ?.takeIf { it.scheme == "http" || it.scheme == "https" }?.toString() ?: return
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

    override fun onResume() {
        super.onResume()
        if (::browser.isInitialized) browser.inFront = true
    }

    override fun onPause() {
        super.onPause()
        if (!::browser.isInitialized) return
        browser.inFront = false
        browser.save()
    }

    // Back: closes the tab list, else goes back in the page while it can, else the system's own back (predictive
    // back stays on: the callback is registered only while there's somewhere to go back to).
    private fun backInApp(): Boolean {
        if (listShown) { showList(false); return true }
        if (!::browser.isInitialized) return false
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
