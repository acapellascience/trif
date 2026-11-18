package com.timsrobot.trif

import android.util.Log
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

    // MARK: what runs: the phones' shared rules (core mod-store.js part 3, match.js). `running`, `isOn`, `off` and
    // MatchPattern are Kotlin twins (ModRuns, held to mod-runs-cases.json): every page load asks them of every mod.

    /** Whether a mod is switched on (for a site: its switch there). */
    fun isOn(m: InstalledMod, site: String?) = ModRuns.isOn(m, site)

    /** Whether a mod's @match (and @exclude) covers an address. */
    fun applies(m: InstalledMod, url: String) = ModRuns.applies(m.matches, m.excludes, WebAddress.of(url))

    /** The mods switched on, not held (a change on hold: its version before), whose @match covers this address. */
    fun running(url: String): List<InstalledMod> = ModRuns.running(mods, paused, groupsOff, url).map { mods[it.first] }

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
            val off = ModRuns.off(m, groupsOff)
            Scripts.Plan.One(m.id, script, world, at, style, off, m.matches, m.excludes)
        }
        return Scripts.Plan(mods, reader?.free ?: freeKept, bridged)
    }

    // MARK: changes: the phones' shared rules too (core mod-store.js part 2, iPhone's ModChanges.swift). They read times,
    // ids and hold facts and answer with indices into the lists given (-1: the new entry) and the fields taken from the
    // version before; the records and the code stay Kotlin's. No answer (no reader): iPhone's fallbacks, so nothing is
    // lost and nothing new runs.

    private fun ints(v: Any?) = (v as? JSONArray)?.let { a -> (0 until a.length()).map { a.optInt(it, Int.MIN_VALUE) }.takeIf { Int.MIN_VALUE !in it } }
    private fun <T> pick(idx: List<Int>, list: List<T>, new: T?): List<T> = idx.mapNotNull { if (it < 0) new else list.getOrNull(it) }
    private fun times(l: List<Long>) = JSONArray(l.map { JSONObject().put("at", it) })
    private fun record(m: InstalledMod, on: Boolean, newOff: String?, history: List<ModVersion>? = null) = facts(m)
        .put("on", on).put("newOff", newOff ?: JSONObject.NULL).apply { history?.let { put("history", times(it.map(ModVersion::at))) } }
    /** A kept version from a rule's {stamp, source}: its time is the change's, its code the version before's. */
    private fun kept(v: Any?, at: Long, code: String) = (v as? JSONObject)?.let { o ->
        val s = o.str("stamp") ?: return@let null
        ModVersion(s, at, code, o.str("source") ?: return@let null)
    }
    /** Takes `fields` (a rule's names) from `o`, as iPhone's InstalledMod.take. */
    private fun InstalledMod.take(fields: Collection<String>, o: InstalledMod): InstalledMod = fields.fold(this) { m, f ->
        when (f) {
            "on" -> m.copy(on = o.on)
            "newOff" -> m.copy(newOff = o.newOff)
            "offSites" -> m.copy(offSites = o.offSites)
            "allowed" -> m.copy(allowed = o.allowed)
            "source" -> m.copy(source = o.source)
            "added" -> m.copy(added = o.added)
            else -> { Log.w("TRIF", "a change keeps $f, which the app doesn't know"); m }
        }
    }

    /**
     * Adds a mod, or a new version of the one with its id (the one before kept in its history). `source`: chat,
     * import, link, pasted, edit or computer. One the person added is on; an import starts off, marked new (updated,
     * if it replaces one). A new version that needs an OK the one before didn't: the one before keeps running.
     */
    fun add(new: InstalledMod, source: String): InstalledMod {
        var m = new.copy(source = source, cameFrom = null)
        val i = mods.indexOfFirst { it.id == m.id }
        val list = mods.toMutableList()
        val at = now()
        if (i >= 0) {
            val old = mods[i]
            val changed = old.code != m.code
            val r = core("add", record(old, old.on, old.newOff, old.history), record(m.copy(allowed = old.allowed), m.on, m.newOff), source, at, changed) as? JSONObject
            if (r != null && r.opt("on") is Boolean) {
                m = m.copy(source = r.str("source") ?: source, on = r.getBoolean("on"), newOff = r.str("newOff"))
                    .take(r.optJSONArray("keep").strings(), old)
                m = m.copy(history = pick(ints(r.opt("history")) ?: emptyList(), old.history, kept(r.opt("version"), at, old.code)))
                when (r.str("ran")) {
                    "ran" -> m = m.copy(ran = old.ran)
                    "current" -> m = m.copy(ran = RanVersion(old.code, old.script, old.world, old.at, old.styleScript))
                }
            } else {
                // (no answer: off and marked updated, nothing dropped, nothing kept running)
                m = m.copy(on = false, newOff = "update", allowed = old.allowed, offSites = old.offSites, added = old.added,
                    history = (if (changed) listOf(ModVersion(at.toString(), at, old.code, source)) else emptyList()) + old.history)
            }
            list[i] = m
        } else {
            val r = core("add", JSONObject.NULL, record(m, m.on, m.newOff), source, at, true) as? JSONObject
            m = if (r != null && r.opt("on") is Boolean) m.copy(source = r.str("source") ?: source, on = r.getBoolean("on"), newOff = r.str("newOff"))
                else m.copy(on = false, newOff = if (source == "computer") "computer" else "import")
            list += m
        }
        mods = list
        save()
        return m
    }

    /** A quick ask's Undo: the mod as it was before (`before`), or gone if it was new; not to Recently deleted. No
     *  answer: as they are. */
    fun undoAdd(id: String, before: InstalledMod?) {
        val idx = ints(core("undoAdd", JSONArray(mods.map { it.id }), id, before != null)) ?: return
        mods = pick(idx, mods, before)
        save()
    }

    /** Deletes a mod: to Recently deleted (30 days, 200). `by`: you (the Mods tab: Undo too) or computer (a sync). */
    fun remove(id: String, by: String = "you") {
        val m = mods.firstOrNull { it.id == id } ?: return
        val at = now()
        val r = core("remove", times(trash.map { it.at }), by, at) as? JSONObject
        val undo = (r?.opt("undo") as? Boolean) ?: (by == "you")
        val keep = ints(r?.opt("keep")) ?: trash.indices.toList()
        mods = mods.filter { it.id != id }
        if (undo) lastDeleted = m
        trash = listOf(DeletedMod(m, at, by)) + pick(keep, trash, null)
        save()
    }

    /** Undo of a delete. No answer: nothing undone. */
    fun undoDelete() {
        val m = lastDeleted ?: return
        val r = core("undoDelete", m.id, JSONArray(mods.map { it.id }), JSONArray(trash.map { it.mod.id })) as? JSONObject ?: return
        if (r.optBoolean("append")) mods = mods + m
        val drop = r.optInt("drop", -1)
        if (drop in trash.indices) trash = trash.filterIndexed { j, _ -> j != drop }
        lastDeleted = null
        save()
    }

    /** Puts a mod from Recently deleted back. False: one with its id is here now (or the entry is gone, or no answer). */
    fun restoreDeleted(entry: String): Boolean {
        val r = core("restoreDeleted", entry, JSONArray(trash.map { JSONObject().put("id", it.id).put("modId", it.mod.id) }),
            JSONArray(mods.map { it.id }), lastDeleted?.id ?: JSONObject.NULL) as? JSONObject ?: return false
        val i = r.optInt("index", -1).takeIf { it in trash.indices } ?: return false
        mods = mods + trash[i].mod
        trash = trash.filterIndexed { j, _ -> j != i }
        if (r.optBoolean("clearLast")) lastDeleted = null
        save()
        return true
    }

    /** A mod's switch: the whole mod, or (a mod for several sites) its switch on one site; switching on clears "new,
     *  off" (the shared rule, core setOn). No answer: nothing changes (iPhone's ModRuns.setOn). */
    fun setOn(id: String, on: Boolean, site: String? = null) {
        val m = mods.firstOrNull { it.id == id } ?: return
        val r = core("setOn", ModRuns.facts(m), on, site ?: JSONObject.NULL) as? JSONObject ?: return
        val isOn = r.opt("on") as? Boolean ?: return
        val offs = (r.opt("offSites") as? JSONArray)?.strings() ?: return
        val clear = r.opt("clearNewOff") as? Boolean ?: return
        update(id) { it.copy(on = isOn, offSites = offs, newOff = if (clear) null else it.newOff) }
    }

    /** A tier's switch on a site (the shared rule, core setGroup). No answer: nothing changes. */
    fun setGroup(tier: String, on: Boolean, site: String) {
        val g = core("setGroup", JSONObject().apply { groupsOff.forEach { (k, v) -> put(k, JSONArray(v)) } }, tier, on, site) as? JSONObject ?: return
        if (g.keys().asSequence().any { g.opt(it) !is JSONArray }) return
        groupsOff = g.lists()
        save()
    }

    /** Allow: what it waits for is allowed for it (a later version that needs nothing more runs without asking). */
    fun approve(id: String) = update(id) { it.copy(allowed = holdsApprove(it), ran = null) }

    /** Don't allow a change on hold: the version before is back (this one kept in its history). A new mod: deleted.
     *  No answer: nothing changes (it stays held). */
    fun reject(id: String) {
        val cur = mods.firstOrNull { it.id == id } ?: return
        val at = now()
        val r = answer("reject", JSONObject().put("ran", cur.ran != null).put("history", times(cur.history.map(ModVersion::at))), at)
        if (r === NONE) return
        val c = r as? JSONObject
        val ran = cur.ran
        val back = if (c != null && ran != null) read(ran.code, cur.file, cur.site).mod else null
        if (c == null || back == null) { remove(id); return }
        var b = back.take(c.optJSONArray("keep").strings(), cur)
        if (c.optJSONArray("extraNeeds") != null) b = b.copy(extraNeeds = c.optJSONArray("extraNeeds").objects().map(ModNeed::of))
        b = b.copy(history = pick(ints(c.opt("history")) ?: emptyList(), cur.history, kept(c.opt("version"), at, cur.code)))
        replace(id, b)
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
        val at = now()
        val c = core("restore", JSONObject().put("history", times(cur.history.map(ModVersion::at))), source, at) as? JSONObject ?: return false
        back = back.take(c.optJSONArray("keep").strings(), cur).copy(allowed = seeded(cur),
            history = pick(ints(c.opt("history")) ?: return false, cur.history, kept(c.opt("version"), at, cur.code)))
        back = back.copy(extraNeeds = changeNeeds(back, cur))
        // (it waits: the version before keeps running, or what that one was keeping while a change waited: the last
        // approved version, as an edit there keeps it (Tim, 11-18; iPhone's Mods.swift restore))
        back = back.copy(ran = when (ranAfter(back.held, cur, restore = true)) {
            "ran" -> cur.ran
            "current" -> RanVersion(cur.code, cur.script, cur.world, cur.at, cur.styleScript)
            else -> null
        })
        replace(id, back)
        return true
    }

    // MARK: holds and Allow: the phones' shared rules (mobile/shared/core/mod-store.js, TrifCore.modStore), run where
    // the reader runs (an add, an edit, a restore, Allow: not hot paths). `InstalledMod.waiting` stays a Kotlin twin, held
    // to the same cases (ModStoreTest): `held` is asked of every mod for every page's plan. No answer (no reader): what
    // iPhone's ModHolds does without its Core: nothing more allowed, a change asks about more, never less.

    private fun facts(m: InstalledMod) = ModRuns.facts(m)

    /** A rule's answer: NONE if there was none (no reader, a throw), JSONObject.NULL for the rule's own null. */
    private fun answer(name: String, vararg args: Any): Any = coreAnswer("modStore.$name", *args)
    private fun coreAnswer(name: String, vararg args: Any): Any {
        val out = runCatching { reader?.core(name, JSONArray(args.toList()).toString()) }.getOrNull() ?: return NONE
        return runCatching { JSONTokener(out).nextValue() }.getOrNull() ?: NONE
    }
    private fun core(name: String, vararg args: Any): Any? = answer(name, *args).takeIf { it !== NONE && it != JSONObject.NULL }
    private object NONE

    /**
     * Add this mod?'s coral box (TrifCore.modOffer.elsewhere, as iPhone's ModOfferRules): the shared rule decides, the
     * words stay ModOffer's. No answer: the box for every site (a warning too many rather than one missed).
     */
    fun offerPlace(m: InstalledMod): ModOffer.Place? {
        val from = m.cameFrom?.takeIf { it.isNotEmpty() } ?: return null
        return when (val r = coreAnswer("modOffer.elsewhere", from, m.site, JSONArray(m.sites))) {
            JSONObject.NULL -> null
            is JSONObject -> if (r.optBoolean("every")) ModOffer.Place.Every else {
                val o = r.optJSONArray("others")
                if (o == null || !r.has("also")) ModOffer.Place.Every
                else ModOffer.Place.Others(List(o.length()) { o.getString(it) }, r.getBoolean("also"))
            }
            else -> ModOffer.Place.Every
        }
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
