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

A dark squircle head in a green rim, with two mint eyes (`scripts/render-icon.js`). The robot is always one
colour: its frame and its features share the state's colour (the usual robot's rim and mint eyes are
both TRIF green). That's for his marks: the face behind them can differ where contrast needs it. His face says the state, one at a time (extension/faces.js), in the toolbar icon for the
tab, the robot in the panel's bar, and the gate's robot:
- **paused** (the agent ran code in the tab): a white frame and two white bars for eyes on the dark face,
  posting blocked until the page reloads; on a light theme or toolbar, flipped: dark-grey (#3a3a3e) frame
  and bars on a light face. The panel's state colour goes white then (dark grey on the light theme);
- **blocked** (the user blocked the site in TRIF): a red frame, a red cross for eyes;
- **disconnected** (TRIF can't reach the site): a grey frame, a grey broken link for eyes (two chain-link
  halves apart; not a slashed link, which would read as blocked);
- **off** (TRIF is off on the site, "The robot is off."): a blank frame in the state's colour;
- **robotless** (no chat agent in this browser: every tab): off's blank face, in the usual green (the
  toolbar uses off's icon); the panel stays green, as nothing needs logging in;
- **logged out** (the agent needs a login or a key: every tab): a yellow frame, hollow yellow eyes;
- otherwise his eyes, also when TRIF is missing a part (the panel's red).
Paused wins over the rest (it's what the page can do right now), then blocked, disconnected, off (a
site's states, one at a time), then robotless, then logged out (every tab's; never while robotless). On the gate, the face is off's, blocked's or
disconnected's, off's in the panel's colour (yellow or red when that's what's wrong). At 16 px the bars,
the cross, the broken link and the hollow eyes sit on whole pixels.
