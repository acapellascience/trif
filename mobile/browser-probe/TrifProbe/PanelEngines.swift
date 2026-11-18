// The engines behind the robot view's More (Tim, 11-16): the desktop side panel's chat (PanelChat.swift) run on the
// person's own API key, or on this iPhone. Each engine keeps one conversation in its own API's shape, so a turn goes
// back to the API exactly as it came (Claude's thinking blocks with their signatures, OpenAI's reasoning items):
//   - Claude API: Anthropic's Messages API, streamed (server-sent events), tools as tool_use / tool_result.
//   - OpenAI API: the Responses API (GPT and Codex models), streamed, tools as function calls; store: false.
//   - OpenRouter: its OpenAI-compatible chat completions, streamed, tools as tool_calls; any model it lists.
//   - On this iPhone: a small model on the phone itself (LocalModels.swift, LocalLlama.swift); in the Simulator, where
//     none can run, a stand-in with a canned reply too.
//
// Keys (APIKeys): pasted once in the panel's Settings, kept in the Keychain on this iPhone only (not synced, not in
// backups that leave it), never shown again, never logged, never in diagnostics, and sent only to that engine's own
// API host over HTTPS. (Development: `-apibase http://localhost:<port>` sends every engine to a local mock instead,
// mobile/mock-api.js, and only a loopback address is taken.)

import Foundation
import Security

// MARK: keys

enum APIKeys {
    private static let service = "com.timsrobot.trif.apikey"
    private static func query(_ engine: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: engine]
    }
    static func get(_ engine: String) -> String? {
        var q = query(engine)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func has(_ engine: String) -> Bool { get(engine) != nil }
    /// Saves it (replacing one there); the error never carries the key.
    static func set(_ engine: String, _ key: String) throws {
        SecItemDelete(query(engine) as CFDictionary)
        var q = query(engine)
        q[kSecValueData as String] = Data(key.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        q[kSecAttrSynchronizable as String] = false
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw PanelError.message("the Keychain said no (\(status))") }
    }
    static func remove(_ engine: String) { SecItemDelete(query(engine) as CFDictionary) }
}

enum PanelError: LocalizedError {
    case message(String)
    case http(Int, String)
    var errorDescription: String? {
        switch self {
        case .message(let m): return m
        case .http(let code, let m): return m.isEmpty ? "the service answered \(code)" : "\(m) (\(code))"
        }
    }
}

// MARK: what the engines share

/// A tool the model can call (PanelChat runs them against the shown tab).
struct PanelTool {
    let name: String
    let description: String
    let schema: [String: Any]
}
struct PanelToolCall {
    let id: String
    let name: String
    /// The arguments, parsed; nil when the model's JSON didn't parse (answered as an error, not run).
    let input: [String: Any]?
}
struct PanelToolResult {
    let call: PanelToolCall
    let text: String
    let image: Data?   // a JPEG, for a model that takes pictures
    let error: Bool
}
struct PanelStep {
    var text = ""
    var calls: [PanelToolCall] = []
    /// Why the model stopped: done, tools, length, refusal.
    var stop = "done"
    var inputTokens = 0
}

/// One conversation with one engine, in its API's own shape.
@MainActor
protocol PanelConversation: AnyObject {
    var takesImages: Bool { get }
    var usesTools: Bool { get }
    func addUser(_ text: String, image: Data?)
    /// One request, streamed to its end: the reply's text, the tools it asks for. `cancel`: the run's stop.
    func step(system: String, tools: [PanelTool], model: String, effort: String?) async throws -> PanelStep
    func addResults(_ results: [PanelToolResult])
}

struct PanelModel {
    let id: String
    let name: String
    var description = ""
    var efforts: [String] = []
    var defaultEffort: String?
    var images = true
}

/// The engines, as the panel's agents.
struct PanelEngine {
    let id: String
    let name: String
    /// Whose key it takes (Settings' row), or nil (On this iPhone).
    let keyName: String?
    let host: String?
    let models: [PanelModel]
    let defaultModel: String?
    /// What the panel says when its key is missing (its login notice's "To log in, …").
    var keyFix: String { "add your \(keyName ?? "") API key in Settings, under API keys" }

    static let all: [PanelEngine] = [
        PanelEngine(id: "iphone", name: "On this iPhone", keyName: nil, host: nil,
                    models: LocalModels.all.map { PanelModel(id: $0.id, name: $0.name, description: "\($0.note) \(LocalModels.size($0.size)).", images: false) } + PanelEngine.standIn,
                    defaultModel: LocalModels.suggested.id),
        // (the phone link: the person's own coding agent on their computer, PanelChat's computer runs; its model is
        // the computer's)
        PanelEngine(id: "computer", name: "My computer", keyName: nil, host: nil, models: [], defaultModel: nil),
        PanelEngine(id: "claude-api", name: "Claude API", keyName: "Anthropic", host: "api.anthropic.com",
                    models: ["claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5", "claude-fable-5-2": "Claude Fable 5.2"]
                        .sorted { order($0.key) < order($1.key) }
                        .map { PanelModel(id: $0.key, name: $0.value, efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: $0.key == "claude-opus-5-5" || $0.key == "claude-haiku-5-5" ? "medium" : "high") },
                    defaultModel: "claude-opus-5-5"),
        PanelEngine(id: "openai-api", name: "OpenAI API", keyName: "OpenAI", host: "api.openai.com",
                    models: [PanelModel(id: "gpt-5", name: "GPT-5", efforts: ["minimal", "low", "medium", "high"], defaultEffort: "medium"),
                             PanelModel(id: "gpt-5-codex", name: "GPT-5 Codex", efforts: ["low", "medium", "high"], defaultEffort: "medium"),
                             PanelModel(id: "gpt-5-mini", name: "GPT-5 mini", efforts: ["minimal", "low", "medium", "high"], defaultEffort: "medium")],
                    defaultModel: "gpt-5"),
        PanelEngine(id: "openrouter", name: "OpenRouter", keyName: "OpenRouter", host: "openrouter.ai",
                    models: [PanelModel(id: "openrouter/auto", name: "Auto (OpenRouter picks)", images: false)], defaultModel: "openrouter/auto"),
    ]
    /// (the Simulator, where no model can run: the stand-in too, to try the chat end to end)
    static var standIn: [PanelModel] {
        #if targetEnvironment(simulator)
        return [PanelModel(id: "stand-in", name: "Stand-in", description: "No model runs in the Simulator: a canned reply, to try the chat end to end.", images: false)]
        #else
        return []
        #endif
    }
    private static func order(_ id: String) -> Int { ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"].firstIndex(of: id) ?? 9 }
    static func named(_ id: String?) -> PanelEngine? { all.first { $0.id == id } }

    /// (development) `-apibase http://localhost:<port>`: every engine at a local mock (a loopback address only).
    static let mockBase: URL? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-apibase"), i + 1 < args.count, let u = URL(string: args[i + 1]),
              ["localhost", "127.0.0.1", "::1"].contains(u.host ?? "") else { return nil }
        return u
    }()
    /// Where its API is: always https on its own host (or the mock).
    func url(_ path: String) -> URL {
        if let m = PanelEngine.mockBase { return m.appendingPathComponent(id).appendingPathComponent(path) }
        return URL(string: "https://\(host ?? "")\(path)")!
    }

    @MainActor func conversation(model: String) -> PanelConversation {
        switch id {
        case "claude-api": return AnthropicConversation(engine: self)
        case "openai-api": return ResponsesConversation(engine: self)
        case "openrouter": return ChatCompletionsConversation(engine: self)
        default: return model == "stand-in" ? StandInConversation() : LocalConversation(model: LocalModels.named(model) ?? LocalModels.suggested)
        }
    }
}

// MARK: streaming

enum SSE {
    /// Something came back (the answer, each line of its stream): PanelChat's silence watch, for the run's task.
    @TaskLocal static var heard: (@Sendable () -> Void)?
    /// POSTs `body` and hands each `data:` line's JSON to `onEvent` until the stream ends. An error answer is thrown with
    /// the service's own message (never the request, which has the key).
    static func post(_ url: URL, headers: [String: String], body: [String: Any], onEvent: ([String: Any]) throws -> Void) async throws {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 600
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (bytes, response) = try await URLSession.shared.bytes(for: req)
        guard let http = response as? HTTPURLResponse else { throw PanelError.message("no answer from the service") }
        heard?()
        if http.statusCode != 200 {
            var data = Data()
            for try await b in bytes { data.append(b); if data.count > 20_000 { break } }
            throw PanelError.http(http.statusCode, errorMessage(data))
        }
        for try await line in bytes.lines {
            try Task.checkCancellation()
            heard?()
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" { break }
            guard let obj = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { continue }
            try onEvent(obj)
        }
    }
    static func errorMessage(_ data: Data) -> String {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return String(decoding: data.prefix(300), as: UTF8.self) }
        if let e = obj["error"] as? [String: Any] { return e["message"] as? String ?? "" }
        return obj["message"] as? String ?? ""
    }
    static func parse(_ json: String) -> [String: Any]? {
        if json.trimmingCharacters(in: .whitespaces).isEmpty { return [:] }
        return (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
    }
    static func text(_ obj: Any) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return "{}" }
        return s
    }
}

// MARK: Claude API (Anthropic's Messages API)

@MainActor
final class AnthropicConversation: PanelConversation {
    let engine: PanelEngine
    private var messages: [[String: Any]] = []
    init(engine: PanelEngine) { self.engine = engine }
    var takesImages: Bool { true }
    var usesTools: Bool { true }

    func addUser(_ text: String, image: Data?) {
        var content: [[String: Any]] = []
        if let image { content.append(["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": image.base64EncodedString()]]) }
        content.append(["type": "text", "text": text])
        messages.append(["role": "user", "content": content])
    }

    func step(system: String, tools: [PanelTool], model: String, effort: String?) async throws -> PanelStep {
        guard let key = APIKeys.get(engine.id) else { throw PanelError.message("no Anthropic API key yet") }
        var body: [String: Any] = [
            "model": model, "max_tokens": 64000, "stream": true,
            "system": system, "messages": messages,
            // (the whole prompt cached between the loop's steps: the same prefix each time)
            "cache_control": ["type": "ephemeral"],
        ]
        if !tools.isEmpty { body["tools"] = tools.map { ["name": $0.name, "description": $0.description, "input_schema": $0.schema, "eager_input_streaming": true] } }
        if let effort { body["output_config"] = ["effort": effort] }
        var headers = ["x-api-key": key, "anthropic-version": "2026-10-21"]
        // (a request a model's safety check declines is run again on another, by Anthropic, inside the same call)
        if ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"].contains(model) {
            headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
            body["fallbacks"] = "default"
        }
        var blocks: [Int: [String: Any]] = [:]
        var partial: [Int: String] = [:]
        var out = PanelStep()
        var failure: String?
        try await SSE.post(engine.url("/v1/messages"), headers: headers, body: body) { ev in
            switch ev["type"] as? String {
            case "message_start":
                out.inputTokens = ((ev["message"] as? [String: Any])?["usage"] as? [String: Any])?["input_tokens"] as? Int ?? 0
            case "content_block_start":
                guard let i = ev["index"] as? Int, var b = ev["content_block"] as? [String: Any] else { return }
                if b["type"] as? String == "tool_use" { b["input"] = [String: Any]() }
                blocks[i] = b
            case "content_block_delta":
                guard let i = ev["index"] as? Int, let d = ev["delta"] as? [String: Any], var b = blocks[i] else { return }
                switch d["type"] as? String {
                case "text_delta": b["text"] = (b["text"] as? String ?? "") + (d["text"] as? String ?? "")
                case "input_json_delta": partial[i, default: ""] += d["partial_json"] as? String ?? ""
                case "thinking_delta": b["thinking"] = (b["thinking"] as? String ?? "") + (d["thinking"] as? String ?? "")
                case "signature_delta": b["signature"] = d["signature"] as? String ?? ""
                default: break
                }
                blocks[i] = b
            case "message_delta":
                if let r = (ev["delta"] as? [String: Any])?["stop_reason"] as? String { out.stop = r }
            case "error":
                failure = (ev["error"] as? [String: Any])?["message"] as? String ?? "the stream stopped with an error"
            default: break
            }
        }
        if let failure { throw PanelError.message(failure) }
        var content: [[String: Any]] = []
        for i in blocks.keys.sorted() {
            var b = blocks[i]!
            if b["type"] as? String == "tool_use" {
                let input = SSE.parse(partial[i] ?? "")
                b["input"] = input ?? [String: Any]()
                out.calls.append(PanelToolCall(id: b["id"] as? String ?? "", name: b["name"] as? String ?? "", input: input))
            }
            if b["type"] as? String == "text" { out.text += b["text"] as? String ?? "" }
            content.append(b)
        }
        if !content.isEmpty { messages.append(["role": "assistant", "content": content]) }
        if out.stop == "refusal" { throw PanelError.message("the model declined this request") }
        // (cut off: its tool calls may be cut short too, so none of them run)
        if out.stop == "max_tokens" { out.calls = [] }
        return out
    }

    func addResults(_ results: [PanelToolResult]) {
        let content: [[String: Any]] = results.map { r in
            var parts: [[String: Any]] = [["type": "text", "text": r.text]]
            if let img = r.image { parts.append(["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": img.base64EncodedString()]]) }
            return ["type": "tool_result", "tool_use_id": r.call.id, "content": parts, "is_error": r.error]
        }
        messages.append(["role": "user", "content": content])
    }
}

// MARK: OpenAI API (the Responses API)

@MainActor
final class ResponsesConversation: PanelConversation {
    let engine: PanelEngine
    private var input: [[String: Any]] = []
    init(engine: PanelEngine) { self.engine = engine }
    var takesImages: Bool { true }
    var usesTools: Bool { true }

    func addUser(_ text: String, image: Data?) {
        var content: [[String: Any]] = [["type": "input_text", "text": text]]
        if let image { content.append(["type": "input_image", "image_url": "data:image/jpeg;base64,\(image.base64EncodedString())"]) }
        input.append(["role": "user", "content": content])
    }

    func step(system: String, tools: [PanelTool], model: String, effort: String?) async throws -> PanelStep {
        guard let key = APIKeys.get(engine.id) else { throw PanelError.message("no OpenAI API key yet") }
        var body: [String: Any] = ["model": model, "instructions": system, "input": input, "stream": true, "store": false,
                                   "include": ["reasoning.encrypted_content"]]
        if !tools.isEmpty { body["tools"] = tools.map { ["type": "function", "name": $0.name, "description": $0.description, "parameters": $0.schema] } }
        if let effort { body["reasoning"] = ["effort": effort] }
        var out = PanelStep()
        var items: [[String: Any]] = []
        var failure: String?
        try await SSE.post(engine.url("/v1/responses"), headers: ["Authorization": "Bearer \(key)"], body: body) { ev in
            switch ev["type"] as? String {
            case "response.output_item.done":
                guard let item = ev["item"] as? [String: Any] else { return }
                items.append(item)
                switch item["type"] as? String {
                case "message":
                    for c in item["content"] as? [[String: Any]] ?? [] where c["type"] as? String == "output_text" { out.text += c["text"] as? String ?? "" }
                case "function_call":
                    out.calls.append(PanelToolCall(id: item["call_id"] as? String ?? "", name: item["name"] as? String ?? "", input: SSE.parse(item["arguments"] as? String ?? "")))
                default: break
                }
            case "response.completed":
                out.inputTokens = (((ev["response"] as? [String: Any])?["usage"]) as? [String: Any])?["input_tokens"] as? Int ?? 0
            case "response.incomplete":
                out.stop = "length"
            case "response.failed":
                failure = (((ev["response"] as? [String: Any])?["error"]) as? [String: Any])?["message"] as? String ?? "the response failed"
            case "error":
                failure = ev["message"] as? String ?? (ev["error"] as? [String: Any])?["message"] as? String ?? "the stream stopped with an error"
            default: break
            }
        }
        if let failure { throw PanelError.message(failure) }
        input += items
        if out.stop == "length" { out.calls = [] } else if !out.calls.isEmpty { out.stop = "tools" }
        return out
    }

    func addResults(_ results: [PanelToolResult]) {
        for r in results { input.append(["type": "function_call_output", "call_id": r.call.id, "output": r.text]) }
        // (a picture can't go in a function's output: it follows, as the person's, saying which tool it's from)
        for r in results { if let img = r.image { addUser("(The screenshot from \(r.call.name), as asked.)", image: img) } }
    }
}

// MARK: OpenRouter (OpenAI-compatible chat completions)

@MainActor
final class ChatCompletionsConversation: PanelConversation {
    let engine: PanelEngine
    private var messages: [[String: Any]] = []
    /// Whether the chosen model takes pictures (from OpenRouter's list; unknown: no).
    var images = false
    init(engine: PanelEngine) { self.engine = engine }
    var takesImages: Bool { images }
    var usesTools: Bool { true }

    func addUser(_ text: String, image: Data?) {
        var content: [[String: Any]] = [["type": "text", "text": text]]
        if let image, images { content.append(["type": "image_url", "image_url": ["url": "data:image/jpeg;base64,\(image.base64EncodedString())"]]) }
        messages.append(["role": "user", "content": content])
    }

    func step(system: String, tools: [PanelTool], model: String, effort: String?) async throws -> PanelStep {
        guard let key = APIKeys.get(engine.id) else { throw PanelError.message("no OpenRouter API key yet") }
        var body: [String: Any] = ["model": model, "messages": [["role": "system", "content": system]] + messages, "stream": true]
        if !tools.isEmpty {
            body["tools"] = tools.map { ["type": "function", "function": ["name": $0.name, "description": $0.description, "parameters": $0.schema]] }
            // (only providers that take every parameter sent: never one that would drop the tools)
            body["provider"] = ["require_parameters": true]
        }
        var out = PanelStep()
        var calls: [Int: (id: String, name: String, args: String)] = [:]
        var failure: String?
        try await SSE.post(engine.url("/api/v1/chat/completions"), headers: ["Authorization": "Bearer \(key)", "X-Title": "TRIF"], body: body) { ev in
            if let e = ev["error"] as? [String: Any] { failure = e["message"] as? String ?? "the stream stopped with an error"; return }
            guard let choice = (ev["choices"] as? [[String: Any]])?.first else { return }
            if let d = choice["delta"] as? [String: Any] {
                if let t = d["content"] as? String { out.text += t }
                for tc in d["tool_calls"] as? [[String: Any]] ?? [] {
                    let i = tc["index"] as? Int ?? 0
                    var c = calls[i] ?? ("", "", "")
                    if let id = tc["id"] as? String { c.id = id }
                    if let f = tc["function"] as? [String: Any] {
                        if let n = f["name"] as? String { c.name += n }
                        if let a = f["arguments"] as? String { c.args += a }
                    }
                    calls[i] = c
                }
            }
            if let r = choice["finish_reason"] as? String { out.stop = r == "tool_calls" ? "tools" : r == "length" ? "length" : "done" }
            if let u = ev["usage"] as? [String: Any] { out.inputTokens = u["prompt_tokens"] as? Int ?? out.inputTokens }
        }
        if let failure { throw PanelError.message(failure) }
        let list = calls.keys.sorted().map { calls[$0]! }
        var msg: [String: Any] = ["role": "assistant", "content": out.text.isEmpty ? NSNull() : out.text]
        if !list.isEmpty { msg["tool_calls"] = list.map { ["id": $0.id, "type": "function", "function": ["name": $0.name, "arguments": $0.args]] } }
        messages.append(msg)
        if out.stop != "length" { out.calls = list.map { PanelToolCall(id: $0.id, name: $0.name, input: SSE.parse($0.args)) } }
        return out
    }

    func addResults(_ results: [PanelToolResult]) {
        for r in results { messages.append(["role": "tool", "tool_call_id": r.call.id, "content": r.text]) }
        for r in results { if let img = r.image, images { addUser("(The screenshot from \(r.call.name), as asked.)", image: img) } }
    }
}

// MARK: the stand-in (the Simulator only: no model can run there)

/// A canned reply, with a small style mod for the page, so the whole chat can be tried in the Simulator, Add this mod?
/// included. (On a phone, On this iPhone is LocalModels.swift's LocalConversation.)
@MainActor
final class StandInConversation: PanelConversation {
    var takesImages: Bool { false }
    var usesTools: Bool { false }
    private var page = ""
    private var asked = ""
    func addUser(_ text: String, image: Data?) {
        // (a match pattern has no port: the origin without one, as the chat stand-in's)
        if let m = text.range(of: "https?://[^\\s/]+", options: .regularExpression) { page = String(text[m]).replacingOccurrences(of: ":[0-9]+$", with: "", options: .regularExpression) }
        // (the request's last line, in the mod's CSS as a comment: each ask's mod is code of its own)
        asked = String((text.split(separator: "\n").last ?? "").filter { $0.isLetter || $0.isNumber || $0 == " " }.prefix(40))
    }
    func step(system: String, tools: [PanelTool], model: String, effort: String?) async throws -> PanelStep {
        try await Task.sleep(nanoseconds: 700_000_000)
        let origin = page.isEmpty ? "https://example.com" : page
        let text = """
        This is a stand-in: no model runs in the Simulator. On an iPhone, the model on it answers here, with the page in hand.

        Meanwhile, here's a small style mod for this site, to try Add this mod?: it underlines the links.

        ```js
        // ==WebMod==
        // @name        Underlined links
        // @description Underlines every link (from the stand-in on this iPhone)
        // @match       \(origin)/*
        // @style
        // ==/WebMod==
        {
          "css": "a { text-decoration: underline !important }\(asked.isEmpty ? "" : " /* \(asked) */")"
        }
        ```
        """
        return PanelStep(text: text, calls: [], stop: "done", inputTokens: 0)
    }
    func addResults(_ results: [PanelToolResult]) {}
}
