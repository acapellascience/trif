# One way to reach sites, and the power button on the gate: strings (branch powers)

Every string added, changed or removed, exact, **all awaiting Tim's OK**.

## How it works (decisions to check)

- TRIF asks for each site's permission when it's turned on there (Fix, or Connect on a disconnected site),
  as restrictive did. No mode: the setup page's Site permissions step, Settings' Permissive / Restrictive
  choice and the "All-site access is on" card are gone, and nothing asks for `<all_urls>`. The manifest still
  lists `<all_urls>` as an *optional* host permission: per-site requests have to fall within it.
- **The update**: on its first start, a TRIF that had every site (0.2's permissive mode, or `<all_urls>` kept
  from when it was required) gives that up once (`permissions.remove`), deletes `siteMode`, and keeps every
  site's switch. Sites granted on their own stay connected; the rest show the usual grey "TRIF is
  disconnected on <site>" with Connect, so their mods don't fail silently. The panel shows the one-time note
  below. After that, if the user gives TRIF every site in the browser's own settings, TRIF leaves it.
- With every site given in the browser's settings, "Disconnect from <site>" isn't offered (one site can't be
  given back then); Block still is.
- **The power button** shows on "The robot is off." (to turn it on from there); it's hidden on the blocked
  (Unblock) and disconnected (Connect) screens, and on a page without a site, as before.
- Safari is unchanged (it asks per site itself).

## New

- The panel's one-time note, under the bar: **TRIF now asks for each site's permission. Your sites keep their
  settings: allow each one again the first time you use it there.** with **OK**
- Disconnect when the browser gives every site (an agent or an old panel asking): **{Browser} gives TRIF
  every site (in its own settings), so one site can't be disconnected here: block it in TRIF instead, or
  change that in {Browser}'s settings**
- CHANGELOG, the summary: **TRIF asks for each site's permission when you turn it on there. Had every site?
  Allow each again once.**; and under More: **TRIF asks for each site's permission.** Installing TRIF used to
  give it "all your data on all websites". Now it asks for nothing until you turn it on for a site; then your
  browser asks for that site only, and it stays disconnected (the panel all grey) until you click Connect
  there. If TRIF had every site, it gives that up once: your sites keep their settings; allow each one again
  when you next use it.
- README: "…a "Fix <site>" button that turns it on (the first time, your browser asks for that site's
  permission: TRIF never asks for every site). … The power button at the top of the panel turns it on and
  off." (was: "…turns it back off.")

## Removed

- Setup page, step 5: **Site permissions**; **Permissive** / **access to every site by default**;
  **Restrictive** / **connect TRIF on a site-to-site basis**; **You can change this later.**; **{Browser}
  didn’t get your OK, so TRIF is restrictive. You can switch to permissive later in the {panel}’s Settings.**;
  the step's ticked states **permissive** / **restrictive**.
- Settings: the **Site permissions** heading, **Permissive** / **access to every site by default**,
  **Restrictive** / **connect TRIF on a site-to-site basis**, **{Browser} didn’t get your OK, so TRIF stays
  restrictive.**, **Every site is disconnected now: connect each one when you visit it.**
- The Disconnect card: **All-site access is on**, **You'll have to allow TRIF again on other sites.**,
  **Switch to restrictive mode**, and its × (**Close**).
- Agents and the CLI: **TRIF is permissive (every site), so one site can't be disconnected: switch to
  restrictive mode first**; `trif status`: **site mode     permissive: access to every site by default; each
  site still follows its switch** / **site mode     restrictive: TRIF is disconnected on every site the user
  hasn't connected (side panel on the site)**.
- CHANGELOG, the summary: **Choose what TRIF can reach: every site (Permissive), or site by site with Connect
  (Restrictive). Already using TRIF? You stay Permissive.**; under More: the "You choose what TRIF can reach:
  permissive or restrictive" item, and "(with every site allowed, it offers to switch to restrictive)".

## Unchanged

- The gate's words ("The robot is off.", "Fix <site>", "TRIF is disconnected on <site>", "Connect", "The
  robot is blocked on <site>", "Unblock"), the power button's label ("Turn the robot on/off for <site>"), and
  Block / Disconnect.
