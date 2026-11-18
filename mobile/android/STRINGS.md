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
| No WebView with script worlds (older than 149): the screen instead of the browser | TRIF needs a newer Android System WebView · This phone's WebView is version {n}. TRIF needs version 149 or newer to run mods. Update it in the Play Store, then open TRIF again. (version unreadable: TRIF needs WebView version 149 or newer to run mods. Update it in the Play Store, then open TRIF again.) · Open the Play Store | **New** (draft; iPhone has no such screen) |
| No WebView at all (switched off or missing) | TRIF needs Android System WebView · It's switched off or not installed on this phone. Turn it on in Settings, under Apps, or install it from the Play Store, then open TRIF again. · Open the Play Store | **New** (draft) |
| Open the Play Store, with no Play Store on the phone (a toast) | No app on this phone can open this link. | reuses the app-link toast above |
| Toolbar: the Mods button (its text for now; the robot icon is UI layer) and its accessibility label | Mods | iPhone (toolbar's label) |
| The Mods tab's title | Mods on {site} (Mods when no site) | iPhone |
| The Mods tab's buttons | ⋯ (More) · Done | iPhone |
| The Mods tab's ⋯ menu | Pause all mods · Resume mods | iPhone (Send diagnostics… comes with diagnostics; Import mod… and Export with item 6) |
| The Mods tab's page itself (rows, tiers, cards, Recently deleted…) | the iPhone app's own page (mods.html / mods-page.js), its words as they are | iPhone. One says "iPhone": "Can't run here on iPhone: this page didn't let it start." (a free mod a page refuses): see For Tim in PROGRESS.md |
| After a mod file is opened with / shared to TRIF (a toast for now; iPhone's status strip is UI layer) | Imported 1 mod: {name}. Like any mod from outside, it starts off, and waits for your OK if its code can do more than change the page. (Imported {n} mods: … they start off, and each waits … its own …) · Couldn't import {file}: {why} · Nothing to import there. · Nothing TRIF can import there: {files}. | iPhone (importFiles) |
| "Add this mod?" for text shared to TRIF with a whole mod in it (a plain dialog for now; its look is UI layer) | Add this mod? · {name} · Style mod / Boxed mod / Free mod · {description} · It runs on another site / other sites / every site + its line · Runs on · Asks for these powers · TRIF found that this mod: (boxed: It asks for these powers. TRIF holds it to them:, It {finding}.) · Together, it {warning}. · the free-mod warning · Add it · Cancel · Its code | iPhone (ModOfferView) |
| After Add it (a toast for now) | Added {name}. It runs on {sites}. · {name} waits for your OK. · That mod can't be added: {why}. | iPhone (addMod, offer(text:)) |
