package com.timsrobot.trif

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.util.Log
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** One tab: its own WebView (made the first time it's shown) with its own back and forward. */
class Tab(val id: String = UUID.randomUUID().toString(), var title: String = "", var savedUrl: String? = null,
          var savedState: JSONObject? = null) {
    var web: WebView? = null
    /** Its WebView's script worlds (Scripts' list in them, messages, calls). */
    var worlds: Worlds? = null
    /** The tab whose page opened this one as a window (window.open, target=_blank): not kept between launches. */
    var opener: Tab? = null
    /** It's a window a tap opened (its first load counts as tapped if the finger was on the page just now). */
    var openedByTap = false
    /** The question about another app's link was put for this load (one a load); the last line logged. */
    var askedThisLoad = false
    var droppedLine: String? = null
    /** Its page's load under the mods' plan: the address, the plan's signature there and the mods it ran
     *  (Scripts.Plan.signature), whether it's loading, when it finished (the Mods tab's starting / next load). */
    var loadedUrl: String? = null
    var loadedSig: String? = null
    var loadedIds: Set<String>? = null
    var loading = false
    var finishedAt: Long? = null
    val started get() = web != null
    val url: String? get() = SavedTabs.keepable(web?.url) ?: savedUrl.takeIf { !started }
    val host: String get() = url?.let { Uri.parse(it).host } ?: ""
    /** Its name in the tab list: its title, else its site, else New tab (as iPhone's Tab.label). */
    fun label(newTab: String) = title.ifEmpty { host.ifEmpty { newTab } }
}

/**
 * The tabs (as iPhone's Browser: several pages at once, each in a WebView of its own, all sharing one profile, so
 * the same cookies and sign-ins), kept between launches. [changed] tells the screen to redraw what it shows.
 * Every WebView is made in [makeWebView], with its script worlds (Worlds) and the pages' scripts (Scripts).
 */
class Browser(private val context: Context, private val changed: () -> Unit) {
    /** A page started or finished loading (the Mods tab follows the shown one). */
    var pageChanged: (() -> Unit)? = null
    val tabs = mutableListOf<Tab>()
    var current: Tab? = null
        private set
    private val file = File(context.noBackupFilesDir, "tabs.json")
    /** The screen is in front (set by MainActivity): only then may a page's own try at another app ask. */
    var inFront = false
    private var asking: AlertDialog? = null

    /** What the screen does for the pages (MainActivity): Android's permission ask, its file picker, full screen, a
     *  downloaded mod's Add this mod?. */
    interface Host {
        fun askAndroid(permissions: List<String>, done: () -> Unit)
        /** Android won't show its ask for this any more (the person turned it down for good). */
        fun refusedForGood(permission: String): Boolean
        /** The system's file picker for a page's file input; false if none could be shown. */
        fun pickFiles(intent: Intent, multiple: Boolean, done: (Array<Uri>?) -> Unit): Boolean
        /** A page's full-screen view (a video) over everything, or null to leave it. */
        fun fullScreen(view: android.view.View?, leave: (() -> Unit)?)
        fun offerText(text: String)
    }
    var host: Host? = null

    /** The tabs kept from last time, else one new tab. */
    fun restore() {
        val saved = SavedTabs.load(file)
        if (saved != null && saved.tabs.isNotEmpty()) {
            saved.tabs.forEach { tabs += Tab(it.id, it.title, it.url, it.state) }
            select(tabs.firstOrNull { it.id == saved.selected } ?: tabs.last())
        } else newTab()
    }

    fun select(tab: Tab) {
        current = tab
        if (!tab.started) start(tab) else reloadIfStale(tab)
        save()
        changed()
    }

    /** A tab's page the first time it's shown: its back/forward list, else its address. */
    private fun start(tab: Tab) {
        val wv = makeWebView(tab)
        tab.web = wv
        val restored = tab.savedState?.let { runCatching { wv.restoreState(BundleJson.read(it)) }.getOrNull() }
        if (restored == null || restored.size == 0) tab.savedUrl?.let { wv.loadUrl(it) }
        tab.savedState = null
        tab.savedUrl = null
    }

    /** A new tab after the shown one: empty, or at an address. */
    fun newTab(address: String? = null): Tab {
        val t = Tab()
        tabs.add(TabOrder.insertAt(tabs.indexOf(current), tabs.size), t)
        select(t)
        address?.let { go(it) }
        return t
    }

    /** Closes a tab. [toOpener]: a page closing its own window goes back to the page that opened it, if still open. */
    fun close(tab: Tab, toOpener: Boolean = false) {
        val i = tabs.indexOf(tab)
        if (i < 0) return
        val next = TabOrder.afterClose(i, tabs.size, if (toOpener) tabs.indexOf(tab.opener) else -1)
        tabs.removeAt(i)
        tab.web?.apply { stopLoading(); destroy() }
        tab.web = null; tab.worlds = null
        tabs.forEach { if (it.opener === tab) it.opener = null }
        when {
            next < 0 -> newTab()
            tab === current -> select(tabs[next])
            else -> { save(); changed() }
        }
    }

    /**
     * A window the page opens (window.open, a target=_blank link): a new tab right after the opener's, shown, as on
     * iPhone. It's a real window with an opener (WebViewTransport), so a sign-in window can hand its result back to
     * the page that opened it and close itself (accounts.google.com/gsi/transform needs that: the probe, 11-18).
     * Only from a tap, as WebKit: a page can't open windows by itself.
     */
    private fun openWindow(from: WebView, userGesture: Boolean, resultMsg: Message): Boolean {
        if (!userGesture) return false
        val opener = tabs.firstOrNull { it.web === from }
        val t = Tab()
        t.opener = opener
        t.openedByTap = true
        t.web = makeWebView(t)
        tabs.add(TabOrder.insertAt(tabs.indexOf(opener ?: current), tabs.size), t)
        (resultMsg.obj as WebView.WebViewTransport).webView = t.web
        resultMsg.sendToTarget()
        select(t)
        return true
    }

    // links for other apps (tel:, mailto:, sms:, geo:, market:, intent:…), as iPhone's (Tim, 11-18)

    /** A page's navigation: true when TRIF takes it (another app's link, or one never followed), false to load it. */
    private fun takeLink(tab: Tab, view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        return when (AppLinks.kind(url)) {
            AppLinks.Kind.WEB, AppLinks.Kind.STAY -> false
            AppLinks.Kind.NEVER, AppLinks.Kind.OWN -> {
                if (request.isForMainFrame) log("link", "not followed: ${AppLinks.logged(url)}")
                true
            }
            AppLinks.Kind.OTHER -> {
                // (a window opened for another app's link, target=_blank or window.open: the link goes to Android and
                // the empty window's tab closes, back to its opener. Only here is its address known)
                val window = tab.opener != null && view.copyBackForwardList().size == 0
                val tapped = TouchClock.tapped(request.hasGesture() || (window && tab.openedByTap))
                appLink(url, tab, tapped, request.isForMainFrame, if (window) "a page's new window" else "a page")
                if (window) view.post { close(tab, toOpener = true) }
                true
            }
        }
    }

    /**
     * Another app's link: to Android at once when the person tapped it; a page doing it by itself (a script, a
     * redirect, a refresh) gets the question, if it's the page on the screen, one question at a time and one a
     * load; a frame inside the page, a tab behind: nothing unless tapped.
     */
    private fun appLink(url: String, tab: Tab, tapped: Boolean, mainFrame: Boolean, source: String) {
        val onScreen = tab === current || tab.opener === current
        when (val d = AppLinks.decide(tapped, mainFrame, tab.askedThisLoad, asking != null, onScreen && inFront)) {
            AppLinks.Decision.Open -> handOut(url, tab, source, "tapped")
            is AppLinks.Decision.Drop -> {
                val line = "${AppLinks.logged(url)} from $source, not opened: ${d.why}"
                // (a page trying again and again: its line once a load)
                if (tab.droppedLine != line) { tab.droppedLine = line; log("app link", line) }
            }
            AppLinks.Decision.Ask -> {
                tab.askedThisLoad = true
                askToOpen(url, tab, source)
            }
        }
    }

    private fun askToOpen(url: String, tab: Tab, source: String) {
        asking = AlertDialog.Builder(context)
            .setTitle(R.string.app_link_question)
            .setNegativeButton(R.string.cancel) { _, _ -> log("app link", "${AppLinks.logged(url)} from $source: asked, Cancel") }
            .setPositiveButton(R.string.open) { _, _ -> handOut(url, tab, source, "asked, Open") }
            .setOnDismissListener { asking = null }
            .show()
        log("app link", "${AppLinks.logged(url)} from $source: asked")
    }

    /**
     * Hands the link to Android, as Chrome does: an intent: link is read with Intent.parseUri and, like any link
     * from a page, may reach only activities that take BROWSABLE links (no named component, no granted URIs).
     * An intent for a plain web page with no app named stays in TRIF; no app for it: its fallback page, if any.
     */
    private fun handOut(url: String, tab: Tab, source: String, how: String) {
        val scheme = AppLinks.scheme(url)
        val intent = runCatching {
            when (scheme) {
                "intent" -> Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                "android-app" -> Intent.parseUri(url, Intent.URI_ANDROID_APP_SCHEME)
                else -> Intent(Intent.ACTION_VIEW, Uri.parse(url))
            }
        }.getOrNull()
        if (intent == null) { log("app link", "${AppLinks.logged(url)} from $source, not opened: unreadable"); return }
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector?.apply { addCategory(Intent.CATEGORY_BROWSABLE); component = null }
        intent.flags = intent.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION).inv()
        val data = intent.dataString
        if (intent.`package` == null && data != null && AppLinks.kind(data) == AppLinks.Kind.WEB) {
            log("app link", "${AppLinks.logged(url)} from $source, $how: a web page, opened here")
            (tab.opener?.takeIf { tab.web?.copyBackForwardList()?.size == 0 } ?: tab).web?.loadUrl(data)
            return
        }
        try {
            context.startActivity(intent)
            log("app link", "${AppLinks.logged(url)} from $source, $how: handed to Android")
        } catch (e: ActivityNotFoundException) {
            val fallback = AppLinks.fallback(url)
            log("app link", "${AppLinks.logged(url)} from $source, $how: no app for it${if (fallback != null) ", its fallback page" else ""}")
            if (fallback != null) (tab.opener?.takeIf { tab.web?.copyBackForwardList()?.size == 0 } ?: tab).web?.loadUrl(fallback)
            else Toast.makeText(context, R.string.app_link_no_app, Toast.LENGTH_LONG).show()
        } catch (e: SecurityException) {
            log("app link", "${AppLinks.logged(url)} from $source, $how: refused by Android")
        }
    }

    private fun log(what: String, line: String) = Log.i("TRIF", "$what: $line")

    // MARK: what WKWebView does by itself and a WebView doesn't (round 15): camera / mic / location asks, file
    // inputs, full screen, downloads

    private val kept = PageAsks.Kept()
    /** The page ask whose question is up (a page can take it back: onPermissionRequestCanceled). */
    private var askingFor: Any? = null

    private fun has(p: String) = context.checkSelfPermission(p) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** A page's ask for `kinds` (from `origin`): answered through `answer(allowed kinds)`. */
    private fun pageAsk(tab: Tab, origin: String, kinds: Set<PageAsks.Kind>, token: Any, answer: (Set<PageAsks.Kind>) -> Unit) {
        val what = kinds.joinToString("+") { it.name.lowercase() }
        val site = PageAsks.site(origin)
        val onScreen = tab === current && inFront
        when (val d = PageAsks.decide(kinds, onScreen, asking != null, kept.of(origin))) {
            PageAsks.Decision.Refuse -> { log("page ask", "$site $what: refused, ${if (!onScreen) "not on screen" else "a question is already up"}"); answer(emptySet()) }
            is PageAsks.Decision.Known -> {
                log("page ask", "$site $what: answered earlier, ${if (d.allowed.isEmpty()) "Don't Allow" else "Allow"}")
                fromAndroid(site, d.allowed, answer)
            }
            PageAsks.Decision.Ask -> {
                askingFor = token
                asking = AlertDialog.Builder(context)
                    .setTitle(context.getString(PageAsks.question(kinds), site))
                    .setNegativeButton(R.string.dont_allow) { _, _ ->
                        kept.put(origin, kinds, false); log("page ask", "$site $what: Don't Allow"); answer(emptySet())
                    }
                    .setPositiveButton(R.string.allow) { _, _ ->
                        kept.put(origin, kinds, true); log("page ask", "$site $what: Allow")
                        fromAndroid(site, kinds, answer)
                    }
                    .setOnCancelListener { log("page ask", "$site $what: dismissed"); answer(emptySet()) }
                    .setOnDismissListener { asking = null; askingFor = null }
                    .show()
                log("page ask", "$site $what: asked")
            }
        }
    }

    /** What TRIF itself may have from Android of `kinds` (asking Android first for what it hasn't), to `answer`. */
    private fun fromAndroid(site: String, kinds: Set<PageAsks.Kind>, answer: (Set<PageAsks.Kind>) -> Unit) {
        val missing = PageAsks.missing(kinds, ::has)
        val h = host
        val finish = {
            val got = PageAsks.allowed(kinds, ::has)
            val lost = kinds - got
            log("page ask", "$site: ${if (got.isEmpty()) "nothing" else got.joinToString("+") { it.name.lowercase() }} granted" +
                if (lost.isEmpty()) "" else ", Android refused ${lost.joinToString("+") { it.name.lowercase() }}")
            if (lost.isNotEmpty() && lost.all { k -> k.permissions.all { h?.refusedForGood(it) == true } })
                Toast.makeText(context, PageAsks.refusedNote(lost), Toast.LENGTH_LONG).show()
            answer(got)
        }
        if (missing.isEmpty() || h == null) finish() else { log("page ask", "$site: asking Android for ${missing.joinToString(" ") { it.substringAfterLast('.') }}"); h.askAndroid(missing) { finish() } }
    }

    private fun cancelAsk(token: Any) {
        if (askingFor !== token) return
        log("page ask", "taken back by the page")
        asking?.dismiss()
    }

    /** A page's download: a .js mod to Add this mod?, the rest let go (iPhone's ModDownloads). */
    private fun download(tab: Tab, url: String, agent: String?, disposition: String?, mime: String?, length: Long) {
        val name = PageDownloads.name(url, disposition).ifEmpty { url.substringBefore(':') + " file" }
        if (!PageDownloads.wanted(url, disposition, mime, length)) { log("download", "$name: let go"); return }
        val got = { text: String?, why: String? ->
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                if (text == null) log("download", "couldn't download $name: $why")
                else { log("download", "downloaded $name (${text.length} characters): to Add this mod?"); host?.offerText(text) }
            }
        }
        when {
            url.startsWith("data:") -> PageDownloads.dataText(url).let { got(it, if (it == null) "unreadable" else null) }
            // (a page's own made file lives only in the page: read in TRIF's world, which shares its origin)
            url.startsWith("blob:") -> tab.worlds?.call(Scripts.World.TRIF,
                "const r = await fetch(${JSONObject.quote(url)}); const b = await r.blob(); if (b.size > ${PageDownloads.MAX}) throw new Error('over 2 MB'); return await b.text();"
            ) { a -> if (a.ok) got(a.value as? String, null) else got(null, a.error ?: "no answer") } ?: got(null, "no page")
            else -> Thread {
                runCatching {
                    val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                    c.connectTimeout = 15000; c.readTimeout = 15000
                    agent?.let { c.setRequestProperty("User-Agent", it) }
                    CookieManager.getInstance().getCookie(url)?.let { c.setRequestProperty("Cookie", it) }
                    try {
                        if (c.responseCode !in 200..299) throw java.io.IOException("the server answered ${c.responseCode}")
                        val bytes = c.inputStream.use { s -> s.readNBytes(PageDownloads.MAX.toInt() + 1) }
                        if (bytes.size > PageDownloads.MAX) throw java.io.IOException("over 2 MB")
                        String(bytes, Charsets.UTF_8)
                    } finally { c.disconnect() }
                }.fold({ got(it, null) }, { got(null, it.message ?: it.javaClass.simpleName) })
            }.start()
        }
    }

    // MARK: the pages' scripts (iPhone: Browser.installScripts / ModStore.userScripts)

    private val texts = mutableMapOf<String, String>()
    /** An asset's text (web/, gen/, shared/, js/, SES), read once. */
    fun text(name: String) = texts.getOrPut(name) { context.assets.open(name).bufferedReader().use { it.readText() } }
    /** What the mods put in (the mod store's, once there is one; a debug build's test mods until then). */
    var plan = Scripts.Plan()
        private set

    /** The plan put in every page; the shown tab loads again if what runs there changed ([reloadIfStale]).
     *  `evenPlaying`: even if it plays (Pause all mods, or Resume: the person's own act on it). */
    fun put(p: Scripts.Plan, evenPlaying: Boolean = false) {
        plan = p
        scripts = null
        tabs.forEach { t -> t.worlds?.install(scripts()) }
        current?.let { reloadIfStale(it, evenPlaying) }
    }

    /**
     * `tab` (shown) loaded again if the mods that run on its page under the plan now aren't the ones it loaded with,
     * unless it's playing sound: then it keeps going as it is, and loads again the next time it's shown not playing
     * (iPhone's refreshIfStale; docs/MOBILE-BEHAVIOUR.md "Which tabs load again").
     */
    private fun reloadIfStale(tab: Tab, evenPlaying: Boolean = false) {
        val url = tab.loadedUrl ?: return
        val wv = tab.web ?: return
        if (wv.url == null || plan.signature(url) == tab.loadedSig) return
        if (!evenPlaying && tab.worlds?.playing == true) {
            log("mods", "${Uri.parse(url).host}: its mods changed but it's playing, so not loaded again now")
            return
        }
        log("mods", "${Uri.parse(url).host}: its mods changed, loading it again")
        wv.reload()
    }
    private var scripts: List<Scripts.Injection>? = null
    private fun scripts() = scripts ?: Scripts.all(plan, ::text).also { scripts = it }

    /** A message from TRIF's world (iPhone's userContentController(didReceive:)): what it answers. */
    private fun message(body: JSONObject): Any? = when (body.optString("type")) {
        "ping" -> JSONObject().put("ok", true).put("received", body.optString("pad").length)
        "load" -> { log("load", body.optString("rec").take(800)); JSONObject().put("ok", true) }
        "modlog" -> {
            val cut = { k: String, n: Int -> body.optString(k).take(n) }
            val kind = cut("kind", 8); val mod = cut("mod", 100); val text = cut("text", 240)
            log("mod log", if (kind == "start") "$mod started" else "$mod: ${if (kind == "log") "" else "$kind: "}$text")
            JSONObject().put("ok", true)
        }
        else -> throw IllegalArgumentException("unknown message")
    }

    /** Code run in a world of the shown tab's page, its answer to `done` (Worlds.call). */
    fun call(world: Scripts.World, code: String, done: (Worlds.Answer) -> Unit) {
        val w = current?.worlds ?: return done(Worlds.Answer(false, null, "no page"))
        w.call(world, code, done = done)
    }

    /** Opens what was typed in the address bar in the shown tab. False if it isn't an address or a search. */
    fun go(text: String): Boolean {
        val url = Address.resolve(text) ?: return false
        current?.web?.loadUrl(url) ?: return false
        return true
    }

    fun save() {
        val list = tabs.map { t ->
            val state = t.web?.let { wv ->
                Bundle().let { b -> if (wv.saveState(b) != null) BundleJson.write(b) else null }
            } ?: t.savedState
            SavedTabs.One(t.id, t.url, t.title, state)
        }
        runCatching { SavedTabs(list, current?.id).save(file) }
    }

    private fun makeWebView(tab: Tab): WebView = WebView(context).apply {
        // (the worlds and their scripts before anything loads)
        tab.worlds = Worlds(this, text("js/playing-watch.js"), ::message).also { it.install(scripts()) }
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // (real windows: onCreateWindow below; only from a tap, as in the probe's passing sign-ins)
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = false
        // (sign-in through another site, "Continue with Google", passed in the probe with these on)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        TouchClock.watch(this)
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = takeLink(tab, view, request)
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                tab.askedThisLoad = false; tab.droppedLine = null; tab.worlds?.newPage()
                tab.loadedUrl = url; tab.loading = true; tab.finishedAt = null
                tab.loadedSig = url?.let(plan::signature); tab.loadedIds = url?.let { u -> plan.runningOn(u).map { it.id }.toSet() }
                if (tab === current) pageChanged?.invoke()
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, reload: Boolean) { changed() }
            override fun onPageFinished(view: WebView, url: String) {
                tab.title = view.title?.takeIf { SavedTabs.keepable(url) != null && it != url } ?: ""
                tab.loading = false; tab.finishedAt = System.currentTimeMillis()
                save()
                changed()
                if (tab === current) pageChanged?.invoke()
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message) =
                openWindow(view, isUserGesture, resultMsg)
            override fun onCloseWindow(window: WebView) {
                tabs.firstOrNull { it.web === window }?.let { close(it, toOpener = true) }
            }
            override fun onReceivedTitle(view: WebView, title: String?) {
                if (!title.isNullOrEmpty() && SavedTabs.keepable(view.url) != null && title != view.url) {
                    tab.title = title; changed()
                }
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                val kinds = PageAsks.kinds(request.resources)
                if (kinds.isEmpty()) { log("page ask", "${PageAsks.site(request.origin.toString())} ${request.resources.joinToString(" ")}: refused"); request.deny(); return }
                pageAsk(tab, request.origin.toString(), kinds, request) { got ->
                    val res = got.mapNotNull(PageAsks::resource).toTypedArray()
                    if (res.isEmpty()) request.deny() else request.grant(res)
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) = cancelAsk(request)
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                pageAsk(tab, origin, setOf(PageAsks.Kind.LOCATION), callback) { got -> callback.invoke(origin, got.isNotEmpty(), false) }
            }
            override fun onGeolocationPermissionsHidePrompt() { askingFor?.let { if (it is GeolocationPermissions.Callback) cancelAsk(it) } }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                val multiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                val shown = host?.pickFiles(params.createIntent().apply { if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true) }, multiple) { uris ->
                    log("file input", "${uris?.size ?: 0} picked"); callback.onReceiveValue(uris)
                } ?: false
                log("file input", if (shown) "the picker (${params.acceptTypes.filter { it.isNotEmpty() }.joinToString(" ").ifEmpty { "any file" }}${if (multiple) ", several" else ""})" else "no picker")
                if (!shown) callback.onReceiveValue(null)
                return true
            }
            override fun onShowCustomView(view: android.view.View, callback: CustomViewCallback) {
                if (tab !== current) { callback.onCustomViewHidden(); return }
                log("full screen", "on"); host?.fullScreen(view) { callback.onCustomViewHidden() }
            }
            override fun onHideCustomView() { log("full screen", "off"); host?.fullScreen(null, null) }
        }
        setDownloadListener { url, agent, disposition, mime, length -> download(tab, url, agent, disposition, mime, length) }
    }
}
