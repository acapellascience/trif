package com.timsrobot.trif

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** One tab: its own WebView (made the first time it's shown) with its own back and forward. */
class Tab(val id: String = UUID.randomUUID().toString(), var title: String = "", var savedUrl: String? = null,
          var savedState: JSONObject? = null) {
    var web: WebView? = null
    /** The tab whose page opened this one as a window (window.open, target=_blank): not kept between launches. */
    var opener: Tab? = null
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
        t.web = makeWebView(t)
        tabs.add(TabOrder.insertAt(tabs.indexOf(opener ?: current), tabs.size), t)
        (resultMsg.obj as WebView.WebViewTransport).webView = t.web
        resultMsg.sendToTarget()
        select(t)
        return true
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
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // (real windows: onCreateWindow below; only from a tap, as in the probe's passing sign-ins)
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = false
        // (sign-in through another site, "Continue with Google", passed in the probe with these on)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        webViewClient = object : WebViewClient() {
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
