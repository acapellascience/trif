# How TRIF talks

## You bring the robot

The robot is the user's own coding agent (Claude Code, Codex…). Tim's Robot Internet Fixer is the machine
it works in: the panel, the helper, the mods folder. TRIF never claims to be the robot, to have one, or to
be AI. Nothing should suggest we brought the robot.

- **"I" is always the user's agent.** First-person lines must be something their agent would say: "What
  should I fix on x.com?" reads as the agent asking.
- **The machine talks about itself plainly, in the third person,** like an appliance, and never says "I".
- **Credit goes to the agent** by name or role: "your coding agent", "Claude Code", "Codex". Never "our
  AI", "our robot", or "TRIF will write…".
- **"The robot" means the user's agent.** "The robot is off." on a site TRIF is off for means their agent
  can't touch the site and no mods run there.

## Words

- **Mods** are the things agents write. Keep the noun.
- **Fix** is the verb in the friendly spots: "What should I fix on x.com?", "Fix x.com".
- Names: **Tim's Robot Internet Fixer** in full (store, website, About); **TRIF** for the command and the
  folder. Which name the interface uses elsewhere is still to be decided.

## Tone

Plain and humble. Short. No marketing voice, no taglines.

## The robot icon

A dark squircle head in a green rim, with two mint eyes (`scripts/render-icon.js`). His face says the
state, one at a time (extension/faces.js), in the toolbar icon for the tab, the robot in the panel's bar,
and the gate's robot:
- **paused** (the agent ran code in the tab): two white bars for eyes, posting blocked until the page
  reloads. The panel's state colour goes white then (dark grey, #3a3a3e, on the light theme);
- **blocked** (the user blocked the site in TRIF): red, with a red cross for eyes;
- **off** (TRIF is off on the site, "The robot is off."): a blank face, no eyes;
- **logged out** (the agent needs a login or a key: every tab): yellow, the eyes hollow;
- otherwise his eyes. Disconnected keeps them (the panel goes grey), and so does TRIF missing a part (the
  panel's red).
Paused wins over the rest (it's what the page can do right now), then blocked, off, logged out. On the
gate, the face is off's or blocked's, in the panel's colour (yellow or red when that's what's wrong).
At 16 px the bars, the cross and the hollow eyes sit on whole pixels.
