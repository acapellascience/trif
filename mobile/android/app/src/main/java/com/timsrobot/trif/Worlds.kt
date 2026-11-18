package com.timsrobot.trif

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptExecutionWorld
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import org.json.JSONTokener

/**
 * One WebView's script worlds (iPhone: WKContentWorld + WKUserContentController): Scripts' list put in, in each
 * world at the page's start or end; the app's message object `trifApp` in TRIF's world and the box (never the
 * page's: a page could post to it); TRIF's world's posts (window.webkit.messageHandlers.trif) to `onPost`; and
 * `call`, code run in a world with its answer back (iPhone's callAsyncJavaScript(in:)).
 * Only the main frame's messages count: the scripts run there only.
 */
class Worlds(private val web: WebView, private val onPost: (JSONObject) -> Any?) {
    private val main = Handler(Looper.getMainLooper())
    private val world = Scripts.World.entries.associateWith {
        WebViewCompat.getExecutionWorld(web, if (it == Scripts.World.PAGE) JavaScriptExecutionWorld.PAGE_WORLD_NAME else it.id)
    }
    private val handlers = mutableListOf<ScriptHandler>()
    /** Each world's way back to the main frame's page, from its last hello (world-call.js). */
    private val back = mutableMapOf<Scripts.World, JavaScriptReplyProxy>()
    private val waiting = mutableMapOf<Int, (Answer) -> Unit>()
    private var n = 0

    data class Answer(val ok: Boolean, val value: Any?, val error: String?)

    init {
        for (w in listOf(Scripts.World.TRIF, Scripts.World.BOX)) {
            WebViewCompat.addWebMessageListener(web, "trifApp", ANY, world.getValue(w)) { _, message, _, isMain, reply ->
                if (isMain) message.data?.let { heard(w, it, reply) }
            }
        }
    }

    /** Puts in `list` in place of what's there (for the next page loaded). */
    fun install(list: List<Scripts.Injection>) {
        handlers.forEach { it.remove() }
        handlers.clear()
        for (s in list) {
            val event = if (s.start) WebViewCompat.INJECTION_EVENT_DOCUMENT_START else WebViewCompat.INJECTION_EVENT_DOCUMENT_END
            handlers += WebViewCompat.addJavaScriptOnEvent(web, s.source, event, ANY, world.getValue(s.world))
        }
    }

    private fun heard(w: Scripts.World, data: String, reply: JavaScriptReplyProxy) {
        val m = runCatching { JSONObject(data) }.getOrNull() ?: return
        when {
            m.has("hello") -> back[w] = reply
            m.has("reply") -> waiting.remove(m.optInt("reply"))?.invoke(
                Answer(m.optBoolean("ok"), m.opt("value"), m.optString("error").takeIf { !m.optBoolean("ok") }))
            m.has("post") && w == Scripts.World.TRIF -> {
                val id = m.optInt("post")
                val answer = JSONObject().put("answer", id)
                try {
                    val body = m.optJSONObject("body") ?: throw IllegalArgumentException("not a message of the app's")
                    answer.put("ok", true).put("value", onPost(body) ?: JSONObject.NULL)
                } catch (e: Exception) {
                    answer.put("ok", false).put("error", e.message ?: "refused")
                }
                reply.postMessage(answer.toString())
            }
        }
    }

    /**
     * Runs `code` (an async function's body, with `args`) in `w` on the main frame's page, then `done` with what
     * it returned. In the page's world: evaluateJavascript (its answer as soon as it returns: no awaiting there).
     * In TRIF's world and the box: through world-call.js (the box has it once a boxed mod may run).
     */
    fun call(w: Scripts.World, code: String, args: JSONObject = JSONObject(), timeoutMs: Long = 5000, done: (Answer) -> Unit) {
        if (w == Scripts.World.PAGE) {
            val js = "(() => { try { const v = (function (args) {\n$code\n})($args); return JSON.stringify({ ok: true, value: v === undefined ? null : v }); } catch (e) { return JSON.stringify({ ok: false, error: String((e && e.message) || e) }); } })()"
            web.evaluateJavascript(js) { raw ->
                val m = runCatching { JSONObject(JSONTokener(raw).nextValue() as String) }.getOrNull()
                done(if (m == null) Answer(false, null, "no answer") else Answer(m.optBoolean("ok"), m.opt("value"), m.optString("error").takeIf { !m.optBoolean("ok") }))
            }
            return
        }
        val proxy = back[w] ?: return done(Answer(false, null, "nothing of TRIF's in that world on this page"))
        val id = ++n
        waiting[id] = done
        main.postDelayed({ waiting.remove(id)?.invoke(Answer(false, null, "no answer in $timeoutMs ms")) }, timeoutMs)
        proxy.postMessage(JSONObject().put("call", id).put("code", code).put("args", args).toString())
    }

    companion object {
        private val ANY = setOf("*")
    }
}
