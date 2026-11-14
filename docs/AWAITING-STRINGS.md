# Strings awaiting Tim's OK (for 0.3.0)

Every string here is in main and would ship in 0.3.0. Mark each OK or give the wording you want. Once all are
settled, the "awaiting" notes in the other *-STRINGS.md files get tidied (several still say "all awaiting
Tim's OK" in their headers though Tim approved them on 2026-11-10).

## A. The agent's level, on the chat's model line (from AGENT-SITES-STRINGS.md, "Moved to the chat line", 2026-11-11)

On the line (the button; narrow panels show only the icon, these words as its tooltip):

| Level | Words | OK? |
|---|---|---|
| Off | Agent can’t see this site | |
| Look | Agent can look | |
| Ask first | Agent asks before running code | |
| Run code | Agent can run code | |

The menu it opens:

| Part | Words | OK? |
|---|---|---|
| Heading | What your agent can do on {site} | |
| Look | it can read the page and take screenshots. | |
| Run code | it can change the page live; posting is paused until the page reloads. | |
| Footer | Whatever you pick, a mod that can do more than change this page waits for your OK. | |

(Ask first's line, "it can look, and asks you before running code on the site.", and Off's were settled this
week.)

## B. Robotless (no agent chosen in this browser) (from ROBOTLESS-STRINGS.md)

| Where | Words | OK? |
|---|---|---|
| The status dot's label and tooltip | Ready · robotless | |
| An error almost nobody sees (something asks for a run while robotless) | Robotless: no agent is chosen in this browser. Pick one in Settings to chat. | |

## C. New this week

| Where | Words | OK? |
|---|---|---|
| The grip under the mods list: tooltip | Drag to resize. Double-click to reset. | |
| The same grip, for screen readers | Mods list height | |
| Export all mods: the folder chooser's title | Where should TRIF save the mods for {site}? | |
| Export (one mod): the folder chooser's title | Where should TRIF save “{mod name}”? | |
| After Export all mods (chat note; {where} is the folder chosen, e.g. ~/Desktop) | Exported {n} mods for {site} to the folder "{site} mods" in {where}. | |
| After Export (code card) | Exported to {where} as {file}: send it to a friend, who imports it with Import mod… (or drops it on TRIF's panel). | |
| Settings → Log out: the card's title | Log out of {agent}? | |
| The same card's line | This logs you out everywhere on your computer, including the terminal. | |
| The same card's button | Log out | |
