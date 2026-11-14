// TRIF Probe (browser): a test app that asks what a TRIF made as its own iPhone browser could do.
// Not TRIF. See mobile/README.md for what each part is for and what to send back.

import SwiftUI
import UIKit

@main
struct TrifProbeApp: App {
    @StateObject private var model = Model()

    var body: some Scene {
        WindowGroup {
            ContentView(pane: model.pane)
                .environmentObject(model.browser)
                .environmentObject(model.report)
                .tint(Color.trifGreen) // (every button and control TRIF's green, not iOS's blue: Tim, 11-14)
        }
    }
}

/// The app's three long-lived parts, made once, in order.
@MainActor
final class Model: ObservableObject {
    let report: Report
    let browser: Browser
    let pane: ClaudePane

    init() {
        let report = Report()
        let browser = Browser(report: report)
        self.report = report
        self.browser = browser
        self.pane = ClaudePane(report: report, browser: browser)
        // (a mod added: what it did, into the chat's message box: Browser.reportToChat)
        let pane = self.pane
        browser.chatFill = { text, png, pdf in await pane.fill(text, png: png, pdf: pdf, as: "TRIF follow-up.txt") }
        browser.chatPoint = { text, png in await pane.fill(text, png: png, picture: "TRIF pointer.png", as: "TRIF pointer.txt") }
        // For the Simulator and CI: `-autorun plain,strict,…` (the probe's own pages, or full addresses) runs the
        // checks on each page in turn, as the Checks sheet's button does, and saves them in the report.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-autorun"), i + 1 < args.count {
            let pages = args[i + 1].split(separator: ",").map(String.init)
            Task { @MainActor in
                for page in pages {
                    browser.go(page.contains(":") ? page : PageSchemeHandler.home + (page.hasSuffix(".html") ? page : page + ".html"))
                    await browser.waitForLoad()
                    browser.running = true
                    report.add(await Checks(browser: browser).runAll())
                    browser.running = false
                }
                report.log("autorun", "done: \(pages.joined(separator: ","))")
            }
        }
        // (development) `-dumpchat`: the chat's message box and what's around it, ten seconds after start, to
        // Documents/chat-dom.html (ClaudePane.dumpComposer).
        if args.contains("-dumpchat") {
            let pane = self.pane
            Task { @MainActor in try? await Task.sleep(nanoseconds: 1_000_000_000); browser.wantsChat = true; try? await Task.sleep(nanoseconds: 10_000_000_000); await pane.dumpComposer(); report.log("dumpchat", "done") }
        }
        // (development) `-shottest addr,addr`: each page's settled screenshot and whole-page PDF, as a mod's
        // follow-up would send them, saved to Documents (shot-N.png, page-N.pdf) instead of the chat.
        if let i = args.firstIndex(of: "-shottest"), i + 1 < args.count {
            let pages = args[i + 1].split(separator: ",").map(String.init)
            Task { @MainActor in
                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                for (n, page) in pages.enumerated() {
                    browser.go(page)
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    let (png, blank) = await browser.settledScreenshot()
                    let pdf = await browser.fullPage()
                    try? png?.write(to: docs.appendingPathComponent("shot-\(n).png"))
                    try? pdf?.write(to: docs.appendingPathComponent("page-\(n).pdf"))
                    report.log("shottest", "\(page): blank \(blank), png \((png?.count ?? 0) / 1000) kB, pdf \((pdf?.count ?? 0) / 1000) kB")
                }
                report.log("shottest", "done")
            }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var browser: Browser
    @EnvironmentObject var report: Report
    let pane: ClaudePane

    @State private var entry = ""
    @State private var showChecks = false
    @State private var showReport = false
    @State private var showClaude = false
    /// The chat pane's height, dragged by the grip on its top edge (Tim, 11-14); kept. 0: half the screen.
    @AppStorage("paneHeight") private var paneHeight: Double = 0
    @GestureState private var paneDrag: CGFloat = 0
    @State private var showMods = false
    @State private var asking = false
    @State private var question = ""
    @FocusState private var editing: Bool

    /// The pane's height now: what was dragged, plus the drag going on, kept to between 200 points and all but
    /// 160 of the screen.
    private var paneNow: CGFloat {
        let screen = UIScreen.main.bounds.height
        let base = paneHeight > 0 ? CGFloat(paneHeight) : screen * 0.5
        return min(max(base - paneDrag, 200), screen - 160)
    }

    /// The grip on the pane's top edge: drag up for a taller chat, down for more page.
    private var paneGrip: some View {
        ZStack {
            Rectangle().fill(Color(.systemBackground)).frame(height: 14)
            Capsule().fill(Color.secondary.opacity(0.5)).frame(width: 36, height: 5)
        }
        .overlay(alignment: .top) { Divider() }
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 2, coordinateSpace: .global)
            .updating($paneDrag) { v, s, _ in s = v.translation.height }
            .onEnded { v in
                let screen = UIScreen.main.bounds.height
                let base = paneHeight > 0 ? CGFloat(paneHeight) : screen * 0.5
                paneHeight = Double(min(max(base - v.translation.height, 200), screen - 160))
            })
        .accessibilityLabel("Chat height")
    }

    var body: some View {
        VStack(spacing: 0) {
            addressBar
            WebViewHost(webView: browser.webView)
            if let picked = browser.picked { PickedBar(picked: picked) }
            if showClaude {
                paneGrip
                ClaudePaneView(pane: pane, addPasted: { browser.offer(text: $0) }, sendPage: {
                    showClaude = true
                    // (with a screenshot of what's on the screen: Tim, 11-14)
                    Task { if let t = await browser.pageForChat() { let shot = await browser.settledScreenshot().png; await pane.fill(t, png: shot, as: "TRIF instruction.txt") } }
                }).frame(height: paneNow)
            }
            if let h = browser.lastHide {
                HStack {
                    Text("Hidden: \(h.selector)").font(.footnote.monospaced()).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("Undo") { Task { await browser.unhide(h) } }.font(.footnote.bold())
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color(.secondarySystemBackground))
            }
            if !browser.status.isEmpty {
                Text(browser.status)
                    .font(.footnote)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(.secondarySystemBackground))
            }
            Divider()
            toolbar
        }
        .onChange(of: browser.address) { _, new in if !editing { entry = new } }
        .onChange(of: browser.wantsChat) { _, want in if want { showClaude = true; browser.wantsChat = false } }
        .sheet(isPresented: $showChecks) { ChecksView().environmentObject(browser).environmentObject(report) }
        .sheet(isPresented: $showReport) { ReportView().environmentObject(report) }
        .sheet(item: $browser.modLink) { link in ModLinkView(link: link).environmentObject(browser) }
        .sheet(item: $browser.modOffer) { mod in ModOfferView(mod: mod).environmentObject(browser) }
        .sheet(isPresented: $showMods) { ModsListView(store: browser.mods, report: report).environmentObject(browser) }
        .alert("What bothers you on this page?", isPresented: $asking) {
            TextField("the cookie notice", text: $question)
            Button("Ask the phone") { let q = question; Task { await browser.askPhone(q) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The phone's own model gets the page's outline and your words, and picks a part. Nothing leaves the phone.")
        }
    }

    private var addressBar: some View {
        HStack(spacing: 8) {
            TextField("Address", text: $entry)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($editing)
                .onSubmit { browser.go(entry) }
            if browser.loading { ProgressView() }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private var toolbar: some View {
        HStack {
            Button { browser.back() } label: { Image(systemName: "chevron.left") }.disabled(!browser.canGoBack)
            Spacer()
            Button { browser.reload() } label: { Image(systemName: "arrow.clockwise") }
            Spacer()
            Menu {
                Section("The probe's own pages") {
                    ForEach(browser.pages.pageNames, id: \.self) { name in
                        Button(name) { browser.go(PageSchemeHandler.home + name) }
                    }
                    Button("a mod link") { browser.go(PageSchemeHandler.home + "trif-install#hide=.cookie-consent") }
                }
                Section("Real sites") {
                    ForEach(["github.com", "x.com", "youtube.com", "reddit.com", "en.wikipedia.org", "nytimes.com"], id: \.self) { site in
                        Button(site) { browser.go(site) }
                    }
                }
            } label: { Image(systemName: "list.bullet") }
            Spacer()
            Button { showChecks = true } label: { Image(systemName: "checklist") }
            Spacer()
            Menu {
                Button("Copy this page for the chat") { Task { await browser.copyOutline() } }
                Button("Add a mod from the clipboard") { browser.offerFromClipboard() }
                Button("Your mods") { showMods = true }
                Button("Ask the phone's own model…") { question = ""; asking = true }
                Button("Show everything hidden on this site again", role: .destructive) { Task { await browser.forgetRulesHere() } }
            } label: { Image(systemName: "wand.and.stars") }
            Spacer()
            Button { showClaude.toggle() } label: { Image(systemName: showClaude ? "bubble.left.fill" : "bubble.left") }
            Spacer()
            Button { showReport = true } label: { Image(systemName: "square.and.arrow.up") }
        }
        .font(.title3)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }
}

/// What a long press chose, and what to do with it.
struct PickedBar: View {
    @EnvironmentObject var browser: Browser
    let picked: Picked

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(picked.text.isEmpty ? "<\(picked.tag)>" : "“\(picked.text)”").font(.subheadline).lineLimit(2)
            Text("\(picked.selector)  (named by \(picked.how)\(picked.matches == 1 ? "" : ", finds \(picked.matches)"))")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack {
                Button("Hide this") { Task { await browser.hide(picked.selector, how: picked.how, from: picked.from) } }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                if let similar = picked.similarSelector, picked.similarCount > 1 {
                    Button("All \(picked.similarCount) like it") { Task { await browser.hide(similar, how: picked.how, from: picked.from) } }
                        .buttonStyle(.bordered)
                }
                Button("Wider") { Task { await browser.widen() } }.buttonStyle(.bordered)
                Spacer()
                Button("Cancel") { Task { await browser.cancelPick() } }
            }
            .font(.subheadline)
            Button("Point TRIF at this") { Task { await browser.pointToChat() } }
                .buttonStyle(.bordered)
                .font(.subheadline)
            // (the element's own name, site-wide: outlined first, then hidden: Tim, 11-14)
            if let all = picked.everywhereSelector {
                Group {
                    if browser.previewing {
                        Button("Hide them") { Task { await browser.hide(all, how: "everywhere", from: picked.from) } }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                    } else {
                        Button("Everywhere on \(browser.host) (\(picked.everywhereCount) here)") { Task { await browser.previewEverywhere() } }
                            .buttonStyle(.bordered)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                .font(.subheadline)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
    }
}

/// A mod link the browser stopped: what it would do, before it does anything.
struct ModLinkView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.dismiss) private var dismiss
    let link: ModLink

    var body: some View {
        NavigationStack {
            List {
                Section("A mod, from \(link.source)") {
                    Text(link.address).font(.footnote.monospaced())
                }
                if link.hide.isEmpty {
                    Section { Text("This link carries nothing the probe knows how to add. (It reads #hide=selector.)") }
                } else {
                    Section("It would hide, on \(browser.host)") {
                        ForEach(link.hide, id: \.self) { selector in Text(selector).font(.footnote.monospaced()) }
                    }
                    Section {
                        Button("Show me first") {
                            let first = link.hide[0]
                            Task { _ = await browser.mark(selector: first, from: "a mod link") }
                            dismiss()
                        }
                        Button("Add it") {
                            let selectors = link.hide
                            Task { for s in selectors { await browser.hide(s, how: "given", from: "a mod link") } }
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle("Add this mod?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Don't") { dismiss() } } }
        }
    }
}

struct ResultRow: View {
    let result: CheckResult

    private var color: Color {
        switch result.answer {
        case "yes": return .green
        case "no", "error": return .red
        case "some": return .orange
        default: return .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(result.answer).bold().foregroundStyle(color).frame(width: 46, alignment: .leading)
                Text(result.title)
            }
            .font(.subheadline)
            Text(result.detail).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
        }
    }
}

struct RunView: View {
    let run: CheckRun

    var body: some View {
        let groups = Dictionary(grouping: run.results, by: { $0.group })
        let order = run.results.map { $0.group }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        ForEach(order, id: \.self) { group in
            Section(group) {
                ForEach(groups[group] ?? []) { result in ResultRow(result: result) }
            }
        }
    }
}

struct ChecksView: View {
    @EnvironmentObject var browser: Browser
    @EnvironmentObject var report: Report
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(browser.running ? "Running: about twenty seconds…" : "Run the checks on this page") {
                        Task {
                            browser.running = true
                            let run = await Checks(browser: browser).runAll()
                            report.add(run)
                            browser.running = false
                        }
                    }
                    .disabled(browser.running)
                    Text(browser.address).font(.footnote).foregroundStyle(.secondary)
                } footer: {
                    Text("The last two checks reload the page. Run them on each of the probe's own pages, then on a few real sites.")
                }
                if let last = report.runs.last {
                    Section { Text("Last run: \(last.url)").font(.footnote) }
                    RunView(run: last)
                }
            }
            .navigationTitle("Checks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct ReportView: View {
    @EnvironmentObject var report: Report
    @Environment(\.dismiss) private var dismiss

    private func count(_ kind: String) -> Int { report.events.filter { $0.kind == kind }.count }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ShareLink("Share the report", item: report.json())
                    Button("Copy the report") { UIPasteboard.general.string = report.json() }
                    Button("Clear everything recorded", role: .destructive) { report.clear() }
                } footer: {
                    Text("Everything the probe has recorded on this device. It names the sites you ran it on, and nothing from inside Claude's pane except which addresses it went to. Nothing is sent anywhere: share it yourself.")
                }
                Section("So far") {
                    Text("\(report.runs.count) run(s) of the checks")
                    Text("\(report.rules.count) thing(s) hidden")
                    Text("\(count("load")) page load(s) timed")
                    Text("\(count("mod link")) mod link(s) stopped")
                    Text("\(count("on-device")) question(s) to the phone's model")
                }
                Section("What happened, newest first") {
                    ForEach(Array(report.events.reversed().prefix(60))) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.kind).font(.caption).bold()
                            Text(event.text).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(6)
                        }
                    }
                }
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

extension Color {
    /// TRIF's green, as the panel has it (--led-green): the robot's own on dark, a darker one on light, so
    /// text in it stays readable.
    static let trifGreen = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x99 / 255, alpha: 1)
        : UIColor(red: 0x1f / 255, green: 0x8a / 255, blue: 0x5b / 255, alpha: 1) })
}
