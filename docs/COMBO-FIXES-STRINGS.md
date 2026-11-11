# The combination fixes: new and changed strings (branch combo-fixes)

**All awaiting review.** Every user-facing sentence the fixes to the power-combination checks add or change
(the review's findings F1 to F12): combination warnings the hold shows, a reason in
docs/POWER-COMBINATIONS.md, and the errors a boxed mod (and so the agent writing it) sees in `trif errors`.
Errors read "TRIF sandbox: …". `{…}` is a value filled in.

## Combination warnings, new (helper/lib/combinations.js)

The red box's lines, "Together, it …". Their ranks among all nineteen (the thirteen before keep their words;
their ranks moved to make room):

1. could put what it reads into a post and send it for you *(as before)*
2. could go to a page, write a post there and send it for you *(as before)*
3. could write a post and send it for you *(as before)*
4. could put what it reads into something you post *(as before)*
5. could put what it reads into a picture you post *(as before)*
6. could hand what it reads to this page's own code, which may post or send it *(as before)*
7. **could keep what it reads where this site's own code, and your other boxed mods, can find it later** (a read + site-storage, or @migrate: F1, F7)
8. could take you to a page and click things there for you *(as before)*
9. could take you to a page and set off that page's own actions there *(as before)*
10. **could click things for you and change what the site receives from those clicks** (rewrite-requests + click: F6)
11. **could set off this page's own actions and change what the site receives from them** (rewrite-requests + page-events: F6)
12. could let what it reads decide what it clicks for you *(as before)*
13. could keep your clicks from reaching the page and click in their place *(as before)*
14. **could keep your clicks from reaching the page and set off the page's own actions in their place** (block-events + page-events: F9)
15. **could let what it reads decide which of your actions this page sees, and the page's code may send that on** (a read + block-events: F5)
16. could pass what it reads to the site a video or sound comes from, by how it plays it *(as before)*
17. could pass what it reads to the sites this page's pictures come from, by which ones it loads *(as before)*
18. **could pass what it reads to the site a video comes from, by which video it offers you** (a read + embeds: F8)
19. could turn what it reads into sounds that a device nearby could pick up *(as before)*

No new sentence for F4: with `edit-uploads` counted as a read, the existing warnings now show for it (for
example `media` + `edit-uploads`: "could pass what it reads to the site a video or sound comes from, by how it
plays it"; `click` + `write-drafts` + `edit-uploads`: "could put what it reads into a post and send it for
you").

## A reason, changed (docs/POWER-COMBINATIONS.md, "No added risk: …")

A read with go-to (F10):

- was: it only goes to this site's own pages (fixed paths, or links the page shows), and that site can already see what it reads
- now: **it only goes to this site's own pages (the header's, with the header's words in a query, or links the page shows), and that site can already see what it reads**

## Page-wide rules (errors a mod sees), new acts

Each reads "{act} is off on this page while another boxed mod here has the {power} power: with both, {why}
(a mod that asks for {act} and {power} together shows the user that)":

| act | why |
|---|---|
| **changing what the site keeps** (site-storage's set and remove: F1) | **what one reads could be kept where the page's own code, or a boxed mod on a later page, finds it** |
| **choosing which of the user's actions the page sees** (block-events with a function: F5) | **what one reads could decide which of the user's actions the page's code sees, and it may send that on** |
| **offering the page's videos** (embeds, when made and when clicked: F8) | **what one reads could reach a video's host through which video is offered** |
| clicking for the user *(changed: F6)* | what one reads could decide what the other clicks (or one could keep the user's clicks from the page while the other clicks**, or change what the site receives from those clicks**) |
| signalling the page's own code *(changed: F6, F9)* | what one reads could reach the page's code, which may post or send it **(or one could keep the user's clicks from the page while the other sets off the page's own actions, or change what the site receives from them)** |

New, for edit-uploads as a read (F4): beside a mod that was handed a picture the user attached, the same acts
read:

- **{act} is off on this page since another boxed mod here was handed a picture the user attached (edit-uploads): with both, {why} (a mod that asks for {act} and edit-uploads together shows the user that)**

New, on a page a boxed mod's go-to brought the user to (F3), for a mod without go-to:

- **clicking for the user is off on this page until the user clicks or presses a key here: another boxed mod's go-to brought the user here, and with both, one could take the user to a page where the other clicks (a mod that asks for click and go-to together shows the user that)**
- **signalling the page's code is off on this page until the user clicks or presses a key here: another boxed mod's go-to brought the user here, and with both, one could take the user to a page where the other sets off the page's own actions (a mod that asks for page-events and go-to together shows the user that)**

## Unchanged, now said in more places (F2)

A filter that shortens another site's address now gets the existing error, "a filter may only remove or
reorder, and the text "{…}" isn't in what the site sent: TRIF kept what the site sent", and a link's `href`
set to another site's address with parameters taken out gets the existing "href only takes #somewhere, or an
address a link on the page already has". No new words.

## Docs only

docs/POWER-COMBINATIONS.md's opening paragraph (written out from the table) now names `edit-uploads` among the
reads and `site-storage`, `block-events` and `embeds` among the ways out, and says what `rewrite-requests` does
beside an act. docs/SAFE-MODS.md ("Combinations", the widened `site-data`) and docs/POWERS.md
("Combinations") are brought up to date. None of these is shown in the panel.
