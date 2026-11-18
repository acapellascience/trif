# TRIF for Android: words people see

Every word the Android app shows. Where the iPhone app has the same thing, its approved wording
(docs/IOS-APP-STRINGS.md) is reused as is. **New** rows are drafts for Tim. The words live in
app/src/main/res/values/strings.xml.

| Where | Words | Source |
|---|---|---|
| The app's name (launcher, recents) | TRIF | **New** (draft; the iPhone build is still "TRIF Probe") |
| The address bar, empty | Search or type URL | iPhone (address screen's placeholder, 11-15) |
| A new tab's page, nothing visited yet | Type an address or a search above. | iPhone |
| Toolbar, accessibility labels | Back · Forward · New Tab · Tabs, {n} open | iPhone (the toolbar's labels; the toolbar's look is held, UI layer) |
| The tab list's title | 1 tab · {n} tabs | iPhone (tab switcher's title) |
| The tab list, a tab with no page | New tab | iPhone |
| The tab list, × (accessibility) | Close {tab's title} | iPhone |
| A page (or a mod) opening another app by itself: the question | Open this page in another app? · Cancel · Open | iPhone (its generic form: Android can't name the app for certain, so never "in “{App}”") |
| A link to another app that no app on the phone takes (a toast) | No app on this phone can open this link. | **New** (draft; iPhone's says "this iPhone") |
