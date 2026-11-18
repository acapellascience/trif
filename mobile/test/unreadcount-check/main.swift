// The unread-count rule (UnreadTitle.swift) on the Mac, for unreadcount.test.js: one title a line on stdin (as JSON
// strings, so any character goes through), one answer a line out: JSON {count, plus, title} or null.
import Foundation

while let line = readLine() {
    guard let d = line.data(using: .utf8), let title = try? JSONSerialization.jsonObject(with: d, options: .fragmentsAllowed) as? String else { print("bad"); continue }
    if let c = UnreadTitle.read(title) {
        let o: [String: Any] = ["count": c.count, "plus": c.plus, "title": c.title, "text": c.text]
        print(String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)!)
    } else { print("null") }
}
