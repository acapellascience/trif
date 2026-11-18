package com.timsrobot.trif

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * The mods reader (mobile/shared/gen/mods.js, the iPhone's JavaScriptCore part): its answers as JSON text, so the
 * store stays pure. Its engine comes in the next item (JavaScriptSandbox or a hidden WebView). Called off the main
 * thread when it may be slow.
 */
interface ModReader {
    /** The reader's own version (a hash of mods.js): a new one reads every mod again. */
    val version: String
    /** findMod + readMod: the mod as JSON, or {error}. */
    fun read(text: String, file: String = "", site: String = "", here: String = ""): String
    /** checkMod: {ok, errors: [{line, message}], lint, tier}. */
    fun check(text: String, file: String, site: String): String
    /** freePageScript and freeRelayScript, when the reader has them. */
    val free: Pair<String, String>? get() = null
    /** A shared rule (mobile/shared/gen/core.js, `TrifCore.call(name, args)`: args a JSON array, the answer as JSON),
     *  run where the reader runs; null when there's no answer (iPhone: Core.swift's call). */
    fun core(name: String, args: String): String? = null
}

/**
 * The installed mods, as the iPhone's ModStore (Mods.swift): on/off (a mod's, a mod's on one site, a tier's on a
 * site), holds and Allow, History, Recently deleted (30 days), Pause all; what runs on an address and the scripts'
 * plan (Scripts.Plan). Kept in files under `root` ([ModFiles]); `onChange` after each change (the browser makes the
 * pages' scripts again from [plan]).
 */
class ModStore(
    private val files: ModFiles,
    var reader: ModReader? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    var mods: List<InstalledMod> = files.load(); private set
    /** The tiers switched off on a site (the Mods tab's On / Off on each tier): site → [style, boxed, free]. */
    var groupsOff: Map<String, List<String>> = emptyMap(); private set
    /** The last mod deleted, for Undo (this launch only). */
    var lastDeleted: InstalledMod? = null; private set
    /** Recently deleted: every mod deleted here, for 30 days, newest first. */
    var trash: List<DeletedMod> = files.loadTrash().filter { it.at > now() - TRASH_DAYS * DAY }; private set
    /** Pause all mods: no mod runs anywhere until Resume. */
    var paused = false; private set
    var onChange: (() -> Unit)? = null

    init {
        val s = files.loadSettings()
        groupsOff = s.optJSONObject("groupsOff").lists()
        paused = s.optBoolean("paused")
    }

    fun setPaused(p: Boolean) { paused = p; save() }

    private fun save() {
        files.write(mods)
        files.writeTrash(trash)
        files.writeSettings(JSONObject().put("groupsOff", JSONObject().apply { groupsOff.forEach { (k, v) -> put(k, JSONArray(v)) } })
            .put("paused", paused).put("reader", readerVersion)
            .apply { freeKept?.let { (page, relay) -> put("free", JSONObject().put("page", page).put("relay", relay)) } })
        onChange?.invoke()
    }

    private var readerVersion: String? = files.loadSettings().str("reader")
    /** The reader's free pair (freePageScript, freeRelayScript) as the last reader made it, for a start before it's up. */
    private var freeKept: Pair<String, String>? = files.loadSettings().optJSONObject("free")
        ?.let { o -> o.str("page")?.let { p -> o.str("relay")?.let { p to it } } }
    /** Whether any mod waits for the reader to make its scripts (a file kept before scripts were). */
    val needsReading get() = mods.any { it.script.isEmpty() }

    /**
     * Every mod read again from its file when the reader is new (or when a mod's scripts are missing), so what runs
     * is what this reader makes of it. Its switches, allowed, history and hold stay.
     */
    fun reread(force: Boolean = mods.any { it.script.isEmpty() }) {
        val r = reader ?: return
        if (!force && readerVersion == r.version) return
        val out = mutableListOf<InstalledMod>()
        for (old in mods) {
            val m = build(r.read(old.code, old.file, old.site)).mod
            if (m == null) { out += old; continue }
            out.removeAll { it.id == m.id }
            out += m.copy(on = old.on, offSites = old.offSites, source = old.source, newOff = old.newOff, added = old.added,
                history = old.history, allowed = old.allowed, ran = old.ran, extraNeeds = old.extraNeeds)
        }
        mods = out
        readerVersion = r.version
        freeKept = r.free
        save()
    }

    // MARK: reading

    data class Read(val mod: InstalledMod?, val error: String?)

    fun read(text: String, file: String = "", site: String = "", here: String = ""): Read {
        val r = reader ?: return Read(null, "the mod reader didn't start")
        return build(r.read(text, file, site, here))
    }

    /** As `read`, and when one kept here has its @name and site (a chat's new version of it), under that one's id. */
    fun readNamed(text: String, here: String): Read {
        val r = read(text, here = here)
        val m = r.mod ?: return r
        if (mods.any { it.id == m.id }) return r
        val same = mods.firstOrNull { it.name == m.name && it.site == m.site } ?: return r
        return read(text, same.file, same.site, here)
    }

    // MARK: what runs

    fun groupOff(tier: String, site: String) = groupsOff[site].orEmpty().contains(tier)

    /** Whether a mod is switched on (for a site: its switch there). */
    fun isOn(m: InstalledMod, site: String?): Boolean {
        if (!m.on) return false
        if (site.isNullOrEmpty()) return true
        return !(m.multiSite && site in m.offSites)
    }

    /** Whether a mod's @match (and @exclude) covers an address. */
    fun applies(m: InstalledMod, url: String) = MatchPattern.any(m.matches, url) && !MatchPattern.any(m.excludes, url)

    /** The mods switched on, not held (a change on hold: its version before), whose @match covers this address. */
    fun running(url: String): List<InstalledMod> {
        if (paused) return emptyList()
        val site = Site.of(WebAddress.of(url)?.host ?: "")
        return mods.filter { m ->
            m.on && !(m.held && m.ran == null) && !groupOff(m.tier, site) && !(m.multiSite && site in m.offSites) && applies(m, url)
        }
    }

    /** What runs on a page at `url`, as one string: a page loaded under another signature loads again to run the
     *  change, once it's the tab shown (docs/MOBILE-BEHAVIOUR.md, "Which tabs load again"). */
    fun signature(url: String): String = running(url).map { m ->
        val r = m.ran?.takeIf { m.held }
        val parts = if (r != null) listOf(r.script, r.world, r.at, r.style ?: "") else listOf(m.script, m.world, m.at, m.styleScript)
        var h = parts.fold(17) { a, s -> 31 * a + s.hashCode() }
        for ((k, v) in m.allowed.toSortedMap()) h = 31 * (31 * h + k.hashCode()) + v.hashCode()
        for ((k, v) in m.powerArgs.toSortedMap()) h = 31 * (31 * h + k.hashCode()) + v.hashCode()
        "${m.id}:${Integer.toHexString(h)}"
    }.sorted().joinToString(",")

    /** What every page gets for the mods (iPhone's scriptPlan): each mod on and not held (a change on hold: the
     *  version before), with the sites it's off on (its own switches there, and the sites whose tier is off). */
    fun plan(): Scripts.Plan {
        if (paused) return Scripts.Plan()
        data class Runs(val m: InstalledMod, val script: String, val world: String, val at: String, val style: String)
        val list = mods.filter { it.on }.mapNotNull { m ->
            if (m.held) m.ran?.let { Runs(m, it.script, it.world, it.at, it.style ?: "") }
            else Runs(m, m.script, m.world, m.at, m.styleScript)
        }.filter { it.script.isNotEmpty() }
        val bridged = list.filter { (m, script, world) ->
            world == "box" && (if (m.held) script.contains("\"site-data\"") else "site-data" in m.powers)
        }.map { it.m.matches to it.m.excludes }
        val mods = list.map { (m, script, world, at, style) ->
            val off = ((if (m.multiSite) m.offSites else emptyList()) + groupsOff.filter { m.tier in it.value }.keys).toSortedSet().toList()
            Scripts.Plan.One(m.id, script, world, at, style, off, m.matches, m.excludes)
        }
        return Scripts.Plan(mods, reader?.free ?: freeKept, bridged)
    }

    // MARK: changes

    private fun stamp() = now().toString()
    private fun recent(l: List<ModVersion>) = l.filter { it.at > now() - 30 * DAY }.take(30)

    /**
     * Adds a mod, or a new version of the one with its id (the one before kept in its history). `source`: chat,
     * import, link, pasted, edit or computer. One the person added is on; an import starts off, marked new (updated,
     * if it replaces one). A new version that needs an OK the one before didn't: the one before keeps running.
     */
    fun add(new: InstalledMod, source: String): InstalledMod {
        var m = new.copy(source = source, cameFrom = null)
        val i = mods.indexOfFirst { it.id == m.id }
        val list = mods.toMutableList()
        if (i >= 0) {
            val old = mods[i]
            var history = old.history
            if (old.code != m.code) history = listOf(ModVersion(stamp(), now(), old.code, if (source in listOf("import", "edit", "computer")) source else "chat")) + history
            m = m.copy(history = recent(history), allowed = old.allowed, offSites = old.offSites, added = old.added)
            m = when (source) {
                "import" -> m.copy(on = false, newOff = "update")
                "edit", "computer" -> m.copy(on = old.on, newOff = old.newOff)
                else -> m.copy(on = true, newOff = null)
            }
            when (ranAfter(m.held, old, restore = false)) {
                "ran" -> m = m.copy(ran = old.ran)
                "current" -> m = m.copy(ran = RanVersion(old.code, old.script, old.world, old.at, old.styleScript))
            }
            list[i] = m
        } else {
            if (source == "import") m = m.copy(on = false, newOff = "import")
            else if (source == "computer") m = m.copy(on = false, newOff = "computer")
            list += m
        }
        mods = list
        save()
        return m
    }

    /** A quick ask's Undo: the mod as it was before (`before`), or gone if it was new; not to Recently deleted. */
    fun undoAdd(id: String, before: InstalledMod?) {
        mods = if (before != null) {
            if (mods.any { it.id == id }) mods.map { if (it.id == id) before else it } else mods + before
        } else mods.filter { it.id != id }
        save()
    }

    /** Deletes a mod: to Recently deleted (30 days). `by`: you (the Mods tab: Undo too) or computer (a sync). */
    fun remove(id: String, by: String = "you") {
        val m = mods.firstOrNull { it.id == id } ?: return
        mods = mods.filter { it.id != id }
        if (by == "you") lastDeleted = m
        trash = (listOf(DeletedMod(m, now(), by)) + trash).filter { it.at > now() - TRASH_DAYS * DAY }.take(200)
        save()
    }

    fun undoDelete() {
        val m = lastDeleted ?: return
        if (mods.none { it.id == m.id }) mods = mods + m
        trash.indexOfFirst { it.mod.id == m.id }.takeIf { it >= 0 }?.let { i -> trash = trash.filterIndexed { j, _ -> j != i } }
        lastDeleted = null
        save()
    }

    /** Puts a mod from Recently deleted back. False: one with its id is here now (or the entry is gone). */
    fun restoreDeleted(entry: String): Boolean {
        val d = trash.firstOrNull { it.id == entry } ?: return false
        if (mods.any { it.id == d.mod.id }) return false
        trash = trash.filter { it !== d }
        mods = mods + d.mod
        if (lastDeleted?.let { l -> mods.any { it.id == l.id } } == true) lastDeleted = null
        save()
        return true
    }

    /** A mod's switch: the whole mod, or (a mod for several sites) its switch on one site. */
    fun setOn(id: String, on: Boolean, site: String? = null) {
        update(id) { m ->
            var n = if (!site.isNullOrEmpty() && m.multiSite) {
                val offs = m.offSites.filter { it != site } + (if (!on) listOf(site) else emptyList())
                m.copy(offSites = offs, on = m.on || on)
            } else m.copy(on = on)
            if (on) n = n.copy(newOff = null)
            n
        }
    }

    fun setGroup(tier: String, on: Boolean, site: String) {
        val list = groupsOff[site].orEmpty().filter { it != tier } + (if (!on) listOf(tier) else emptyList())
        groupsOff = if (list.isEmpty()) groupsOff - site else groupsOff + (site to list)
        save()
    }

    /** Allow: what it waits for is allowed for it (a later version that needs nothing more runs without asking). */
    fun approve(id: String) = update(id) { it.copy(allowed = holdsApprove(it), ran = null) }

    /** Don't allow a change on hold: the version before is back (this one kept in its history). A new mod: deleted. */
    fun reject(id: String) {
        val cur = mods.firstOrNull { it.id == id } ?: return
        val ran = cur.ran
        val back = ran?.let { read(it.code, cur.file, cur.site).mod }
        if (back == null) { remove(id); return }
        replace(id, back.copy(on = cur.on, offSites = cur.offSites, allowed = cur.allowed, source = cur.source, added = cur.added,
            extraNeeds = emptyList(), history = listOf(ModVersion(stamp(), now(), cur.code, "undo")) + cur.history))
    }

    // MARK: editing (the code card's Edit)

    /** An edit checked as `trif check` checks a file (modfile.js checkMod). */
    fun check(text: String, m: InstalledMod): JSONObject {
        val r = reader ?: return failed("the mod reader didn't start")
        return runCatching { JSONObject(r.check(text, m.file, m.site)) }.getOrElse { failed("the check gave nothing back") }
    }

    data class Edit(val mod: InstalledMod?, val stamp: String?, val check: JSONObject)

    /** Saves an edit (checked first: a broken one is never saved), judged as any change (held.js): if it needs an OK
     *  the version before didn't, the version before keeps running. Its id and site stay. */
    fun saveEdit(id: String, text: String): Edit {
        val old = mods.firstOrNull { it.id == id } ?: return Edit(null, null, failed("that mod isn't here any more"))
        val checked = check(text, old)
        val m = if (checked.optBoolean("ok")) read(text, old.file, old.site).mod else null
        if (m == null) return Edit(null, null, checked)
        if (m.code == old.code) return Edit(old, null, checked)
        val allowed = seeded(old)
        mods = mods.map { if (it.id == id) it.copy(allowed = allowed) else it }
        val saved = add(m.copy(allowed = allowed, extraNeeds = changeNeeds(m, old)), "edit")
        return Edit(saved, saved.history.firstOrNull()?.stamp, checked)
    }

    /** Restore a kept version: it becomes the mod (the current one kept in History), judged again like any change. */
    fun restore(id: String, version: String, source: String = "restore"): Boolean {
        val cur = mods.firstOrNull { it.id == id } ?: return false
        val v = cur.history.firstOrNull { it.stamp == version } ?: return false
        var back = read(v.code, cur.file, cur.site).mod ?: return false
        back = back.copy(on = cur.on, offSites = cur.offSites, source = cur.source, added = cur.added, newOff = cur.newOff,
            allowed = seeded(cur), history = listOf(ModVersion(stamp(), now(), cur.code, source)) + cur.history)
        back = back.copy(extraNeeds = changeNeeds(back, cur))
        back = back.copy(ran = if (ranAfter(back.held, cur, restore = true) == "current") RanVersion(cur.code, cur.script, cur.world, cur.at, cur.styleScript) else null)
        replace(id, back)
        return true
    }

    // MARK: holds and Allow: the phones' shared rules (mobile/shared/core/mod-store.js, TrifCore.modStore), run where
    // the reader runs (an add, an edit, a restore, Allow: not hot paths). `InstalledMod.waiting` stays a Kotlin twin, held
    // to the same cases (ModStoreTest): `held` is asked of every mod for every page's plan. No answer (no reader): what
    // iPhone's ModHolds does without its Core: nothing more allowed, a change asks about more, never less.

    /** What the rules read of a mod (iPhone's InstalledMod.holdFacts). */
    private fun facts(m: InstalledMod) = JSONObject().put("tier", m.tier).put("site", m.site).put("matches", JSONArray(m.matches))
        .put("needs", JSONArray(m.needs.map(ModNeed::json))).put("extraNeeds", JSONArray(m.extraNeeds.map(ModNeed::json)))
        .put("allowed", JSONObject().apply { m.allowed.forEach { (k, v) -> put(k, JSONArray(v)) } }).put("ran", m.ran != null)

    private fun core(name: String, vararg args: Any): Any? {
        val out = runCatching { reader?.core("modStore.$name", JSONArray(args.toList()).toString()) }.getOrNull() ?: return null
        return runCatching { JSONTokener(out).nextValue() }.getOrNull()?.takeIf { it != JSONObject.NULL }
    }
    private fun allowedOf(v: Any?) = (v as? JSONObject)?.lists()

    /** Allow: what the mod waits for, allowed for it. No answer: allowed as it was (it stays held). */
    private fun holdsApprove(m: InstalledMod) = allowedOf(core("approve", facts(m))) ?: m.allowed

    /** What a change asks about beyond its code's needs, judged against the version before. No answer: becoming a free
     *  mod, and every @match if it can act. */
    fun changeNeeds(m: InstalledMod, was: InstalledMod): List<ModNeed> =
        (core("changeNeeds", facts(m), facts(was)) as? JSONArray)?.objects()?.map(ModNeed::of)
            ?: ((if (m.tier == "free" && was.tier != "free") listOf(ModNeed("tier:free", "is now a free mod, so it can do anything the page can do")) else emptyList()) +
                (if (m.needs.isEmpty()) emptyList() else m.matches.map { ModNeed("match:$it", "runs on $it, outside ${Site.of(was.site)}") }))

    /** What the person had allowed plus what the version that ran already did. No answer: only what was allowed. */
    fun seeded(old: InstalledMod) = allowedOf(core("seeded", facts(old))) ?: old.allowed

    /** Which version runs while a change waits: "ran" (the one the version before kept), "current" (the version
     *  before), or null. No answer: null (nothing runs until the person decides). */
    private fun ranAfter(changeHeld: Boolean, old: InstalledMod, restore: Boolean) =
        core("ranAfter", changeHeld, facts(old), if (restore) "restore" else "add") as? String

    private fun update(id: String, f: (InstalledMod) -> InstalledMod) {
        if (mods.none { it.id == id }) return
        mods = mods.map { if (it.id == id) f(it) else it }
        save()
    }
    private fun replace(id: String, m: InstalledMod) = update(id) { m }
    private fun failed(why: String) = JSONObject().put("ok", false).put("errors", JSONArray().put(JSONObject().put("message", why)))

    companion object {
        const val TRASH_DAYS = 30L
        const val DAY = 86_400_000L

        /** The reader's answer (JSON) as the mod the app keeps, or why it can't be one (iPhone's ModStore.build). */
        fun build(out: String): Read {
            val d = runCatching { JSONObject(out) }.getOrNull() ?: return Read(null, "the mod reader gave nothing back: ${out.take(200)}")
            d.str("error")?.let { return Read(null, it) }
            val info = d.optJSONObject("powerInfo")
            val m = InstalledMod(
                id = d.optString("id"), site = d.optString("site"), name = d.optString("name"), description = d.optString("description"),
                tier = d.optString("tier"), sites = d.optJSONArray("sites").strings(), matches = d.optJSONArray("matches").strings(),
                excludes = d.optJSONArray("excludes").strings(), powers = d.optJSONArray("powers").strings(),
                powerArgs = d.optJSONObject("powerArgs").lists(),
                facts = info?.optJSONArray("facts").objects().map { PowerFact(it.optString("power"), it.optString("fact")) },
                warnings = info?.optJSONArray("warnings").strings(),
                risk = d.optJSONObject("risk")?.takeIf { it.has("tier") }?.let { ModRisk(it.optInt("tier"), it.str("why")) },
                hash = d.optString("hash"), needs = d.optJSONArray("needs").objects().map(ModNeed::of),
                code = d.optString("code"), script = d.optString("script"), world = d.optString("world"), at = d.optString("at"),
                styleScript = d.optString("styleScript"),
            )
            return Read(m, null)
        }
    }
}

/**
 * Mods in files (iPhone's ModFilesStore): `root`/mods/<site__name>.json and an order file, Recently deleted in
 * `root`/mods-deleted.json, the tiers off / paused / the reader's version in `root`/mods-settings.json. Written on a
 * thread of their own, in order (the latest list wins); only the mods whose text changed are written again.
 */
class ModFiles(private val root: File, private val io: Executor = Executors.newSingleThreadExecutor()) {
    private val dir get() = File(root, "mods").apply { mkdirs() }
    private fun file(id: String) = File(dir, id.replace("/", "__") + ".json")
    private val written = HashMap<String, String>()

    fun load(): List<InstalledMod> {
        val ids = runCatching { JSONArray(File(dir, "order.json").readText()).strings() }.getOrDefault(emptyList())
        return ids.mapNotNull { id ->
            runCatching { file(id).readText() }.getOrNull()?.let { t ->
                runCatching { InstalledMod.of(JSONObject(t)) }.getOrNull()?.also { synchronized(written) { written[id] = t } }
            }
        }
    }

    fun loadTrash(): List<DeletedMod> =
        runCatching { JSONArray(File(root, "mods-deleted.json").readText()).objects().mapNotNull { runCatching { DeletedMod.of(it) }.getOrNull() } }
            .getOrDefault(emptyList())

    fun loadSettings(): JSONObject = runCatching { JSONObject(File(root, "mods-settings.json").readText()) }.getOrDefault(JSONObject())

    fun write(mods: List<InstalledMod>) {
        val texts = mods.map { it.id to it.json().toString() }
        io.execute {
            for ((id, t) in texts) if (synchronized(written) { written[id] } != t) { atomic(file(id), t); synchronized(written) { written[id] = t } }
            atomic(File(dir, "order.json"), JSONArray(texts.map { it.first }).toString())
            val keep = texts.map { file(it.first).name }.toSet() + "order.json"
            dir.listFiles()?.filter { it.name !in keep }?.forEach { f ->
                f.delete(); synchronized(written) { written.keys.removeAll { file(it).name == f.name } }
            }
        }
    }

    fun writeTrash(list: List<DeletedMod>) {
        val t = JSONArray(list.map(DeletedMod::json)).toString()
        io.execute { atomic(File(root, "mods-deleted.json"), t) }
    }

    fun writeSettings(o: JSONObject) {
        val t = o.toString()
        io.execute { atomic(File(root, "mods-settings.json"), t) }
    }

    /** Waits for the writes so far (tests, and before the process may end). */
    fun flush() { val done = java.util.concurrent.CountDownLatch(1); io.execute { done.countDown() }; done.await() }

    private fun atomic(f: File, text: String) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }
}
