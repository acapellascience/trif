package com.timsrobot.trif.probe

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptExecutionWorld
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File

// One activity. `--es mode box` runs part B by itself (headless): loads each probe page with three
// document-start scripts, one per world, and writes what each world reports as PASS/FAIL lines to
// files/box.log (read back with `adb exec-out run-as com.timsrobot.trif.probe cat files/box.log`).
class ProbeActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var log: File
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)
        when (intent.getStringExtra("mode") ?: "box") {
            else -> runBox()
        }
    }

    private fun line(s: String) {
        Log.i("TRIFPROBE", s)
        log.appendText(s + "\n")
    }

    private fun asset(name: String) = assets.open(name).bufferedReader().use { it.readText() }

    private fun runBox() {
        log = File(filesDir, "box.log").also { it.writeText("") }
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        val pkg = WebViewCompat.getCurrentWebViewPackage(this)
        line("INFO webview ${pkg?.packageName} ${pkg?.versionName} sdk=${android.os.Build.VERSION.SDK_INT}")
        line("INFO userAgent ${web.settings.userAgentString}")
        val features = listOf(WebViewFeature.DOCUMENT_START_SCRIPT, WebViewFeature.WEB_MESSAGE_LISTENER, WebViewFeature.USER_AGENT_METADATA,
            WebViewFeature.MULTI_PROFILE, WebViewFeature.PROXY_OVERRIDE, WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)
        line("INFO features " + features.joinToString(" ") { "$it=${WebViewFeature.isFeatureSupported(it)}" })
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)) {
            line("FAIL setup JS_INJECTION_IN_FRAME_AND_WORLD is not supported by this WebView")
            line("DONE"); return
        }
        line("PASS setup JS_INJECTION_IN_FRAME_AND_WORLD supported")
        val all = setOf("*")
        val page = WebViewCompat.getExecutionWorld(web, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
        val own = WebViewCompat.getExecutionWorld(web, "trif")
        val box = WebViewCompat.getExecutionWorld(web, "trif-box")
        val listener = WebViewCompat.WebMessageListener { _, message, origin, isMain, _ -> onReport(message.data ?: "", origin.toString(), isMain) }
        WebViewCompat.addWebMessageListener(web, "probePage", all, page, listener)
        WebViewCompat.addWebMessageListener(web, "trifOwn", all, own, listener)
        WebViewCompat.addWebMessageListener(web, "trifBox", all, box, listener)
        val t0 = System.nanoTime()
        val boxScript = "globalThis.__trifT0 = performance.now();\n" + asset("ses.umd.min.js") + "\n;\n" + asset("sandbox-runtime.js") + "\n;\n" + asset("box-start.js")
        line("INFO box script ${boxScript.length / 1024} KB, read in ${(System.nanoTime() - t0) / 1_000_000} ms")
        WebViewCompat.addJavaScriptOnEvent(web, asset("page-start.js"), WebViewCompat.INJECTION_EVENT_DOCUMENT_START, all, page)
        WebViewCompat.addJavaScriptOnEvent(web, asset("own-start.js"), WebViewCompat.INJECTION_EVENT_DOCUMENT_START, all, own)
        WebViewCompat.addJavaScriptOnEvent(web, boxScript, WebViewCompat.INJECTION_EVENT_DOCUMENT_START, all, box)

        val base = intent.getStringExtra("base") ?: "http://127.0.0.1:8477/"
        val pages = (intent.getStringExtra("pages") ?: "strict.html,trusted.html,hostile.html,plain.html,cross.html").split(",")
        val wait = intent.getIntExtra("wait", 6000).toLong()
        var i = -1
        var current = ""
        var retried = ""
        var failedLoad = false
        fun next() {
            i++
            if (i >= pages.size) { line("DONE"); finish(); return }
            current = pages[i]
            line("PAGE $current")
            web.loadUrl(base + current)
        }
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, req: android.webkit.WebResourceRequest, err: android.webkit.WebResourceError) {
                line("INFO load error ${pageName()} ${req.url} ${err.errorCode} ${err.description}")
                // (the first request through a fresh adb reverse can come back empty: try the page once more)
                if (req.isForMainFrame && retried != current) { retried = current; failedLoad = true; main.postDelayed({ failedLoad = false; web.loadUrl(base + current) }, 1500) }
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!url.endsWith(current) || failedLoad) return
                val which = current
                main.postDelayed({ if (which == current) next() }, wait)
            }
        }
        pageName = { current }
        this.failedLoad = { failedLoad }
        next()
    }

    private var pageName: () -> String = { "" }
    private var failedLoad: () -> Boolean = { false }

    private fun onReport(text: String, origin: String, isMain: Boolean) {
        if (origin.startsWith("null") || text.contains("chrome-error://")) { if (failedLoad()) return }
        val o = try { JSONObject(text) } catch (e: Exception) { line("INFO ${pageName()} not JSON from $origin: ${text.take(200)}"); return }
        val world = o.optString("world")
        if (!o.optString("href").startsWith("http")) { line("FAIL ${pageName()} $world loaded ${o.optString("href")} instead of the page B0.loaded"); return }
        val frame = if (isMain) "top" else "frame:" + o.optString("href").substringAfterLast('/')
        val checks = o.optJSONObject("checks")
        o.remove("checks")
        checks?.keys()?.forEach { k -> line("${if (checks.getBoolean(k)) "PASS" else "FAIL"} ${pageName()} $world $frame $k") }
        line("DATA ${pageName()} $world $frame $o")
    }
}
