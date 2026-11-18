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
    private lateinit var mods: ModStore
    private lateinit var field: EditText
    private lateinit var page: FrameLayout
    private lateinit var start: TextView
    private lateinit var list: ScrollView
    private lateinit var back: Button
    private lateinit var forward: Button
    private lateinit var tabsButton: Button
    private var listShown = false
    /** The Mods tab (made on first use), over the page; its title bar. */
    private var panel: ModsPanel? = null
    private lateinit var modsSheet: LinearLayout
    private lateinit var modsTitle: TextView
    private lateinit var pauseButton: Button
    private val modsShown get() = ::modsSheet.isInitialized && modsSheet.visibility == View.VISIBLE

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
        val modsButton = toolButton(getString(R.string.mods), getString(R.string.mods)) { showMods(!modsShown) }.apply { textSize = 15f; isAllCaps = false }
        val bar = LinearLayout(this).apply {
            listOf(back, forward, modsButton, plus, tabsButton).forEach { addView(it, LinearLayout.LayoutParams(0, -2, 1f)) }
        }
        modsSheet = makeModsSheet()
        val middle = FrameLayout(this).apply {
            addView(page, -1, -1); addView(start, -1, -1); addView(list, -1, -1); addView(modsSheet, -1, -1)
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            addView(field, LinearLayout.LayoutParams(-1, -2))
            addView(middle, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(bar, LinearLayout.LayoutParams(-1, -2))
        })
        browser = Browser(this) { refresh() }
        browser.pageChanged = { panel?.pageChanged(); if (modsShown) titleMods() }
        // The installed mods, on a thread of their own (the store thread: reading a mod blocks on the reader); what
        // every page gets is made again after each change. What the reader made of each mod is kept, so the tabs
        // start at once; only mods without it (or a new reader) wait for the reader, a few seconds at most.
        mods = ModStore(ModFiles(java.io.File(filesDir, "modstore"))).apply {
            onChange = { val p = plan(); val paused = paused; runOnUiThread { showPlan(p, now = true, pausing = paused != wasPaused); wasPaused = paused; pausedChanged(paused) } }
        }
        wasPaused = mods.paused
        debug(intent)
        val t0 = System.nanoTime()
        work.execute {
            val asset = { n: String -> assets.open(n).bufferedReader().use { it.readText() } }
            val r = JsModReader.connect(this, asset("gen/mods.js"), runCatching { asset("gen/core.js") }.getOrNull())
            reader = r
            mods.reader = r
            mods.reread()
            val p = mods.plan()
            android.util.Log.i("TRIF", "mod reader: ${if (r == null) "didn't start" else "ready"}, ${mods.mods.size} mods, " +
                "${(System.nanoTime() - t0) / 1_000_000} ms")
            runOnUiThread { showPlan(p, now = true); started() }
        }
        // (after the reader is queued on the store thread, so whatever the first link brings (a mod file) finds it)
        if (!mods.needsReading) { showPlan(mods.plan(), now = true); started() }
        page.postDelayed(::started, 3000)
    }

    /** The store thread (every ModStore call goes through it) and the reader on it. */
    private val work = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "trif-mods") }
    private var reader: JsModReader? = null
    /** A debug build's test mods, in place of the store's (worlds.sh). */
    private var testPlan: Scripts.Plan? = null
    private var tabsShown = false

    /** Pause all mods as last put in (its change reloads the shown page even if it plays). */
    private var wasPaused = false

    /** The store's plan to every page (from any thread). `pausing`: Pause all mods or Resume did it. */
    private fun showPlan(p: Scripts.Plan, now: Boolean = false, pausing: Boolean = false) {
        val put = { if (testPlan == null && !isDestroyed) browser.put(p, evenPlaying = pausing) }
        if (now) put() else runOnUiThread(put)
    }

    /** The tabs as they were and the link the app was opened with, once the mods are read (or the wait is over). */
    private fun started() {
        if (tabsShown || isDestroyed) return
        tabsShown = true
        browser.restore()
        open(intent)
    }

    override fun onDestroy() {
        super.onDestroy()
        work.execute { reader?.close() }
        work.shutdown()
    }

    /**
     * A debug build's test hooks (tests: base64 in the extras, so adb's quoting can't spoil them):
     * `trif.testMods` = a list of mods as JSON (Scripts.planOf), put in as the mod store's will be;
     * `trif.addMod` = a mod file, read by the reader and added as pasted ("add mod: <id> <tier> <world> runs|held");
     * `trif.call` = "world:code" (trif, box or page), run on the shown tab's page, its answer logged ("call: …");
     * `trif.offer` = text with a mod, as shared to TRIF: Add this mod? ("offer: <id> <tier> from <site>");
     * `trif.allow` = a mod's id: Allow on its hold, as the Mods tab's button ("allow: <id> runs|held");
     * `trif.panel` = code run in the Mods tab's page (shown first), its answer logged ("panel: …").
     */
    private fun debug(intent: Intent?) {
        if (intent == null || applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        val b64 = { k: String -> intent.getStringExtra(k)?.let { String(android.util.Base64.decode(it, android.util.Base64.DEFAULT)) } }
        b64("trif.testMods")?.let { testPlan = Scripts.planOf(it); browser.put(testPlan!!) }
        b64("trif.addMod")?.let { text ->
            work.execute {
                val r = mods.read(text)
                val m = r.mod?.let { mods.add(it, "pasted") }
                android.util.Log.i("TRIF", "add mod: " + (m?.let { "${it.id} ${it.tier} ${it.world} ${if (it.held) "held" else "runs"}" } ?: "error ${r.error}"))
            }
        }
        b64("trif.offer")?.let { offerText(it) }
        b64("trif.allow")?.let { id ->
            work.execute {
                mods.approve(id)
                val m = mods.mods.firstOrNull { it.id == id }
                android.util.Log.i("TRIF", "allow: $id " + (m?.let { if (it.held) "held" else "runs" } ?: "no such mod"))
            }
        }
        b64("trif.pause")?.let { on ->
            work.execute { mods.setPaused(on == "on"); android.util.Log.i("TRIF", "pause: ${if (mods.paused) "on" else "off"}") }
        }
        b64("trif.call")?.let { c ->
            val world = c.substringBefore(':')
            browser.call(Scripts.world(world), c.substringAfter(':')) { a ->
                android.util.Log.i("TRIF", "call: $world ${if (a.ok) "ok ${a.value}" else "error ${a.error}"}")
            }
        }
        b64("trif.panel")?.let { code ->
            showMods(true)
            panel?.web?.evaluateJavascript("(() => { try { return JSON.stringify({ ok: true, value: (function () {\n$code\n})() }); } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); } })()") { raw ->
                android.util.Log.i("TRIF", "panel: " + (runCatching { org.json.JSONTokener(raw).nextValue() as String }.getOrNull() ?: raw))
            }
        }
        intent.removeExtra("trif.testMods"); intent.removeExtra("trif.call"); intent.removeExtra("trif.addMod"); intent.removeExtra("trif.allow")
        intent.removeExtra("trif.offer")
        intent.removeExtra("trif.panel")
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
        if (::browser.isInitialized) { debug(intent); if (tabsShown) open(intent) else setIntent(intent) }
    }

    /**
     * A link opened with the app (TRIF as the default browser, or chosen for a link): in the shown tab if it's
     * empty, else in a new tab, the address exactly as given. Only http/https: the activity is exported, so any
     * other scheme (javascript:, file:, intent:…) sent to it is ignored.
     */
    private fun open(intent: Intent?) {
        files(intent)?.let { uris -> intent?.data = null; intent?.removeExtra(Intent.EXTRA_STREAM); importFiles(uris); return }
        intent?.takeIf { it.action == Intent.ACTION_SEND }?.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
            intent.removeExtra(Intent.EXTRA_TEXT)
            // (a whole mod: Add this mod?; any other text: a page, as the address bar takes it)
            if (text.contains("==WebMod==")) offerText(text)
            else Address.resolve(text.trim())?.let { url -> showList(false); if (browser.current?.url == null) browser.go(url) else browser.newTab(url) }
            return
        }
        val url = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data
            ?.takeIf { it.scheme == "http" || it.scheme == "https" }?.toString() ?: return
        intent.data = null
        showList(false)
        if (browser.current?.url == null) browser.go(url) else browser.newTab(url)
    }

    /** The files an intent brings: a file opened with TRIF (VIEW content:), or shared to it (SEND, SEND_MULTIPLE). */
    private fun files(intent: Intent?): List<Uri>? {
        intent ?: return null
        val out = when (intent.action) {
            Intent.ACTION_VIEW -> listOfNotNull(intent.data?.takeIf { it.scheme == "content" })
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> emptyList()
        }
        return out.takeIf { it.isNotEmpty() }
    }

    /**
     * Files opened in the app or shared to it (iPhone's importFiles): each mod imported (it starts off, and waits for
     * an OK if its code can do more than change the page); what came in said, then the Mods tab on the mods. The
     * status strip is UI layer: a toast says it for now. Zips and history exports: not yet.
     */
    private fun importFiles(uris: List<Uri>) {
        val here = browser.current?.host ?: ""
        work.execute {
        val read = uris.map { u ->
            val name = runCatching {
                contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) c.getString(0) else null
                }
            }.getOrNull() ?: u.lastPathSegment?.substringAfterLast('/') ?: "mod.js"
            // (a mod is small: at most 2 MB read of each file)
            name to runCatching { contentResolver.openInputStream(u)?.use { String(it.readNBytes(2 shl 20)) } }.getOrNull()
        }
            val added = mutableListOf<String>(); val said = mutableListOf<String>(); val skipped = mutableListOf<String>()
            for ((name, text) in read) {
                if (text == null || !name.lowercase().endsWith(".js")) { skipped += name; continue }
                val r = mods.read(text, name, "", here)
                val m = r.mod
                if (m == null) { said += "Couldn't import $name: ${r.error ?: "no reason given"}"; continue }
                val kept = mods.add(m, "import")
                added += kept.name
                android.util.Log.i("TRIF", "import: $name as ${kept.id}${if (kept.held) ", waiting for an OK" else ""}")
            }
            val one = added.size == 1
            if (added.isNotEmpty()) said.add(0, "Imported ${if (one) "1 mod" else "${added.size} mods"}: ${added.joinToString(", ")}. " +
                "Like any mod from outside, ${if (one) "it starts" else "they start"} off, and ${if (one) "waits" else "each waits"} " +
                "for your OK if ${if (one) "its" else "its own"} code can do more than change the page.")
            if (said.isEmpty()) said += if (skipped.isEmpty()) "Nothing to import there." else "Nothing TRIF can import there: ${skipped.take(5).joinToString(", ")}."
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                Toast.makeText(this, said.joinToString(" "), Toast.LENGTH_LONG).show()
                android.util.Log.i("TRIF", "import said: ${said.joinToString(" ")}")
                if (added.isNotEmpty()) showMods(true)
            }
        }
    }

    /**
     * Text shared to TRIF with a whole mod in it (iPhone's offer(text:), its Paste): read as the mod it names (one
     * with its name here keeps its id), then Add this mod? It came from the shown tab's site.
     */
    private fun offerText(text: String) {
        val here = browser.current?.host ?: ""
        work.execute {
            val r = mods.readNamed(text.trim(), here)
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                val m = r.mod?.copy(cameFrom = Site.of(here))
                if (m == null) { say("That mod can't be added: ${r.error ?: "no reason given"}."); return@runOnUiThread }
                android.util.Log.i("TRIF", "offer: ${m.id} ${m.tier} from ${m.cameFrom}${ModOffer.elsewhere(m)?.let { ", ${it.title}" } ?: ""}")
                ModOffer.show(this, m, add = { addOffered(m) }, closed = { android.util.Log.i("TRIF", "offer: ${m.id} declined") })
            }
        }
    }

    /** Add it (iPhone's addMod): a held one says it waits and the Mods tab opens on it; else what it runs on. */
    private fun addOffered(m: InstalledMod) {
        work.execute {
            val added = mods.add(m, "pasted")
            android.util.Log.i("TRIF", "add mod: ${added.id} ${added.tier} ${added.world} ${if (added.held) "held" else "runs"}")
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                if (added.held) { say("${added.name} waits for your OK."); showMods(true) }
                else say("Added ${added.name}. It runs on ${added.sites.joinToString(", ")}.")
            }
        }
    }

    /** iPhone's status strip (UI layer): a toast for now. */
    private fun say(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show()
        android.util.Log.i("TRIF", "said: $text")
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

    /** The Mods tab's sheet: its title (Mods on {site}), ⋯ (Pause all mods / Resume mods) and Done over the page. */
    private fun makeModsSheet(): LinearLayout {
        modsTitle = TextView(this).apply { textSize = 17f; setTextColor(Color.BLACK); gravity = Gravity.CENTER; setSingleLine() }
        pauseButton = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            text = "⋯"; textSize = 20f; contentDescription = getString(R.string.more)
            setOnClickListener { v ->
                android.widget.PopupMenu(this@MainActivity, v).apply {
                    val paused = mods.paused
                    menu.add(getString(if (paused) R.string.resume_mods else R.string.pause_all_mods)).setOnMenuItemClickListener {
                        work.execute { mods.setPaused(!paused) }; true
                    }
                }.show()
            }
        }
        val done = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            text = getString(R.string.done); isAllCaps = false; setOnClickListener { showMods(false) }
        }
        val top = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(pauseButton, LinearLayout.LayoutParams(-2, -2))
            addView(modsTitle, LinearLayout.LayoutParams(0, -2, 1f))
            addView(done, LinearLayout.LayoutParams(-2, -2))
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            visibility = View.GONE
            isClickable = true
            addView(top, LinearLayout.LayoutParams(-1, -2))
        }
    }

    private fun titleMods() {
        val site = Site.of(browser.current?.host ?: "")
        modsTitle.text = if (site.isEmpty()) getString(R.string.mods) else getString(R.string.mods_on, site)
    }

    private fun showMods(show: Boolean) {
        if (show) {
            if (listShown) showList(false)
            val p = panel ?: ModsPanel(this, browser, mods, work) { reader }.also { p ->
                panel = p
                modsSheet.addView(p.web, LinearLayout.LayoutParams(-1, 0, 1f))
            }
            titleMods()
            p.shown = true
            modsSheet.visibility = View.VISIBLE
            p.refresh()
        } else {
            panel?.shown = false
            modsSheet.visibility = View.GONE
        }
        backChanged()
    }

    /** All mods paused or running again: the shown Mods tab follows. */
    private fun pausedChanged(@Suppress("UNUSED_PARAMETER") paused: Boolean) { if (modsShown) panel?.refresh() }

    private fun showList(show: Boolean) {
        if (show && modsShown) showMods(false)
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
        if (modsShown) { showMods(false); return true }
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
        val want = modsShown || listShown || browser.current?.web?.canGoBack() == true
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
