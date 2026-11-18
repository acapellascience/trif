// A site's own unread count, read from its page title (Tim, 11-18: "unread counts instead of notifications"). Shared by
// both phone apps: the iPhone's UnreadTitle.swift is the same rule in Swift, and mobile/test/unreadcount.test.js holds
// them to the same answers (mobile/shared/unread-cases.json, and random titles). Only the title the page itself shows:
// never a site's own API.
//
// Counted:
//   - a count at the very start: "(3) Home / X", "(12) Facebook", "(99+) YouTube", "(1,234) Feed | LinkedIn";
//   - "Inbox (N)" anywhere: "Inbox (5) - tim@example.com - Gmail";
//   - "(N unread)" anywhere: "Yahoo Mail - (5 unread)".
// Nothing else: a number in brackets elsewhere is part of the real title ("Dune: Part Two (2024) - IMDb", "Top 10
// (2023 film)"), and a year at the start ("(2024) Dune trailer - YouTube"). The count comes out of the title shown
// beside its badge, so it isn't said twice.
//
// readCount(title) → null (no count in it), or { count, plus, title }: count a whole number (0 possible: "Inbox (0)"),
// plus true for "99+", title the title without the count. countText(count, plus) → the badge's text.

'use strict';

// (spaces and digits spelt out, the same in JavaScript and in ICU (the Swift side): \s and \d differ between them)
const SP = '[ \\t\\n\\r\\f\\u000b\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const NUM = '([0-9]{1,3}(?:[,.\\u00a0\\u202f][0-9]{3})+|[0-9]{1,7})';
const LEAD = new RegExp(`^${SP}*\\(${NUM}(\\+?)\\)${SP}*`);
const INBOX = new RegExp(`(^|[^A-Za-z0-9])(inbox)${SP}*\\(${NUM}(\\+?)\\)`, 'i');
const UNREAD = new RegExp(`${SP}*\\(${NUM}(\\+?)${SP}+unread\\)`, 'i');
const SEPS = new RegExp(`${SP}+([-\\u2013\\u2014|\\u2022\\u00b7:])(?:${SP}+[-\\u2013\\u2014|\\u2022\\u00b7:])+(?=${SP})`, 'g');
const ENDS = new RegExp(`^(?:${SP}|[-\\u2013\\u2014|\\u2022\\u00b7:])+|(?:${SP}|[-\\u2013\\u2014|\\u2022\\u00b7:])+$`, 'g');
const RUNS = new RegExp(`${SP}{2,}`, 'g');

function number(text) { return parseInt(text.replace(/[^0-9]/g, ''), 10); }

function tidy(t) { return t.replace(SEPS, ' $1').replace(RUNS, ' ').replace(ENDS, ''); }

function readCount(title) {
  const t = String(title == null ? '' : title);
  let m = LEAD.exec(t);
  // (a year in brackets at the start is the title's own: "(2024) Dune trailer - YouTube"; no site's count is that
  // big without a "+")
  if (m && !(m[2] !== '+' && /^(19|20)[0-9]{2}$/.test(m[1]))) return { count: number(m[1]), plus: m[2] === '+', title: t.slice(m[0].length).replace(ENDS, '') };
  m = INBOX.exec(t);
  if (m) return { count: number(m[3]), plus: m[4] === '+', title: tidy(t.slice(0, m.index) + m[1] + m[2] + t.slice(m.index + m[0].length)) };
  m = UNREAD.exec(t);
  if (m) return { count: number(m[1]), plus: m[2] === '+', title: tidy(t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)) };
  return null;
}

/** The badge's words: "3", "20+", and past 999 "999+" (a card's badge stays small). */
function countText(count, plus) {
  if (count > 999) return '999+';
  return `${count}${plus ? '+' : ''}`;
}

const api = { readCount, countText };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.trifUnread = api;
