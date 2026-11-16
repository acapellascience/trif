# Mods feed strings (0.3.1): awaiting Tim

**Awaiting Tim's OK.** New text people see for the mods feed (new versions of Tim's mods between TRIF
releases, helper/lib/modsfeed.js). Nothing here is on main yet; it's on the `mods-feed` branch.
Text only agents read (`trif update`, `trif doctor`, the helper log) isn't listed: it's Claude's call.

## A. Settings, under the update status

A quiet line (`#mods-feed-note`, the same grey note style as the update status above it), shown only when
the last check for new versions of Tim's mods went wrong, and TRIF's own update check didn't (that one's
line already says the check failed). No pop-up. It goes once a check works, and with "checkForUpdates":
false.

| Where | Words | OK? |
|---|---|---|
| The line | Couldn’t get updates to Tim’s mods: {reason} | |

`{reason}` is one of these (TRIF's update line shows its own reasons the same way, "Couldn’t check for
updates: {reason}"):

| When | Reason | OK? |
|---|---|---|
| Not signed by TRIF's release key | the mods feed is not signed by the TRIF release key; ignoring it | |
| No signature file | the mods feed has no signature ({what the download said}); ignoring it | |
| A build without a release key (developer builds) | this build has no release key, so it can't verify the mods feed | |
| Not JSON | the mods feed isn't valid JSON: {parser's message} | |
| Something else (latest.json) served as it | the mods feed isn't one (no "kind": "trif-mods"); ignoring it | |
| No commit in it | the mods feed has no valid commit | |
| No date | the mods feed has no date, so it may be an old copy that hides a newer version; not using it | |
| Too old | the mods feed is from {2026-09-01}, more than 8 weeks ago, so it may be an old copy that hides a newer version; not using it | |
| Can't be fetched (update.js's, as TRIF's update line shows them today) | couldn't fetch {url}: {error} · timed out fetching {url} · {url} answered HTTP {code} · {url} is larger than {n} bytes | (shipped) |
| A mod's file isn't the signed one | {x.com/detox-timeline} version {5}: {why}; not using it | |

`{why}` for a mod's file: "the download is {n} bytes, not the {m} the feed says" · "the download's checksum
doesn't match the signed feed" · "it isn't marked as a mod TRIF ships (@source webmods)" · "its @version is
{x}, not the feed's {y}".

Question for Tim: "mods feed" is our word. The line could instead say only "Couldn’t get updates to Tim’s
mods: it isn't signed by TRIF" etc., if you'd rather users never see "feed". The reasons above mirror the
TRIF update line's ("the update feed is not signed by the TRIF release key; ignoring it"), which ships.

## B. What's new (CHANGELOG.md, "## 0.3.1")

| Where | Words | OK? |
|---|---|---|
| The summary's one point | **Tim's mods get fixes between TRIF releases**, signed like TRIF's own updates. One you changed is never replaced: you're offered the new version. | |

## C. README, "Updates" (a new paragraph)

| Where | Words | OK? |
|---|---|---|
| README.md, after "Updates are signed: …" | Tim's mods can also get fixes between TRIF releases, checked along with TRIF's updates and signed the same way. With **Install updates automatically** on, a mod you haven't changed gets the new version (marked "updated", switched off until you turn it on); otherwise its row offers **Use the new version**. A mod you changed is never replaced, and a new version that can do more than the one TRIF shipped waits for your OK. If the check fails, Settings says why under the update status. `"checkForUpdates": false` in config.json stops both checks. | |

## Not new (reused as they are)

A version from the feed shows up exactly like one from a release: an unchanged copy replaced (with
"Install updates automatically" on) gets the "updated" mark and starts off once; otherwise the row offers
"TRIF has a new version of this mod (version N)." with **Use the new version** / **Keep mine** (and, for a
copy you changed, "You've changed yours, so it wasn't replaced." and **Merge with my agent**). One that can
do more than the released version waits for your OK, with the usual approval card.
