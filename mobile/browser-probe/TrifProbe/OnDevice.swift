// The model that comes with the phone (Apple's Foundation Models, iOS 26 on devices with Apple
// Intelligence): free, private, and small. The probe asks it one kind of question, "which thing on this
// page is the one I mean", to see how long it takes and how often the answer is usable.

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum OnDevice {
    static func availability() -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return "available"
            case .unavailable(let reason):
                return "unavailable: \(reason)"
            @unknown default:
                return "unavailable"
            }
        }
        return "needs iOS 26"
        #else
        return "this Xcode has no FoundationModels (needs Xcode 26)"
        #endif
    }

    static var isAvailable: Bool { availability() == "available" }

    static let instructions = """
    You help someone hide a part of a web page. You are given an outline of the page: one line per part, \
    each starting with the part's name (such as #promo-banner or div[role="dialog"]), then its size, then its \
    first words. Reply with the name of the one part that best matches what the person wants gone, copied \
    exactly from the start of its line. Reply with the name only: no explanation, no quotes around it.
    """

    /// The model's reply to one question about one outline: (reply, error, how long it took).
    static func ask(_ question: String, outline: String) async -> (text: String?, error: String?, ms: Int) {
        let started = Date()
        let took = { Int(Date().timeIntervalSince(started) * 1000) }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard isAvailable else { return (nil, availability(), took()) }
            do {
                let session = LanguageModelSession(instructions: instructions)
                let response = try await session.respond(to: "The page:\n\(outline)\n\nWhat the person wants gone: \(question)")
                return (response.content.trimmingCharacters(in: .whitespacesAndNewlines), nil, took())
            } catch {
                return (nil, String(describing: error), took())
            }
        }
        #endif
        return (nil, availability(), took())
    }
}
