package com.timsrobot.trif

import android.content.Context
import android.os.Looper
import androidx.javascriptengine.EvaluationFailedException
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

/**
 * The mod reader on Android: mobile/shared/gen/mods.js (the iPhone runs it in JavaScriptCore) in a JavaScriptSandbox
 * isolate (androidx.javascriptengine: V8 in the WebView's own sandboxed process, no page, no network). Every call
 * blocks until the answer comes, so call it off the main thread (the app's store thread). An isolate that dies (a
 * mod's code too big for its heap) is made again once and the call tried again.
 *
 * Why not a hidden WebView: the sandbox needs no window, no page and no main thread, and every WebView TRIF accepts
 * (149+, WebViewCheck) has it. [connect] answers null where it hasn't (the store then says "the mod reader didn't
 * start", as iPhone's does without its context).
 */
class JsModReader private constructor(private val sandbox: JavaScriptSandbox, private val source: String) : ModReader {
    override val version: String = MessageDigest.getInstance("SHA-256").digest(source.toByteArray())
        .joinToString("") { "%02x".format(it) }

    private var isolate: JavaScriptIsolate? = null

    @Synchronized private fun eval(code: String, again: Boolean = true): String {
        if (Looper.myLooper() == Looper.getMainLooper()) throw IllegalStateException("the mod reader blocks: not on the main thread")
        var i: JavaScriptIsolate? = isolate
        return try {
            if (i == null) i = newIsolate().also { isolate = it }
            i.evaluateJavaScriptAsync(code).get(TIMEOUT_S, TimeUnit.SECONDS)
        } catch (e: Exception) {
            val why = (e as? ExecutionException)?.cause ?: e
            // (the code threw, as JavaScriptCore's exception: the isolate lives on)
            if (why is EvaluationFailedException && isolate != null) return why.message ?: "the mod reader failed"
            isolate = null
            runCatching { i?.close() }
            if (again) eval(code, false) else "the mod reader stopped: ${why.message ?: why}"
        }
    }

    private fun newIsolate(): JavaScriptIsolate {
        val p = IsolateStartupParameters()
        if (sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) p.maxHeapSizeBytes = HEAP
        return sandbox.createIsolate(p).also { it.evaluateJavaScriptAsync(source).get(TIMEOUT_S, TimeUnit.SECONDS) }
    }

    private fun withInput(text: String, opts: JSONObject, call: String) =
        "globalThis.__input = ${JSONObject.quote(text)}; globalThis.__opts = $opts; $call"

    override fun read(text: String, file: String, site: String, here: String) =
        eval(withInput(text, JSONObject().put("file", file).put("site", site).put("here", here), READ))

    override fun check(text: String, file: String, site: String) =
        eval(withInput(text, JSONObject().put("file", file).put("site", site), CHECK))

    /** modfile.js freePageScript and freeRelayScript: the reader's own text, the same until the app brings a new one. */
    override val free: Pair<String, String>? by lazy {
        val page = eval("String(__trifMods.freePageScript)")
        val relay = eval("String(__trifMods.freeRelayScript)")
        if (page.startsWith("(") && relay.startsWith("(")) page to relay else null
    }

    /** What changed from one text to another (helper/lib/diff.js), as JSON [{…}]. */
    fun diff(before: String, after: String): String =
        eval("globalThis.__a = ${JSONObject.quote(before)}; globalThis.__b = ${JSONObject.quote(after)}; JSON.stringify(__trifMods.lineDiff(__a, __b))")

    fun close() { runCatching { isolate?.close() }; runCatching { sandbox.close() } }

    companion object {
        private const val TIMEOUT_S = 30L
        private const val HEAP = 128L * 1024 * 1024
        /** iPhone's ModReader.readCall: findMod + readMod, or why there's no mod in it. */
        const val READ = "JSON.stringify((function () { const f = __trifMods.findMod(__input); return f ? __trifMods.readMod(f, __opts) : { error: 'there is no mod file (a ==WebMod== header) in it' }; })())"
        const val CHECK = "JSON.stringify(__trifMods.checkMod(__input, __opts))"

        /** Starts the sandbox and loads mods.js (blocking: off the main thread); null when this phone can't. */
        fun connect(context: Context, source: String): JsModReader? {
            if (!JavaScriptSandbox.isSupported()) return null
            return runCatching {
                val t0 = System.nanoTime()
                val s = JavaScriptSandbox.createConnectedInstanceAsync(context.applicationContext).get(TIMEOUT_S, TimeUnit.SECONDS)
                val t1 = System.nanoTime()
                JsModReader(s, source).also { r ->
                    check(r.eval("typeof __trifMods") == "object") { "mods.js didn't load" }
                    android.util.Log.i("TRIF", "mod reader: sandbox ${(t1 - t0) / 1_000_000} ms, mods.js ${(System.nanoTime() - t1) / 1_000_000} ms")
                }
            }.onFailure { android.util.Log.w("TRIF", "mod reader: ${it.message}") }.getOrNull()
        }
    }
}
