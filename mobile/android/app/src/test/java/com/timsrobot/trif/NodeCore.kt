package com.timsrobot.trif

import java.io.File

/**
 * The shared rules (mobile/shared/gen/core.js) for the JVM tests, in one Node.js process kept for the run: a line
 * in ({name, args}), a line out (TrifCore.call's answer, or "!" and why). The app runs the same file in its
 * JavaScriptSandbox (JsModReader.core).
 */
object NodeCore {
    private val core = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "mobile/shared/gen/core.js") }.first { it.isFile }

    private val node: String = (System.getenv("PATH").orEmpty().split(File.pathSeparator).map { File(it, "node") } +
        listOfNotNull(System.getenv("NVM_BIN")?.let { File(it, "node") }) +
        (File(System.getProperty("user.home"), ".nvm/versions/node").listFiles()?.sortedDescending()?.map { File(it, "bin/node") } ?: emptyList()) +
        listOf(File("/opt/homebrew/bin/node"), File("/usr/local/bin/node")))
        .firstOrNull { it.canExecute() }?.path ?: error("the tests need Node.js (for mobile/shared/gen/core.js)")

    private const val LOOP = "const C = require(process.argv[1]); require('readline').createInterface({ input: process.stdin })" +
        ".on('line', (l) => { let o; try { const m = JSON.parse(l); o = C.call(m.name, JSON.stringify(m.args)); } " +
        "catch (e) { o = '!' + String(e && e.message || e); } process.stdout.write(o.replace(/\\n/g, ' ') + '\\n'); });"

    private val proc by lazy { ProcessBuilder(node, "-e", LOOP, core.path).redirectErrorStream(true).start() }
    private val out by lazy { proc.outputStream.bufferedWriter() }
    private val inp by lazy { proc.inputStream.bufferedReader() }

    @Synchronized fun call(name: String, args: String): String? {
        out.write(org.json.JSONObject().put("name", name).put("args", org.json.JSONArray(args)).toString() + "\n")
        out.flush()
        return inp.readLine()?.takeIf { !it.startsWith("!") }
    }
}
