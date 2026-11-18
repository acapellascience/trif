package com.timsrobot.trif.probe

import android.app.Activity
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import java.io.File

// Part C, one mode per check (run-c.js drives it headless and reads files/c.log back over adb):
//   net    C1: what shouldInterceptRequest sees of the page's fetch POST and WebSocket (pages/net.html)
//   video  C2: pages/video.html playing; `--ez fgs true` also starts MediaService (a mediaPlayback foreground service)
//   pin    C3: asks the launcher to pin a shortcut that opens `site` mode on plain.html
//   site   what the pinned shortcut opens: the site full screen, no system bars
class CheckActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var web: WebView
    private val mode by lazy { intent.getStringExtra("mode") ?: "net" }
    private val base by lazy { intent.getStringExtra("base") ?: "http://127.0.0.1:8477/" }

    @Synchronized private fun line(s: String) {
        Log.i("TRIFPROBE", s)
        File(filesDir, "c.log").appendText("${System.currentTimeMillis()} $mode $s\n")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        line("LIFE create sdk=${Build.VERSION.SDK_INT} webview=${WebViewCompat.getCurrentWebViewPackage(this)?.versionName}")
        if (mode == "pin") return pin()
        // C2: `--ez keep true` = a WebView that keeps telling Chromium its window is visible, so the page isn't
        // marked hidden (and its video isn't paused) when the app goes to the background
        val keep = intent.getBooleanExtra("keep", false)
        web = object : WebView(this) {
            override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(if (keep) android.view.View.VISIBLE else visibility) }
        }
        if (keep) line("KEEP visible")
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        WebViewCompat.addWebMessageListener(web, "probe", setOf("*")) { _, msg, _, _, _ -> line("PAGE ${msg.data}") }
        web.webViewClient = object : WebViewClient() {
            // C1: called on a background thread for every request the WebView loads itself; returning null lets it go on
            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                line("SEEN ${req.method} ${req.url} mainFrame=${req.isForMainFrame} headers=${req.requestHeaders.keys.sorted()}")
                return null
            }
            override fun onPageFinished(view: WebView, url: String) { line("LOADED $url") }
        }
        when (mode) {
            "video" -> {
                if (intent.getBooleanExtra("fgs", false)) { startForegroundService(Intent(this, MediaService::class.java)); line("FGS started") }
                web.loadUrl(base + "video.html")
            }
            "site" -> {
                if (Build.VERSION.SDK_INT >= 30) window.insetsController?.hide(WindowInsets.Type.systemBars())
                web.loadUrl(intent.data?.toString() ?: (base + "plain.html"))
                main.postDelayed({
                    val insets = window.decorView.rootWindowInsets
                    val bars = if (Build.VERSION.SDK_INT >= 30 && insets != null) insets.isVisible(WindowInsets.Type.systemBars()) else null
                    line("SITE url=${intent.data} action=${intent.action} systemBarsVisible=$bars size=${web.width}x${web.height} screen=${window.decorView.width}x${window.decorView.height}")
                }, 3000)
            }
            else -> web.loadUrl(base + "net.html")
        }
    }

    private fun pin() {
        val sm = getSystemService(ShortcutManager::class.java)
        line("PIN supported=${sm.isRequestPinShortcutSupported}")
        val open = Intent(this, CheckActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(base + "plain.html"))
            .putExtra("mode", "site").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        val info = ShortcutInfo.Builder(this, "probe-site").setShortLabel("Probe site").setLongLabel("TRIF probe: plain.html")
            .setIcon(Icon.createWithResource(this, android.R.drawable.ic_menu_compass)).setIntent(open).build()
        line("PIN requested=${sm.requestPinShortcut(info, null)}")
        main.postDelayed({ finish() }, 500)
    }

    override fun onStart() { super.onStart(); line("LIFE start") }
    override fun onStop() { super.onStop(); line("LIFE stop") }
    override fun onDestroy() { super.onDestroy(); line("LIFE destroy"); if (mode == "video") stopService(Intent(this, MediaService::class.java)) }
}
