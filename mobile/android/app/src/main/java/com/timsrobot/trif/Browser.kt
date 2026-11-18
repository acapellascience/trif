package com.timsrobot.trif

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
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
    /** The tab whose page opened this one as a window (window.open, target=_blank): not kept between launches. */
    var opener: Tab? = null
    /** It's a window a tap opened (its first load counts as tapped if the finger was on the page just now). */
    var openedByTap = false
    /** The question about another app's link was put for this load (one a load); the last line logged. */
    var askedThisLoad = false
    var droppedLine: String? = null
    val started get() = web != null
    val url: String? get() = SavedTabs.keepable(web?.url) ?: savedUrl.takeIf { !started }
    val host: String get() = url?.let { Uri.parse(it).host } ?: ""
    /** Its name in the tab list: its title, else its site, else New tab (as iPhone's Tab.label). */
    fun label(newTab: String) = title.ifEmpty { host.ifEmpty { newTab } }
}

/**
 * The tabs (as iPhone's Browser: several pages at once, each in a WebView of its own, all sharing one profile, so
 * the same cookies and sign-ins), kept between launches. [changed] tells the screen to redraw what it shows.
 * Every WebView is made in [makeWebView], where later items add the script worlds and the mods.
 */
class Browser(private val context: Context, private val changed: () -> Unit) {
    val tabs = mutableListOf<Tab>()
    var current: Tab? = null
        private set
    private val file = File(context.noBackupFilesDir, "tabs.json")
    /** The screen is in front (set by MainActivity): only then may a page's own try at another app ask. */
    var inFront = false
    private var asking: AlertDialog? = null

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
        if (!tab.started) start(tab)
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
        tab.web = null
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
                tab.askedThisLoad = false; tab.droppedLine = null
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, reload: Boolean) { changed() }
            override fun onPageFinished(view: WebView, url: String) {
                tab.title = view.title?.takeIf { SavedTabs.keepable(url) != null && it != url } ?: ""
                save()
                changed()
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
        }
    }
}
