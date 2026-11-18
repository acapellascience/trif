// mobile/test/openroutermodels.test.js: OpenRouterModels.swift on the Mac. argv: a list's JSON file, today
// ("yyyy-MM-dd"), the ids used (comma-separated). Prints one JSON object: what's fit, why the rest aren't, the
// picker's parts and each one's line.
import Foundation

let args = CommandLine.arguments
let data = try! Data(contentsOf: URL(fileURLWithPath: args[1]))
let rows = ((try! JSONSerialization.jsonObject(with: data)) as! [String: Any])["data"] as! [[String: Any]]
let today = args[2]
let used = args.count > 3 ? args[3].split(separator: ",").map(String.init) : []
let models = OpenRouterModels.read(rows, today: today)
var unfit: [String: String] = [:]
for r in rows { if let why = OpenRouterModels.unfit(r, today: today) { unfit[r["id"] as? String ?? "?"] = why } }
let picks = OpenRouterModels.picks(models)
let out: [String: Any] = [
    "fit": models.map(\.id),
    "unfit": unfit,
    "recommended": picks,
    "recent": OpenRouterModels.recent(used, models: models, shown: picks + [OpenRouterModels.auto]),
    "groups": OpenRouterModels.groups(models).map { ["maker": $0.maker, "ids": $0.ids] },
    "lines": Dictionary(uniqueKeysWithValues: models.map { ($0.id, OpenRouterModels.line($0)) }),
    "names": Dictionary(uniqueKeysWithValues: models.map { ($0.id, $0.name) }),
    "free": models.filter(\.free).map(\.id),
]
print(String(data: try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
