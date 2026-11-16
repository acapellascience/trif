// The model on this iPhone (Tim, 11-16; the research: mobile/local-model/README.md): llama.cpp's own XCFramework
// (mobile/browser-probe/fetch-llama.sh puts it in Vendor/; it has no Simulator slice, so in the Simulator all of this is
// left out and the engine says so). A thin wrapper over its C API:
//   - the weights read from disk as they're needed (mmap), a 4–6k context, the KV cache in q8_0;
//   - the system prompt's part evaluated once, its state saved to a file (llama_state_seq_save_file) and restored
//     for every later request, so a request only reads the page and the person's words;
//   - generation under a grammar (GBNF), so the reply is always the shape TRIF reads;
//   - what it took (load, restore, prompt and generation speed, the memory left) for the diagnostics, to measure
//     on a real SE.
// (Also compiled by mobile/local-model/harness.sh against the framework's macOS slice, to try it on a Mac.)

import Foundation
#if os(iOS)
import os
#endif
#if canImport(llama)
import llama

final class LocalLlama {
    struct Stats {
        var loadMs = 0, restoreMs = 0, restored = false
        var promptTokens = 0, promptMs = 0.0, genTokens = 0, genMs = 0.0
        var memBeforeMB = -1, memAfterMB = -1
        var promptPerSecond: Double { promptMs > 0 ? Double(promptTokens) / promptMs * 1000 : 0 }
        var genPerSecond: Double { genMs > 0 ? Double(genTokens) / genMs * 1000 : 0 }
        var summary: String {
            "load \(loadMs) ms, system prompt \(restored ? "restored in \(restoreMs) ms" : "evaluated (\(restoreMs) ms, saved)"), read \(promptTokens) tokens at \(Int(promptPerSecond)) tok/s, wrote \(genTokens) at \(String(format: "%.1f", genPerSecond)) tok/s, memory left \(memBeforeMB) → \(memAfterMB) MB"
        }
    }
    enum Failure: LocalizedError {
        case load(String), decode(Int32), grammar, tooLong(Int)
        var errorDescription: String? {
            switch self {
            case .load(let p): return "the model couldn't be loaded (\(p))"
            case .decode(let c): return "the model stopped while reading (\(c))"
            case .grammar: return "the reply's shape couldn't be set up"
            case .tooLong(let n): return "the page is too long for the model (\(n) tokens)"
            }
        }
    }

    private var model: OpaquePointer?
    private var ctx: OpaquePointer?
    private var vocab: OpaquePointer?
    let nCtx: Int32
    private(set) var loadMs = 0
    private static let backend: Void = { llama_backend_init() }()

    /// Memory the app can still use, in MB (os_proc_available_memory; -1 where there's none to ask, on a Mac).
    static var memoryLeftMB: Int {
        #if os(iOS)
        return Int(os_proc_available_memory() / 1_048_576)
        #else
        return -1
        #endif
    }

    init(path: String, nCtx: Int32) throws {
        _ = LocalLlama.backend
        self.nCtx = nCtx
        let t0 = Date()
        var mp = llama_model_default_params()
        mp.n_gpu_layers = 99
        mp.load_mode = LLAMA_LOAD_MODE_MMAP
        guard let m = llama_model_load_from_file(path, mp) else { throw Failure.load((path as NSString).lastPathComponent) }
        model = m
        vocab = llama_model_get_vocab(m)
        var cp = llama_context_default_params()
        cp.n_ctx = UInt32(nCtx)
        cp.n_batch = 512
        cp.n_ubatch = 512
        cp.n_seq_max = 1
        let cores = max(2, min(6, ProcessInfo.processInfo.activeProcessorCount - 2))
        cp.n_threads = Int32(cores)
        cp.n_threads_batch = Int32(cores)
        // (the KV cache in q8_0, half of f16's memory; a quantized V cache needs flash attention)
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED
        cp.type_k = GGML_TYPE_Q8_0
        cp.type_v = GGML_TYPE_Q8_0
        cp.no_perf = false
        guard let c = llama_init_from_model(m, cp) else { llama_model_free(m); model = nil; throw Failure.load("no context") }
        ctx = c
        loadMs = Int(Date().timeIntervalSince(t0) * 1000)
    }

    deinit { unload() }
    func unload() {
        if let ctx { llama_free(ctx) }
        if let model { llama_model_free(model) }
        ctx = nil; model = nil; vocab = nil
    }

    // MARK: the prompt

    /// The model's own chat template (its built-in kind: llama_chat_apply_template), else ChatML. Split around the
    /// person's message: what comes before it (the system prompt, the part kept) and after it.
    func template(system: String) -> (prefix: String, suffix: String) {
        let marker = "\u{1}TRIF-USER\u{1}"
        let tmpl = model.flatMap { llama_model_chat_template($0, nil) }
        var text: String?
        "system".withCString { r0 in system.withCString { c0 in "user".withCString { r1 in marker.withCString { c1 in
            var msgs = [llama_chat_message(role: r0, content: c0), llama_chat_message(role: r1, content: c1)]
            var buf = [CChar](repeating: 0, count: (system.utf8.count + 4096) * 2)
            let n = llama_chat_apply_template(tmpl, &msgs, 2, true, &buf, Int32(buf.count))
            if n > 0, Int(n) <= buf.count { text = String(decoding: buf.prefix(Int(n)).map { UInt8(bitPattern: $0) }, as: UTF8.self) }
        } } } }
        var full = text ?? "<|im_start|>system\n\(system)<|im_end|>\n<|im_start|>user\n\(marker)<|im_end|>\n<|im_start|>assistant\n"
        // (a model that thinks first, as Qwen 3.5 does: told not to, as the research ran it (enable_thinking: false))
        if let tmpl, String(cString: tmpl).contains("<think>"), !full.hasSuffix("</think>\n\n") { full += "<think>\n\n</think>\n\n" }
        guard let r = full.range(of: marker) else { return (full, "") }
        return (String(full[..<r.lowerBound]), String(full[r.upperBound...]))
    }

    func tokenize(_ s: String, addSpecial: Bool) -> [llama_token] {
        guard let vocab else { return [] }
        let n = Int32(s.utf8.count) + 16
        var out = [llama_token](repeating: 0, count: Int(n))
        let got = llama_tokenize(vocab, s, Int32(s.utf8.count), &out, n, addSpecial, true)
        if got < 0 {
            out = [llama_token](repeating: 0, count: Int(-got))
            let again = llama_tokenize(vocab, s, Int32(s.utf8.count), &out, -got, addSpecial, true)
            return Array(out.prefix(Int(max(again, 0))))
        }
        return Array(out.prefix(Int(got)))
    }

    private func decode(_ tokens: [llama_token]) throws {
        guard let ctx else { return }
        var i = 0
        while i < tokens.count {
            var chunk = Array(tokens[i..<min(i + 512, tokens.count)])
            let rc = chunk.withUnsafeMutableBufferPointer { llama_decode(ctx, llama_batch_get_one($0.baseAddress, Int32($0.count))) }
            if rc != 0 { throw Failure.decode(rc) }
            i += chunk.count
        }
    }

    // MARK: a request

    /// One reply: the system prompt's state restored from `cachePath` (or evaluated and saved there), then the person's
    /// message read, then the reply written under `grammar` (GBNF; nil: free). `onText` gets the text so far;
    /// `cancelled` is asked between tokens.
    func generate(system: String, user: String, grammar: String?, maxTokens: Int, cachePath: String, seed: UInt32 = 7,
                  cancelled: () -> Bool = { false }, onText: (String) -> Void = { _ in }) throws -> (text: String, stats: Stats) {
        guard let ctx, let vocab else { throw Failure.load("unloaded") }
        var stats = Stats()
        stats.loadMs = loadMs
        stats.memBeforeMB = LocalLlama.memoryLeftMB
        let (prefix, suffix) = template(system: system)
        let pre = tokenize(prefix, addSpecial: true)
        let rest = tokenize(user + suffix, addSpecial: false)
        if pre.count + rest.count + maxTokens > Int(nCtx) { throw Failure.tooLong(pre.count + rest.count) }
        llama_memory_clear(llama_get_memory(ctx), true)
        llama_perf_context_reset(ctx)
        // (the system prompt: its saved state, if it's this prompt's; else read now and saved for next time)
        let t0 = Date()
        var restored = false
        if FileManager.default.fileExists(atPath: cachePath) {
            var got = [llama_token](repeating: 0, count: pre.count + 8)
            var n = 0
            let size = llama_state_seq_load_file(ctx, cachePath, 0, &got, got.count, &n)
            if size > 0, n == pre.count, Array(got.prefix(n)) == pre { restored = true }
            else { llama_memory_clear(llama_get_memory(ctx), true); try? FileManager.default.removeItem(atPath: cachePath) }
        }
        if !restored {
            try decode(pre)
            _ = llama_state_seq_save_file(ctx, cachePath, 0, pre, pre.count)
        }
        stats.restored = restored
        stats.restoreMs = Int(Date().timeIntervalSince(t0) * 1000)
        llama_perf_context_reset(ctx)
        try decode(rest)

        guard let chain = llama_sampler_chain_init(llama_sampler_chain_default_params()) else { throw Failure.grammar }
        defer { llama_sampler_free(chain) }
        if let grammar {
            guard let g = llama_sampler_init_grammar(vocab, grammar, "root") else { throw Failure.grammar }
            llama_sampler_chain_add(chain, g)
        }
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.9, 1))
        llama_sampler_chain_add(chain, llama_sampler_init_temp(0.2))
        llama_sampler_chain_add(chain, llama_sampler_init_dist(seed))

        var bytes: [UInt8] = []
        var text = ""
        var piece = [CChar](repeating: 0, count: 256)
        for _ in 0..<maxTokens {
            if cancelled() { break }
            let tok = llama_sampler_sample(chain, ctx, -1)
            if llama_vocab_is_eog(vocab, tok) { break }
            let n = llama_token_to_piece(vocab, tok, &piece, Int32(piece.count), 0, false)
            if n > 0 { bytes += piece.prefix(Int(n)).map { UInt8(bitPattern: $0) } }
            // (a character split across tokens waits for its last byte)
            if let s = String(bytes: bytes, encoding: .utf8) { text += s; bytes = []; onText(text) }
            var next = [tok]
            let rc = next.withUnsafeMutableBufferPointer { llama_decode(ctx, llama_batch_get_one($0.baseAddress, 1)) }
            if rc != 0 { throw Failure.decode(rc) }
        }
        let perf = llama_perf_context(ctx)
        stats.promptTokens = Int(perf.n_p_eval)
        stats.promptMs = perf.t_p_eval_ms
        stats.genTokens = Int(perf.n_eval)
        stats.genMs = perf.t_eval_ms
        stats.memAfterMB = LocalLlama.memoryLeftMB
        return (text, stats)
    }
}
#endif
