# Messages sent while the agent works: the new strings (branch chat-queue)

**Drafts for Tim (2026-11-18).** Tim's ask: in the panel's chat, send another message while the agent works and
have it go when the agent is done, or push it in now if it's important. All in `extension/sidepanel.js`
`QUEUE_WORDS` (one table, so a change is one line).

## The message box, while the agent works

The box stays usable; Send stays, with Stop beside it. Enter or Send puts the message in the queue.

- Send's tooltip (and label for screen readers) while the agent works: **Send when your agent is done**
  (otherwise unchanged: "Send")

## A waiting message (under the conversation)

A quieter copy of the user's bubble: its text, and under it a small line, **Send now** and ×.

- The line, while the agent works: **Sends when your agent is done**
- After Send now, with an agent that can't take a message mid-run (the run is being stopped first):
  **Sends as soon as your agent has stopped**
- The agent stopped or failed, so it didn't go (Send now still there): **Not sent: your agent stopped first**
- A moment between runs, while it goes: **Sending…**
- The button: **Send now**
- The ×, its tooltip and label: **Don’t send this**
- The text's tooltip (a click puts it back in the box to edit): **Click to edit**

## In the conversation

- A message sent with Send now that the agent took mid-run shows as a normal user bubble at that point;
  its tooltip: **Sent while your agent was working**
- Several waiting messages go as one user bubble (their texts in order, a blank line between): no new
  words.

## Errors (chat notes, rare)

- **Couldn't keep that message: {why}** (the queue couldn't take it, e.g. 20 waiting already)
- **Couldn't send it now: {why}**
- From the background, as `{why}`: **20 messages are waiting already: send or remove one first** ·
  **that message is too long (over 20000 characters)** · **that message isn’t waiting any more**

## Agent-only text (not for review)

- Helper log: "agent run {id}: a message from the user, sent while it works"
- Socket refusal of `agent.inject`: "only TRIF's side panel sends messages into a run while it works"
