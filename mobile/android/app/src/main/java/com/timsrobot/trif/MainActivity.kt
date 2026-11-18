package com.timsrobot.trif

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout

/** Round 1's shell: an address field over one WebView. Tabs, worlds and mods come in the next items. */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var field: EditText

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
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun doUpdateVisitedHistory(view: WebView, url: String?, reload: Boolean) = backChanged()
                override fun onPageFinished(view: WebView, url: String) {
                    if (!field.hasFocus() && url.startsWith("http")) field.setText(url)
                }
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            addView(field, LinearLayout.LayoutParams(-1, -2))
            addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        })
        if (saved != null) web.restoreState(saved) else showStart()
        intent?.dataString?.let { go(it) }
    }

    private fun showStart() {
        val words = getString(R.string.start_empty)
        web.loadDataWithBaseURL(null, "<meta name=viewport content='width=device-width'>" +
            "<p style='font:16px sans-serif;color:#666;text-align:center;margin-top:30vh'>$words</p>", "text/html", "utf-8", null)
    }

    fun go(text: String) {
        val url = Address.resolve(text) ?: return
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(field.windowToken, 0)
        field.clearFocus()
        web.requestFocus()
        web.loadUrl(url)
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        web.saveState(out)
    }

    // Back goes back in the page while it can, else the system's own back (predictive back stays on: the
    // callback is registered only while the page has somewhere to go back to).
    private val backCallback: Any? = if (Build.VERSION.SDK_INT >= 33) OnBackInvokedCallback { web.goBack() } else null
    private var backRegistered = false

    private fun backChanged() {
        if (Build.VERSION.SDK_INT < 33) return
        val want = web.canGoBack()
        if (want == backRegistered) return
        val cb = backCallback as OnBackInvokedCallback
        if (want) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
        else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(cb)
        backRegistered = want
    }

    @Deprecated("Android 10-12 only; 13+ uses the OnBackInvokedCallback above")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
