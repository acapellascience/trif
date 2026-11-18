# Editing a mod in the code card: the new strings (branch code-editor, for 0.3.2)

**Awaiting Tim.** Every string people see that the code card's Edit adds on desktop, exact. Where the iPhone app
already has the words (docs/IOS-APP-STRINGS.md, "Editing a mod's code", on branch ios-poc), desktop uses them
as they are; the rows marked **new** are desktop's own.

## The code card's Code tab

| Where | Words | From |
|---|---|---|
| The buttons' row, beside Copy and Export | **Edit** | iPhone's |
| While editing, in place of Copy, Export and ⋯ | **Undo** · **Redo** · **Cancel** · **Save** | iPhone's |
| The editor (screen readers) | The mod's code | desktop's (the code view's) |
| Edit, disabled, for a mod too long to show whole (over 200,000 characters); and the error if it's clicked anyway | Too long to edit here: open it in your editor (⋯, Open in editor). | **new** |
| Edit, disabled, with the helper away | TRIF's helper isn't connected, so it can't open the file | desktop's |

## Save

| Where | Words | From |
|---|---|---|
| Save refused: something's wrong | **Not saved:** TRIF found a problem in it. — then up to eight lines, each **Line {n}** (a link: the editor selects that line) and what's wrong, in `trif check`'s own words (the helper's and the sandbox lint's, as agents see them) | iPhone's |
| Save refused: the file changed meanwhile (another editor, an agent, another browser's panel) | **Not saved:** the mod’s file changed since you started editing. Your edit is still here: copy what you need, then Cancel to see the new version. | **new** |
| Saved, it runs | Saved. It runs from the next page load. **Undo** | **new** (the iPhone says "from this page load"; desktop's Allow says "The new version runs from the next page load.") |
| Saved, it needs an OK | Saved. It waits for your OK: the version before keeps running until you decide. **Undo** | iPhone's |
| After Undo | Put back the version from before your edit. Your edit is in History. | iPhone's |
| Undo refused (the file changed again since Save) | {site}/{mod} changed again since you saved it, so the version before isn't put back: History has it | **new** |

## History and the approval card

| Where | Words | From |
|---|---|---|
| History, a version an edit replaced | before you edited it | iPhone's |
| The approval card's note (and the mod row's facts) for an edit | You edited it. (then desktop's "The version before keeps running until you decide." for a change, or "Updates that ask for the same powers won't ask again." for a boxed mod's powers) | iPhone's |
| An edit's own holds, as lines on the card | is now a free mod, so it can do anything the page can do | iPhone's (new there too) |
| | runs on {pattern}, outside {site} | desktop's (held.js) |
| | runs on {pattern}, where the version before didn't (only for a mod in the all-sites folder, which has no site of its own to name) | **new** |

The line for becoming a free mod has ⚠ as its icon, a new site ◎ (as a run's mod for another site has).

## Not changed, worth a look

- History's empty text still says "TRIF keeps the version before each change your agent makes, a fix, a restore
  or an import, for 30 days." An edit keeps one too; it isn't in that list (left as it is: only Tim changes
  wording outside what's named).
