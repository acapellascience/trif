# "Chats on other sites can read this site's mods": the words people see (drafts for Tim)

What it is: each side-panel chat can read every other site's mods (never change them), so the agent knows what
its change will meet. Per site, you can keep a site's mods out of other sites' chats. On by default; off by
default for a sensitive site (email, banking, passwords...). How it works: docs/STAGING.md "Other sites' mods".

| Where | Draft | Notes |
|---|---|---|
| The ⋯ menu over a site's mods (sidepanel.html `#mods-readable`), a ticked item | Chats on other sites can read this site's mods | A tick when on. Shown for every site with a name (not on a local address). |
| Settings, title (`.sites-title`, before "Sensitive sites") | Mods other chats can read | |
| Settings, one row per site, a checkbox | `<site>` | Rows: the sensitive sites that have mods, and every site you chose for. |
| Settings, note under the rows | Ticked: chats on other sites can read that site's mods (never change them). Sensitive sites start unticked. Every site has this in the ⋯ menu over its mods. | |
| A note in this site's chat after turning it off while a chat is working | A chat that's working now can still read `<site>`'s mods until it's done. The next one can't. | Only while a chat is working. |
| The same after turning it on | A chat that's working now still can't read `<site>`'s mods. The next one can. | |
| A note in the chat when the change failed | Couldn't change it: `<error>` | |

Words only agents see (not drafts: my call, per the wording rule): the helper refuses a run's write into a
hidden site's folder with the same "another site's folder" line as any other site's; `trif restore` and `trif
history` in a run say nothing of a hidden site (an empty list).
