package com.timsrobot.trif.probe

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Message
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Part A: Tim's sign-in test (SIGN-IN-TEST.md). Nothing here signs in or types anything: it opens the page
// for a step, Tim signs in himself, then taps PASS or FAIL. Each tap goes to files/signin.log with the
// step, the user agent, and the address the page was on (without its query, which can carry codes).
class SignInActivity : Activity() {
    private val steps = listOf(
        Triple("1", "Google itself", "https://accounts.google.com/"),
        Triple("1b", "then YouTube", "https://m.youtube.com/"),
        Triple("2", "Claude + Google", "https://claude.ai/login"),
        Triple("3", "ChatGPT + Google", "https://chatgpt.com/auth/login"),
        Triple("4", "Claude + email code", "https://claude.ai/login"),
        Triple("5", "chat pane", "https://claude.ai/new"),
    )
    private val variants = listOf("default", "no-wv", "no-wv+hints")
    private var variant = 0
    private var step = 0
    private lateinit var web: WebView
    private var pane: WebView? = null
    private lateinit var status: TextView
    private lateinit var defaultUa: String
    private var defaultMeta: UserAgentMetadata? = null
    private lateinit var log: File
    private lateinit var stack: FrameLayout
    // sign-in popups ("Continue with Google" opens one; its last page, accounts.google.com/gsi/transform, hands the
    // sign-in back to the page that opened it, so it needs a real window with an opener, as in a browser)
    private val popups = mutableListOf<WebView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        log = File(filesDir, "signin.log")
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
        status = TextView(this).apply { textSize = 13f; setPadding(16, 8, 16, 8) }
        web = newWebView()
        defaultUa = web.settings.userAgentString
        if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) defaultMeta = WebSettingsCompat.getUserAgentMetadata(web.settings)
        root.addView(row(variants.mapIndexed { i, v -> v to { variant = i; applyUa(web); pane?.let { applyUa(it) }; show() } }))
        root.addView(row(steps.mapIndexed { i, s -> "${s.first} ${s.second}" to { step = i; open(i) } }))
        root.addView(row(listOf("PASS" to { record("PASS") }, "FAIL" to { record("FAIL") }, "back" to { popups.lastOrNull()?.let { p -> if (p.canGoBack()) p.goBack() else { popups.remove(p); stack.removeView(p); p.destroy(); note("popup closed by back") } } ?: run { if (web.canGoBack()) web.goBack() } },
            "clear cookies" to { CookieManager.getInstance().removeAllCookies(null); record("cookies cleared") })))
        root.addView(status)
        stack = FrameLayout(this)
        stack.addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(stack, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        setContentView(root)
        applyUa(web)
        show()
        record("started; webview ${web.settings.userAgentString}")
    }

    private fun newWebView(): WebView = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = true
        webViewClient = object : WebViewClient() { override fun onPageFinished(view: WebView, url: String) = show() }
        webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val child = newWebView(); applyUa(child)
                popups.add(child)
                stack.addView(child, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
                (resultMsg.obj as WebView.WebViewTransport).webView = child
                resultMsg.sendToTarget()
                note("popup opened")
                return true
            }
            override fun onCloseWindow(window: WebView) {
                popups.remove(window); stack.removeView(window); window.destroy()
                note("popup closed")
                show()
            }
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
    }

    private fun row(items: List<Pair<String, () -> Unit>>): View {
        val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((label, action) in items) line.addView(Button(this).apply { text = label; isAllCaps = false; textSize = 12f; setOnClickListener { action() } }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        return HorizontalScrollView(this).apply { addView(line) }
    }

    // the three user agents of ANDROID.md §5 A
    private fun applyUa(w: WebView) {
        val stripped = defaultUa.replace("; wv)", ")").replace("Version/4.0 ", "")
        w.settings.userAgentString = if (variant == 0) null else stripped
        if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
            if (variant == 2) {
                val full = Regex("Chrome/([\\d.]+)").find(defaultUa)?.groupValues?.get(1) ?: "0"
                val major = full.substringBefore('.')
                val brands = listOf("Chromium", "Google Chrome", "Not.A/Brand").map { b ->
                    UserAgentMetadata.BrandVersion.Builder().setBrand(b).setMajorVersion(if (b.startsWith("Not")) "99" else major).setFullVersion(if (b.startsWith("Not")) "99.0.0.0" else full).build()
                }
                WebSettingsCompat.setUserAgentMetadata(w.settings, UserAgentMetadata.Builder().setBrandVersionList(brands).setFullVersion(full)
                    .setPlatform("Android").setPlatformVersion(android.os.Build.VERSION.RELEASE).setModel(android.os.Build.MODEL).setMobile(true).build())
            } else if (defaultMeta != null) {
                WebSettingsCompat.setUserAgentMetadata(w.settings, defaultMeta!!)
            }
        }
    }

    private fun open(i: Int) {
        for (p in popups) { stack.removeView(p); p.destroy() }; popups.clear()
        if (steps[i].first == "5") {
            // a second web view, opened now, sharing the app's cookies: is it already signed in?
            pane?.let { (it.parent as? FrameLayout)?.removeView(it); it.destroy() }
            val p = newWebView(); applyUa(p); pane = p
            (web.parent as FrameLayout).addView(p, FrameLayout.LayoutParams(MATCH_PARENT, (web.height * 0.6).toInt(), android.view.Gravity.BOTTOM))
            p.loadUrl(steps[i].third)
        } else {
            pane?.let { (it.parent as? FrameLayout)?.removeView(it); it.destroy() }; pane = null
            web.loadUrl(steps[i].third)
        }
        show()
    }

    private fun where(w: WebView?) = w?.url?.substringBefore('?')?.substringBefore('#') ?: "-"

    private fun show() {
        status.text = "user agent: ${variants[variant]}   step: ${steps[step].first} ${steps[step].second}\nnow on: ${where(popups.lastOrNull() ?: pane ?: web)}${if (popups.isEmpty()) "" else " (popup)"}"
    }

    private fun note(what: String) {
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        log.appendText("$time $what step=${steps[step].first} ua=${variants[variant]}\n")
    }

    private fun record(what: String) {
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val line = "$time $what step=${steps[step].first} ua=${variants[variant]} at=${where(pane ?: web)} title=\"${(pane ?: web).title ?: ""}\""
        log.appendText(line + "\n")
        android.util.Log.i("TRIFSIGNIN", line)
        status.text = "logged: $what (step ${steps[step].first}, ${variants[variant]})"
    }
}
