package com.timsrobot.trif

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptExecutionWorld
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executor

/**
 * The Mods tab (iPhone's ModsPanel.swift): the desktop side panel's mods list, the iPhone app's own page for it
 * (web/mods.html, mods-page.js, mods-page.css over the panel's sidepanel.css and switch.css, with gen/panel-kit.js)
 * in a WebView of its own that never loads anything else. It gets the shown site's mods from here ([refresh] →
 * window.trifRender) and asks for every change by a message: window.webkit.messageHandlers.app.postMessage, which
 * js/webkit-bridge.js makes from the page world's `trifApp` (iPhone: a WKScriptMessageHandlerWithReply in .page).
 * The store is touched only on the store thread (`work`); answers and the page go back on the main thread.
 */
class ModsPanel(
    private val activity: Activity,
    private val browser: Browser,
    private val mods: ModStore,
    private val work: Executor,
    /** Import mod…: the activity's file picker. */
    private val pickImport: () -> Unit,
    /** Export / Export all: the files to the share sheet. */
    private val share: (List<java.io.File>) -> Unit,
    private val reader: () -> JsModReader?,
) {
    private val main = Handler(Looper.getMainLooper())
    private var ready = false
    private var seq = 0
    private var lastAnswer: ModsState.PageAnswer? = null
    private var recheck: Runnable? = null
    /** The approval card to open when the page is next shown (a mod just added that waits). */
    var openApproval: String? = null
    /** Whether the tab is on screen (it asks the page only then). */
    var shown = false

    /** Every file of the page by its own name, from wherever the build put it (iPhone: one flat bundle). */
    private val loader = WebViewAssetLoader.Builder()
        .addPathHandler("/mods/") { path ->
            if (path.contains("..") || path.startsWith("/")) return@addPathHandler null
            FOLDERS.firstNotNullOfOrNull { dir -> runCatching { activity.assets.open(dir + path) }.getOrNull() }
                ?.let { WebResourceResponse(mime(path), "utf-8", it) }
        }.build()

    val web: WebView = WebView(activity).apply {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        val pageWorld = WebViewCompat.getExecutionWorld(this, JavaScriptExecutionWorld.PAGE_WORLD_NAME)
        WebViewCompat.addWebMessageListener(this, "trifApp", setOf(ORIGIN)) { _, message, _, isMain, reply ->
            if (isMain) message.data?.let { heard(it, reply) }
        }
        val bridge = activity.assets.open("js/webkit-bridge.js").bufferedReader().use { it.readText() }
            .replace("})('trif');", "})('app');")
        WebViewCompat.addJavaScriptOnEvent(this, bridge, WebViewCompat.INJECTION_EVENT_DOCUMENT_START, setOf(ORIGIN), pageWorld)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "utf-8", 404, "Not here", null, null)
            // (nothing but the page itself: a link in a mod's code or description isn't followed in here)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = !request.url.toString().startsWith(PAGE_DIR)
            override fun onPageFinished(view: WebView, url: String) { ready = true; refresh() }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.w("TRIF", "ended: the Mods tab's page process; loading it again")
                ready = false
                view.reload()
                return true
            }
        }
        loadUrl("$PAGE_DIR/mods.html")
    }

    // MARK: the state

    private fun pageNow(): ModsState.Page {
        val t = browser.current
        return ModsState.Page(t?.web?.url ?: "", t?.loading == true, t?.loadedIds, t?.finishedAt)
    }

    /** The state from the app's own store (at once: never waits for the page, which may be busy or gone). */
    private fun state(done: (JSONObject) -> Unit) {
        val page = pageNow()
        val answer = lastAnswer
        work.execute {
            val s = ModsState.build(mods, page, answer, ++seq)
            main.post { done(s) }
        }
    }

    /**
     * Sends the page what it shows: first what the app knows (at once), then what the shown page says (which mods
     * started there, their errors) when it answers within 2 s (a busy page answers late: iPhone, 11-15).
     */
    fun refresh(open: String? = null) {
        if (!ready) return
        val o = open ?: openApproval
        openApproval = null
        state { send(it, o) }
        // (a page still loading has nothing to say yet, and a call to the page it's replacing goes unanswered: it's
        // asked when it finishes, pageChanged)
        if (!shown || browser.current?.web?.url == null || browser.current?.loading == true) return
        askPage { answer ->
            if (answer == null) { Log.i("TRIF", "slow: the Mods tab asked the page which mods started there, and it didn't answer within 2 s"); return@askPage }
            lastAnswer = answer
            state { s ->
                send(s, null)
                // (a mod still starting: asked again once its grace is over; one wait at a time)
                val wait = s.optDouble("recheck", Double.NaN)
                recheck?.let(main::removeCallbacks)
                recheck = if (wait.isNaN()) null else Runnable { recheck = null; refresh() }.also { main.postDelayed(it, (wait * 1000).toLong()) }
            }
        }
    }

    private fun send(state: JSONObject, open: String?) {
        web.evaluateJavascript("window.trifRender && window.trifRender($state, ${open?.let(JSONObject::quote) ?: "null"});", null)
    }

    /** The shown page's answer: which mods started (each world's __trifRan) and the boxed and free mods' errors. */
    private fun askPage(done: (ModsState.PageAnswer?) -> Unit) {
        val url = browser.current?.web?.url ?: return done(null)
        val asked = System.currentTimeMillis()
        val ran = mutableSetOf<String>()
        val box = mutableListOf<Pair<String, String>>()
        val page = mutableListOf<String>()
        var left = 5
        var over = false
        val timeout = Runnable { if (!over) { over = true; done(null) } }
        main.postDelayed(timeout, 2000)
        fun one() {
            if (--left > 0 || over) return
            over = true
            main.removeCallbacks(timeout)
            done(ModsState.PageAnswer(url, ran, box, page, asked))
        }
        for (w in listOf(Scripts.World.TRIF, Scripts.World.BOX, Scripts.World.PAGE)) {
            browser.call(w, "return Array.isArray(globalThis.__trifRan) ? globalThis.__trifRan.map(String) : [];") { a ->
                (a.value as? JSONArray)?.let { l -> for (i in 0 until l.length()) ran += l.optString(i) }
                one()
            }
        }
        browser.call(Scripts.World.BOX, "return globalThis.__trifSandbox ? globalThis.__trifSandbox.errors.map((e) => [String(e.mod), String(e.message)]) : [];") { a ->
            (a.value as? JSONArray)?.let { l -> for (i in 0 until l.length()) l.optJSONArray(i)?.let { r -> if (r.length() == 2) box += r.optString(0) to r.optString(1) } }
            one()
        }
        browser.call(Scripts.World.PAGE, "return Array.isArray(window.__trifModErrors) ? window.__trifModErrors.map(String) : [];") { a ->
            (a.value as? JSONArray)?.let { l -> for (i in 0 until l.length()) page += l.optString(i) }
            one()
        }
    }

    // MARK: the page's messages

    private fun heard(data: String, reply: JavaScriptReplyProxy) {
        val m = runCatching { JSONObject(data) }.getOrNull() ?: return
        if (!m.has("post")) return
        val answer = JSONObject().put("answer", m.optInt("post"))
        val body = m.optJSONObject("body")
        val back: (Any?, String?) -> Unit = { value, error ->
            main.post {
                if (error == null) answer.put("ok", true).put("value", value ?: JSONObject.NULL) else answer.put("ok", false).put("error", error)
                reply.postMessage(answer.toString())
            }
        }
        if (body == null) back(null, "not a message of the Mods tab's") else handle(body, back)
    }

    private class Refused(why: String) : Exception(why)

    /** One of the page's messages (or the tab's own menu's): what it asks for, done; its answer, or why not. */
    fun handle(d: JSONObject, back: (Any?, String?) -> Unit) {
        val type = d.optString("type")
        val id = d.optString("id")
        if (type == "state") return state { back(it.toString(), null) }
        if (type == "copy") {
            activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("mod", d.optString("text")))
            return back(JSONObject().put("ok", true), null)
        }
        val site = Site.of(browser.current?.host ?: "")
        work.execute {
            val mod = mods.mods.firstOrNull { it.id == id }
            fun need() = mod ?: throw Refused("that mod isn't here any more")
            fun log(line: String) = Log.i("TRIF", "mods: $line")
            val ok = JSONObject().put("ok", true)
            val (value, again) = try {
                when (type) {
                    "enable" -> {
                        val on = d.optBoolean("enabled")
                        val s = d.optString("site").ifEmpty { null }
                        mods.setOn(id, on, s)
                        log("$id switched ${if (on) "on" else "off"}${s?.let { " on $it" } ?: ""}")
                        ok to true
                    }
                    "group" -> {
                        val g = d.optString("group").ifEmpty { throw Refused("no group") }
                        mods.setGroup(when (g) { "rules" -> "style"; "sandboxed" -> "boxed"; else -> "free" }, d.optBoolean("enabled", true), site)
                        ok to true
                    }
                    "delete" -> { mods.remove(id); log("deleted $id"); ok to true }
                    "resume" -> { mods.setPaused(false); ok to true }
                    // (no safe mode, phone sync or hide rules on Android yet: nothing to dismiss, sync or show again)
                    "dismissOff", "syncNow", "syncSeen" -> ok to true
                    "restoreDeleted" -> {
                        val entry = d.optString("entry")
                        if (mods.trash.none { it.id == entry }) throw Refused("It isn't in Recently deleted any more.")
                        if (!mods.restoreDeleted(entry)) throw Refused("A mod with the same name is here now. Delete or rename it first.")
                        log("restored $entry")
                        ok to true
                    }
                    "undoDelete" -> { mods.undoDelete(); ok to true }
                    "approve" -> { mods.approve(id); log("allowed $id"); ok to true }
                    "reject" -> { mods.reject(id); log("didn't allow $id"); ok to true }
                    "code" -> {
                        val m = need()
                        JSONObject().put("code", if (d.optString("version") == "ran") m.ran?.code ?: m.code else m.code) to false
                    }
                    "diff" -> {
                        val m = need()
                        val ran = m.ran ?: throw Refused("nothing is waiting")
                        JSONObject().put("lines", diff(ran.code, m.code)) to false
                    }
                    "history" -> JSONObject().put("entries", JSONArray(need().history.map {
                        JSONObject().put("stamp", it.stamp).put("at", it.at).put("source", it.source)
                    })) to false
                    "historyCode", "historyDiff" -> {
                        val m = need()
                        val v = m.history.firstOrNull { it.stamp == d.optString("stamp") } ?: throw Refused("that version isn't kept any more")
                        (if (type == "historyCode") JSONObject().put("code", v.code) else JSONObject().put("lines", diff(v.code, m.code))) to false
                    }
                    "restore" -> {
                        if (!mods.restore(id, d.optString("stamp"))) throw Refused("that version couldn't be read")
                        log("restored a version of $id")
                        ok to true
                    }
                    "check" -> mods.check(d.optString("text"), need()) to false
                    "save" -> {
                        val r = mods.saveEdit(id, d.optString("text"))
                        val m = r.mod
                        if (m == null) JSONObject().put("ok", false).put("check", r.check) to false
                        else {
                            log("edited $id${if (m.held) ", waiting for an OK" else ""}")
                            JSONObject().put("ok", true).put("saved", r.stamp != null).put("held", m.held).put("stamp", r.stamp ?: "") to true
                        }
                    }
                    "undoEdit" -> {
                        if (!mods.restore(id, d.optString("stamp"), "undo")) throw Refused("that version isn't kept any more")
                        log("undid an edit of $id")
                        ok to true
                    }
                    "export" -> {
                        val files = ModImport.write(listOf(need()), ModImport.exportDir(activity.cacheDir)) ?: throw Refused("couldn't write the file")
                        main.post { share(files) }
                        JSONObject().put("ok", true).put("file", files[0].name) to false
                    }
                    "exportSite" -> {
                        val files = ModImport.exportSite(mods.mods, site, activity.cacheDir) ?: throw Refused("no mods for $site")
                        main.post { share(files) }
                        JSONObject().put("ok", true).put("count", files.size) to false
                    }
                    "import" -> { main.post { pickImport() }; ok to false }
                    "unhide" -> throw Refused("not hidden any more")
                    else -> throw Refused("unknown message $type")
                }
            } catch (e: Refused) {
                back(null, e.message); return@execute
            } catch (e: Exception) {
                Log.w("TRIF", "mods: $type $id failed: ${e.message}")
                back(null, e.message ?: "that didn't work"); return@execute
            }
            back(value, null)
            if (again) main.post { refresh() }
        }
    }

    /** What changed from one text to another (mods.js lineDiff), as the page's lines. */
    private fun diff(before: String, after: String): JSONArray =
        reader()?.let { r -> runCatching { JSONArray(r.diff(before, after)) }.getOrNull() } ?: JSONArray()

    /** The page changed (loaded, finished): what the tab shows follows, if it's on screen. */
    fun pageChanged() { if (shown) refresh() }

    companion object {
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val PAGE_DIR = "$ORIGIN/mods"
        /** Where the build puts the page's files (SharedAssets): the iPhone's Web/, gen/, the panel, its css. */
        private val FOLDERS = listOf("web/", "gen/", "gen/panel/", "ext/")
        fun mime(path: String) = when (path.substringAfterLast('.')) {
            "html" -> "text/html"; "js" -> "text/javascript"; "css" -> "text/css"; "json" -> "application/json"
            "svg" -> "image/svg+xml"; "png" -> "image/png"; else -> "application/octet-stream"
        }
    }
}
