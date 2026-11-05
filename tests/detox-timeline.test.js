// Detox Timeline's filter tests, ported from its original app (Tests/xfeed-tests.js), run against
// examples/sites/x.com/detox-timeline.js with stub browser globals. Checks the timeline filter: reposts, ads
// and who-to-follow modules go; your follows' own posts, quotes, conversations and cursors stay.
// The cases share the mod's state (options, the feed's seen/shown posts) and run in order.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const MOD = path.join(__dirname, '..', 'examples', 'sites', 'x.com', 'detox-timeline.js');

class FakeXHR {}
Object.defineProperty(FakeXHR.prototype, 'responseText', { configurable: true, get() { return this._text; } });
Object.defineProperty(FakeXHR.prototype, 'response', { configurable: true, get() { return this._text; } });
FakeXHR.prototype.open = function () {};
const node = { append() {}, addEventListener() {} };
global.window = global;
global.history = { pushState() {}, replaceState() {} };
global.addEventListener = () => {};
global.location = { hostname: 'x.com', pathname: '/home', href: 'https://x.com/home', origin: 'https://x.com' };
global.XMLHttpRequest = FakeXHR;
let fetchImpl = async () => { throw new Error('unused'); };   // what X's fetch answers, per test
global.fetch = (...args) => fetchImpl(...args);
global.MutationObserver = class { observe() {} };
global.document = {
  cookie: 'twid=u%3D999',
  head: node, documentElement: node, addEventListener() {}, querySelector() { return null }, querySelectorAll() { return []; },
  createElement: () => ({ append() {}, set textContent(v) {} }),
};
// Everything shown but reposts (out of the box everything is hidden), so each filter can be tested on its own.
const saved = { reposts: false, quotes: true, replies: true, conversations: true, long: true, links: true, videos: true, images: true, nonMutuals: true };
global.localStorage = { getItem: (key) => (key === 'dmFeedOptions' ? JSON.stringify(saved) : null), setItem() {} };
eval(fs.readFileSync(MOD, 'utf8'));

// Posts from people you follow, unless a test says otherwise.
const tweet = (id, extra = {}) => ({
  entryId: `tweet-${id}`,
  content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: { __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: { relationship_perspectives: { following: true } } } }, legacy: { full_text: 'hi', ...extra } } } } },
});
const repost = (id) => tweet(id, { retweeted_status_result: { result: { rest_id: 'orig' } } });
const hiddenRepost = (id) => {
  const entry = repost(id);
  const result = entry.content.itemContent.tweet_results.result;
  entry.content.itemContent.tweet_results.result = { __typename: 'TweetWithVisibilityResults', tweet: result };
  return entry;
};
const ad = { entryId: 'promoted-tweet-9', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', promotedMetadata: {}, tweet_results: { result: { legacy: {} } } } } };
const adNoPrefix = { entryId: 'tweet-8', content: { itemContent: { itemType: 'TimelineTweet', promotedMetadata: { advertiser: 1 }, tweet_results: { result: { legacy: {} } } } } };
const whoToFollow = { entryId: 'who-to-follow-1', content: { entryType: 'TimelineTimelineModule', items: [{ item: { itemContent: { itemType: 'TimelineUser' } } }] } };
const thread = { entryId: 'home-conversation-5', content: { entryType: 'TimelineTimelineModule', items: [{ item: tweet('5a').content }, { item: repost('5b').content }] } };
const allReposts = { entryId: 'home-conversation-6', content: { entryType: 'TimelineTimelineModule', items: [{ item: repost('6a').content }] } };
const quote = tweet('7', { is_quote_status: true });
const cursor = { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', value: 'abc' } };

const data = { data: { home: { home_timeline_urt: { instructions: [
  { type: 'TimelineClearCache' },
  { type: 'TimelineAddEntries', entries: [tweet('1'), repost('2'), hiddenRepost('3'), ad, adNoPrefix, whoToFollow, thread, allReposts, quote, cursor] },
] } } } };

const ids = (json) => JSON.parse(json).data.home.home_timeline_urt.instructions[1].entries.map((e) => e.entryId);

test("home timeline: reposts, ads and who-to-follow go; posts, quotes and cursors stay", () => {
const out = window.__dmFilterTimeline(JSON.stringify(data));
assert.deepStrictEqual(ids(out), ['tweet-1', 'tweet-7', 'cursor-bottom-1'], 'a block containing a repost goes whole (filters compose)');
});

test("other responses pass through untouched, and bad JSON doesn't throw", () => {
assert.strictEqual(window.__dmFilterTimeline('{"data":{"user":1}}'), '{"data":{"user":1}}');
assert.strictEqual(window.__dmFilterTimeline('not json'), 'not json');
});

test("the XHR hook filters timeline requests only", () => {
const xhr = new XMLHttpRequest();
xhr.open('GET', 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=1');
Object.assign(xhr, { readyState: 4, status: 200, _text: JSON.stringify(data) });
assert.deepStrictEqual(ids(xhr.responseText), ['tweet-1', 'tweet-7', 'cursor-bottom-1']);
assert.strictEqual(xhr.response, xhr.responseText);
const other = new XMLHttpRequest();
other.open('GET', 'https://x.com/i/api/graphql/abc/UserByScreenName');
Object.assign(other, { readyState: 4, status: 200, _text: JSON.stringify(data) });
assert.strictEqual(other.responseText, JSON.stringify(data));
});

// Toggles: quotes, videos and images can be hidden; reposts shown.
const withMedia = (id, type, extra = {}) => tweet(id, { extended_entities: { media: [{ type }] }, ...extra });
const quotingVideo = tweet('q2');
quotingVideo.content.itemContent.tweet_results.result.quoted_status_result = { result: { legacy: { extended_entities: { media: [{ type: 'video' }] } } } };
const mixed = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  tweet('plain'), repost('rp'), quote, withMedia('photo', 'photo'), withMedia('vid', 'video'), withMedia('gif', 'animated_gif'), quotingVideo,
] }] } } } });
const run = () => JSON.parse(window.__dmFilterTimeline(JSON.stringify(mixed()))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId.replace('tweet-', ''));
const opts = window.__dmFeedOptions;

test("toggles: quotes, videos and images can be hidden; reposts shown", () => {
assert.deepStrictEqual(run(), ['plain', '7', 'photo', 'vid', 'gif', 'q2'], 'these tests\' settings: reposts hidden, everything else shown');
Object.assign(opts, { reposts: true });
assert.deepStrictEqual(run(), ['plain', 'rp', '7', 'photo', 'vid', 'gif', 'q2'], 'reposts on');
Object.assign(opts, { reposts: false, quotes: false });
assert.deepStrictEqual(run(), ['plain', 'photo', 'vid', 'gif'], 'quotes off (q2 has a quoted post)');
Object.assign(opts, { quotes: true, videos: false });
assert.deepStrictEqual(run(), ['plain', '7', 'photo'], 'videos off, including GIFs and videos inside quoted posts');
Object.assign(opts, { videos: true, images: false });
assert.deepStrictEqual(run(), ['plain', '7', 'vid', 'gif', 'q2'], 'images off');
});

// Replies and links.
const replyTo = (id) => tweet(id, { in_reply_to_status_id_str: '1', in_reply_to_user_id_str: 'other', user_id_str: 'me' });
const reply = replyTo('reply');
const selfThread = tweet('self', { in_reply_to_status_id_str: '1', in_reply_to_user_id_str: 'me', user_id_str: 'me' });
const link = tweet('link', { entities: { urls: [{ expanded_url: 'https://example.com/story' }] } });
const postLink = tweet('postlink', { entities: { urls: [{ expanded_url: 'https://x.com/someone/status/5' }] } });
const card = tweet('card');
card.content.itemContent.tweet_results.result.card = { rest_id: 'c' };
const longLink = tweet('long');
longLink.content.itemContent.tweet_results.result.note_tweet = { note_tweet_results: { result: { entity_set: { urls: [{ expanded_url: 'https://example.org' }] } } } };
const quotingLink = tweet('qlink', { is_quote_status: true });
quotingLink.content.itemContent.tweet_results.result.quoted_status_result = { result: { legacy: { entities: { urls: [{ expanded_url: 'https://example.net' }] } } } };
const replyModule = { entryId: 'home-conversation-r', content: { items: [{ item: tweet('ctx').content }, { item: replyTo('reply2').content }] } };
const selfModule = { entryId: 'home-conversation-s', content: { items: [{ item: tweet('start').content }, { item: tweet('self2', { in_reply_to_status_id_str: '1', in_reply_to_user_id_str: 'me', user_id_str: 'me' }).content }] } };
const more = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  tweet('plain'), reply, selfThread, link, postLink, card, longLink, quotingLink, replyModule, selfModule,
] }] } } } });
const run2 = () => JSON.parse(window.__dmFilterTimeline(JSON.stringify(more()))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId.replace(/^(tweet|home-conversation)-/, ''));

test("replies and links; Replies and Conversations toggles", () => {
Object.assign(opts, { images: true });
assert.deepStrictEqual(run2(), ['plain', 'reply', 'self', 'link', 'postlink', 'card', 'long', 'qlink', 'r', 's'], 'replies and links shown by default');
// Replies: replies shown on their own, to someone else or to oneself.
Object.assign(opts, { replies: false });
assert.deepStrictEqual(run2(), ['plain', 'link', 'postlink', 'card', 'long', 'qlink', 'r', 's'], 'replies off: standalone replies (to others and to self) go; conversations stay');
// Conversations: blocks of two or more posts, whether a back-and-forth or someone's own thread.
Object.assign(opts, { replies: true, conversations: false });
assert.deepStrictEqual(run2(), ['plain', 'reply', 'self', 'link', 'postlink', 'card', 'long', 'qlink'], 'conversations off: both kinds of block go; standalone replies stay');
Object.assign(opts, { conversations: true, replies: false });
const conv = JSON.parse(window.__dmFilterTimeline(JSON.stringify(more()))).data.home.home_timeline_urt.instructions[0].entries.find((e) => e.entryId === 'home-conversation-s');
assert.deepStrictEqual(conv.content.items.map((i) => i.item.itemContent.tweet_results.result.rest_id), ['start', 'self2'], 'a kept block stays whole even with Replies off');
});

// Filters compose: a block shows only if every post in it passes them.
const imageReply = tweet('imgreply', { in_reply_to_status_id_str: '1', in_reply_to_user_id_str: 'other', user_id_str: 'me', extended_entities: { media: [{ type: 'photo' }] } });
const linkCtx = tweet('ctxlink', { entities: { urls: [{ expanded_url: 'https://example.com' }] } });
const blocks = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  { entryId: 'home-conversation-i', content: { items: [{ item: tweet('ctx2').content }, { item: imageReply.content }] } },
  { entryId: 'home-conversation-j', content: { items: [{ item: withMedia('ctx3', 'photo').content }, { item: replyTo('rj').content }] } },
  { entryId: 'home-conversation-k', content: { items: [{ item: linkCtx.content }, { item: replyTo('rk').content }] } },
  { entryId: 'home-conversation-l', content: { items: [{ item: tweet('ctx4').content }, { item: replyTo('rl').content }] } },
  { entryId: 'home-conversation-m', content: { items: [{ item: tweet('ctx5').content }, { item: repost('rp9').content }] } },
  { entryId: 'home-conversation-n', content: { items: [{ item: replyTo('rn').content }] } },   // one post: treated as standalone
] }] } } } });
const runBlocks = () => JSON.parse(window.__dmFilterTimeline(JSON.stringify(blocks()))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId.replace('home-conversation-', ''));

test("filters compose: a block shows only if every post in it passes them", () => {
Object.assign(opts, { replies: true, images: false, links: false });
assert.deepStrictEqual(runBlocks(), ['l', 'n'], 'images and links off: blocks with an image or link anywhere go; reposts inside a block too');
Object.assign(opts, { images: true, links: true, replies: false });
assert.deepStrictEqual(runBlocks(), ['i', 'j', 'k', 'l'], 'replies off: blocks stay (Conversations covers them); a one-post block is a standalone reply and goes');
});

// A block whose top post isn't by someone you follow (or you) goes, even if someone you follow replies in it.
const stranger = (id) => { const e = tweet(id); e.content.itemContent.tweet_results.result.core.user_results.result.relationship_perspectives.following = false; e.content.itemContent.tweet_results.result.legacy.user_id_str = 'nobody'; return e; };
const mine = (id) => { const e = stranger(id); e.content.itemContent.tweet_results.result.legacy.user_id_str = '999'; return e; };
const tops = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  { entryId: 'home-conversation-t1', content: { items: [{ item: stranger('st1').content }, { item: replyTo('rt1').content }] } },
  { entryId: 'home-conversation-t2', content: { items: [{ item: tweet('ft1').content }, { item: stranger('st2').content }, { item: replyTo('rt2').content }] } },
  { entryId: 'home-conversation-t3', content: { items: [{ item: mine('me1').content }, { item: replyTo('rt3').content }] } },
] }] } } } });

test("a block whose top post is by a stranger goes", () => {
Object.assign(opts, { replies: true });
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(tops()))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId.replace('home-conversation-', '')),
  ['t2', 't3'], 'top post by a stranger: block goes; by someone you follow or by you: stays (strangers further down are fine)');
});

test("links off: links, cards, long-post links and quoted links go", () => {
Object.assign(opts, { replies: true, links: false });
assert.deepStrictEqual(run2(), ['plain', 'reply', 'self', 'postlink', 'r', 's'], 'links off: links, cards, long-post links and quoted links go; links to posts stay');
Object.assign(opts, { links: true });
});

// The reported case: a block whose top post was already shown higher up in the feed shows (in X) as a lone
// "Replying to @…" reply, so it's judged as one: with Replies off it goes. Repeats are tracked per feed load.
const qcPost = tweet('qc1');
const vividReply = { entryId: 'home-conversation-v', content: { items: [{ item: tweet('qc1').content }, { item: replyTo('vivid').content }] } };
const twoParty = { entryId: 'home-conversation-w', content: { items: [{ item: tweet('qc1').content }, { item: replyTo('w1').content }, { item: replyTo('w2').content }] } };
const repeatPage = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [qcPost, vividReply, twoParty] }] } } } });
const freshURL = 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=%7B%7D';

test("a block whose top post was already shown is judged by what is left", () => {
Object.assign(opts, { replies: false, conversations: true });
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(repeatPage()), freshURL)).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId),
  ['tweet-qc1', 'home-conversation-w'], 'repeated top post: the lone reply goes; a block with two posts left stays');
Object.assign(opts, { replies: true });
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(repeatPage()), freshURL)).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId),
  ['tweet-qc1', 'home-conversation-v', 'home-conversation-w'], 'replies on: the lone reply stays');
});

// Later feed pages arrive as POSTs with the variables (cursor) in the body: still the same feed.
const postURL = 'https://x.com/i/api/graphql/abc/HomeLatestTimeline';
const pageTwo = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  { entryId: 'home-conversation-x', content: { items: [{ item: tweet('qc1').content }, { item: replyTo('x1').content }] } },
] }] } } } };

test("a POSTed next page knows what page one showed", () => {
Object.assign(opts, { replies: false });
window.__dmFilterTimeline(JSON.stringify(repeatPage()), freshURL);
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(pageTwo), postURL, JSON.stringify({ variables: { cursor: 'abc' } }))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId).filter((e) => !/dmhidden/.test(e)),
  [], 'a POSTed next page knows qc1 was shown on page one');
Object.assign(opts, { replies: true });
});

test("Recent for POSTed pages too", () => {
// Recent for POSTed pages too.
assert.deepStrictEqual(JSON.parse(window.__dmRecentBody(JSON.stringify({ variables: { cursor: 'c', enableRanking: true }, features: {} }))), { variables: { cursor: 'c', enableRanking: false }, features: {} });
assert.strictEqual(window.__dmRecentBody('not json'), 'not json');
});

// A shown repost is judged by what it reposts.
const repostOf = (id, inner) => { const e = tweet(id, { retweeted_status_result: { result: inner.content.itemContent.tweet_results.result } }); return e; };
const repostPage = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  repostOf('rpimg', withMedia('origimg', 'photo')), repostOf('rpplain', tweet('origplain')), repostOf('rpreply', replyTo('origreply')), repostOf('rplink', linkCtx),
] }] } } } });
const runReposts = () => JSON.parse(window.__dmFilterTimeline(JSON.stringify(repostPage()), freshURL)).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId.replace('tweet-', '')).filter((e) => !/dmhidden/.test(e));

test("a shown repost is judged by what it reposts", () => {
Object.assign(opts, { reposts: true, images: false, replies: false, links: false });
assert.deepStrictEqual(runReposts(), ['rpplain'], 'reposts on: a repost of an image post, a reply or a link post still goes');
Object.assign(opts, { images: true, replies: true, links: true });
assert.deepStrictEqual(runReposts(), ['rpimg', 'rpplain', 'rpreply', 'rplink']);
});

test("a post shown higher up as a repost counts as shown", () => {
// A post shown higher up as a repost counts as shown: X hides it in a later block too.
Object.assign(opts, { reposts: true, replies: false });
const tenPost = tweet('ten1');
const afterRepost = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  repostOf('rpten', tenPost),
  { entryId: 'home-conversation-mp', content: { items: [{ item: tweet('ten1').content }, { item: replyTo('mp1').content }] } },
] }] } } } });
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(afterRepost()), freshURL)).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId).filter((e) => !/dmhidden/.test(e)),
  ['tweet-rpten'], 'the block is down to a lone reply, which Replies off removes');
Object.assign(opts, { reposts: false, replies: true });
});

test("profiles: who-to-follow blocks and ads go; posts stay", () => {
// Profiles: who-to-follow blocks and ads go from the profile's timelines; posts stay, whatever the toggles say.
Object.assign(opts, { replies: false, images: false });
const profilePage = { data: { user: { result: { timeline: { timeline: { instructions: [
  { type: 'TimelinePinEntry', entry: tweet('pinned') },
  { type: 'TimelineAddEntries', entries: [
    replyTo('pr1'), withMedia('pimg', 'photo'),
    { entryId: 'who-to-follow-123', content: { entryType: 'TimelineTimelineModule', items: [{ item: { itemContent: { itemType: 'TimelineUser' } } }] } },
    { ...ad, entryId: 'promoted-tweet-77' },
    { entryId: 'profile-conversation-5', content: { items: [{ item: tweet('pc1').content }, { item: replyTo('pc2').content }] } },
    { entryId: 'cursor-bottom-9', content: { entryType: 'TimelineTimelineCursor' } },
  ] },
] } } } } } };
const profileURL = 'https://x.com/i/api/graphql/abc/UserTweets?variables=%7B%22userId%22%3A%221%22%7D';
const profileOut = JSON.parse(window.__dmFilterTimeline(JSON.stringify(profilePage), profileURL)).data.user.result.timeline.timeline.instructions;
assert.deepStrictEqual(profileOut[1].entries.map((e) => e.entryId), ['tweet-pr1', 'tweet-pimg', 'profile-conversation-5', 'cursor-bottom-9'], 'profile: who to follow and ads go; replies and images stay');
assert.strictEqual(profileOut[0].entry.entryId, 'tweet-pinned');
const v2 = { data: { user: { result: { timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [tweet('v1'), { entryId: 'who-to-follow-9', content: {} }] }] } } } } } };
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(v2), profileURL)).data.user.result.timeline_v2.timeline.instructions[0].entries.map((e) => e.entryId), ['tweet-v1']);
const originals = { data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [tweet('o1'), { entryId: 'who-to-follow-4', content: {} }] }] } } } } } };
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(originals), 'https://x.com/i/api/graphql/abc/UserOriginalsTimeline')).data.user.result.timeline.timeline.instructions[0].entries.map((e) => e.entryId), ['tweet-o1']);
const xo = new XMLHttpRequest();
xo.open('GET', 'https://x.com/i/api/graphql/abc/UserOriginalsTimeline?variables=%7B%7D');
Object.assign(xo, { readyState: 4, status: 200, _text: JSON.stringify(originals) });
assert.ok(!xo.responseText.includes('who-to-follow'), 'UserOriginalsTimeline requests are filtered');
Object.assign(opts, { replies: true, images: true });
});

test("the old threads option is dropped", () => {
assert.ok(!('threads' in opts));
});

test("long: over 280 characters", () => {
// Long: over 280 characters (counted as characters, so emoji count once).
const longPost = tweet('longpost');
longPost.content.itemContent.tweet_results.result.note_tweet = { note_tweet_results: { result: { text: 'a'.repeat(281) } } };
const exactly280 = tweet('e280', { display_text_range: [0, 280] });
const emoji280 = tweet('emoji');
emoji280.content.itemContent.tweet_results.result.note_tweet = { note_tweet_results: { result: { text: '🙂'.repeat(280) } } };
const lengths = () => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [tweet('short'), longPost, exactly280, emoji280] }] } } } });
const run3 = () => JSON.parse(window.__dmFilterTimeline(JSON.stringify(lengths()))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId.replace('tweet-', ''));
assert.deepStrictEqual(run3(), ['short', 'longpost', 'e280', 'emoji'], 'long shown by default');
Object.assign(opts, { long: false });
assert.deepStrictEqual(run3(), ['short', 'e280', 'emoji'], 'long off: over 280 characters goes; 280 stays');
Object.assign(opts, { long: true });
});

test("post pages: ads and Discover more go; replies stay", () => {
// Post pages (TweetDetail): ads and "Discover more" go; replies stay whatever the toggles say.
Object.assign(opts, { replies: false, reposts: false, links: false });
const detailCursor = { entryId: 'cursor-showmorethreads-1', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTimelineCursor', value: 'x' } } };
const conversation = { entryId: 'conversationthread-2', content: { items: [
  { entryId: 'conversationthread-2-tweet-2', item: reply.content },
  { entryId: 'conversationthread-2-tweet-3', item: { itemContent: { itemType: 'TimelineTweet', promotedMetadata: {}, tweet_results: { result: { legacy: {} } } } } },
  { entryId: 'conversationthread-2-cursor-showmore-4', item: { itemContent: { itemType: 'TimelineTimelineCursor', value: 'y' } } },
] } };
const related = { entryId: 'tweetdetailrelatedtweets-9', content: { header: { text: 'Discover more' }, items: [{ item: tweet('rel').content }] } };
const detail = { data: { threaded_conversation_with_injections_v2: { instructions: [
  { type: 'TimelineAddEntries', entries: [tweet('main'), conversation, { ...ad }, related, detailCursor, { entryId: 'who-to-follow-2', content: {} }, link] },
  { type: 'TimelineAddToModule', moduleEntryId: 'tweetdetailrelatedtweets-9', moduleItems: [{ entryId: 'x', item: tweet('rel2').content }] },
  { type: 'TimelineAddToModule', moduleEntryId: 'conversationthread-2', moduleItems: [{ entryId: 'conversationthread-2-tweet-5', item: selfThread.content }] },
] } } };
const outDetail = JSON.parse(window.__dmFilterTimeline(JSON.stringify(detail))).data.threaded_conversation_with_injections_v2.instructions;
assert.deepStrictEqual(outDetail[0].entries.map((e) => e.entryId), ['tweet-main', 'conversationthread-2', 'cursor-showmorethreads-1', 'tweet-link'], 'post page: ads, discover more, who to follow gone; replies and links stay');
assert.deepStrictEqual(outDetail[0].entries[1].content.items.map((i) => i.entryId), ['conversationthread-2-tweet-2', 'conversationthread-2-cursor-showmore-4'], 'reply kept, ad reply gone, show-more cursor kept');
assert.deepStrictEqual(outDetail[1].moduleItems, [], 'more discover-more posts dropped');
assert.strictEqual(outDetail[2].moduleItems.length, 1, 'more replies (even self-replies) kept');
Object.assign(opts, { replies: true, links: true });
});

// Post pages: replies from people you don't follow are held back for the collapsed section.
const by = (id, user, extra = {}) => {
  const entry = tweet(id, { user_id_str: user, ...extra });
  entry.content.itemContent.tweet_results.result.core = { user_results: { result: { rest_id: user, core: { screen_name: user }, relationship_perspectives: { following: user.startsWith('friend') } } } };
  return entry;
};
const convo = (n, ...tweets) => ({ entryId: `conversationthread-${n}`, content: { items: tweets.map((t, i) => ({ entryId: `conversationthread-${n}-tweet-${i}`, item: t.content })) } });
const page = (instructions) => ({ data: { threaded_conversation_with_injections_v2: { instructions } } });
const detailURL = (focal, cursor) => `https://x.com/i/api/graphql/abc/TweetDetail?variables=${encodeURIComponent(JSON.stringify({ focalTweetId: focal, ...(cursor ? { cursor } : {}) }))}`;

test("post pages: replies from people you don't follow are held back", () => {
const first = page([{ type: 'TimelineAddEntries', entries: [
  by('500', 'author'),
  convo(1, by('501', 'stranger1'), by('502', 'friend1')),   // a stranger's reply that a friend answered: stays
  convo(2, by('503', 'friend2')),
  convo(3, by('504', 'author')),                             // the post's author: stays
  convo(4, by('505', '999')),                                // you: stay
  convo(5, by('506', 'stranger2')),
  { entryId: 'conversationthread-9', content: { items: [{ entryId: 'conversationthread-9-tweet-0', item: { itemContent: { itemType: 'TimelineTweet', promotedMetadata: {}, tweet_results: { result: { rest_id: '510', legacy: { user_id_str: 'brand' } } } } } }] } },
  { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor' } },
] }]);
const kept = (json) => JSON.parse(json).data.threaded_conversation_with_injections_v2.instructions[0].entries.map((e) => e.entryId);
assert.deepStrictEqual(kept(window.__dmFilterTimeline(JSON.stringify(first), detailURL('500'))),
  ['tweet-500', 'conversationthread-1', 'conversationthread-2', 'conversationthread-3', 'conversationthread-4', 'cursor-bottom-1'], 'threads with a followed person, you or the author stay in X\'s list');
const held = window.__dmUnfollowed.posts['500'];
assert.strictEqual(held.author, 'author');
assert.deepStrictEqual(held.threads.map((t) => t.id), ['conversationthread-5']);
// The next page of the same post adds to the section; more of a held-back thread joins it.
const second = page([
  { type: 'TimelineAddEntries', entries: [convo(6, by('507', 'stranger3')), convo(7, by('508', 'friend3'))] },
  { type: 'TimelineAddToModule', moduleEntryId: 'conversationthread-5', moduleItems: [{ entryId: 'x', item: by('509', 'stranger1').content }] },
]);
const secondOut = JSON.parse(window.__dmFilterTimeline(JSON.stringify(second), detailURL('500', 'c1'))).data.threaded_conversation_with_injections_v2.instructions;
assert.deepStrictEqual(secondOut[0].entries.map((e) => e.entryId), ['conversationthread-7']);
assert.deepStrictEqual(secondOut[1].moduleItems, []);
assert.deepStrictEqual(held.threads.map((t) => t.id), ['conversationthread-5', 'conversationthread-6']);
assert.strictEqual(held.threads[0].tweets.length, 2);
// Fetching the first page again doesn't duplicate; another post gets its own list, and the first is kept.
window.__dmFilterTimeline(JSON.stringify(first), detailURL('500'));
assert.deepStrictEqual(held.threads.map((t) => t.id), ['conversationthread-5', 'conversationthread-6']);
window.__dmFilterTimeline(JSON.stringify(page([{ type: 'TimelineAddEntries', entries: [by('600', 'author2'), convo(8, by('601', 'stranger4'))] }])), detailURL('600'));
assert.deepStrictEqual(window.__dmUnfollowed.posts['600'].threads.map((t) => t.id), ['conversationthread-8']);
assert.strictEqual(window.__dmUnfollowed.posts['500'].threads.length, 2);
// The reported case: on a post's page, a stranger's reply answered by someone you follow stays in X's list;
// and a thread holding the post being viewed is never taken out.
const strangerThenFriend = page([{ type: 'TimelineAddEntries', entries: [by('700', 'stranger9'), convo(10, by('701', 'stranger8'), by('702', 'friend9'))] }]);
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(strangerThenFriend), detailURL('700'))).data.threaded_conversation_with_injections_v2.instructions[0].entries.map((e) => e.entryId),
  ['tweet-700', 'conversationthread-10']);
const holdingFocal = page([{ type: 'TimelineAddEntries', entries: [convo(11, by('801', 'stranger7'), by('802', 'stranger6'))] }]);
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(holdingFocal), detailURL('802'))).data.threaded_conversation_with_injections_v2.instructions[0].entries.map((e) => e.entryId),
  ['conversationthread-11']);
});

test("feed pages that add nothing new get a placeholder so X keeps loading", () => {
// Feed pages that add nothing new get a placeholder at the bottom so X keeps loading.
Object.assign(opts, { reposts: false, quotes: true, replies: true, conversations: true, long: true, links: true, videos: true, images: true });
const feedURL = (cursor) => `https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=${encodeURIComponent(JSON.stringify(cursor ? { cursor } : {}))}`;
const feedPage = (...entries) => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [
  { entryId: 'cursor-top-1', sortIndex: '900', content: { entryType: 'TimelineTimelineCursor' } },
  ...entries,
  { entryId: 'cursor-bottom-1', sortIndex: '100', content: { entryType: 'TimelineTimelineCursor' } },
] }] } } } });
const runFeed = (page, cursor) => JSON.parse(window.__dmFilterTimeline(JSON.stringify(page), feedURL(cursor))).data.home.home_timeline_urt.instructions[0].entries;
const withSort = (e, i) => ({ ...e, sortIndex: String(500 - i) });
// First page, all filtered: placeholder just above the bottom cursor, sorted after everything else.
let out1 = runFeed(feedPage(withSort(repost('a1'), 0), withSort(repost('a2'), 1), ad), null);
assert.deepStrictEqual(out1.map((e) => e.entryId.replace(/dmhidden-\d+-\d+/, 'dmhidden')), ['cursor-top-1', 'tweet-dmhidden', 'cursor-bottom-1']);
assert.strictEqual(out1[1].content.itemContent.tweet_results.result.tombstone.text.text, '2 posts hidden by your filters');
assert.strictEqual(out1[1].sortIndex, '101');
// A page whose only kept posts were already shown also gets one, with an id of its own.
runFeed(feedPage(withSort(tweet('b1'), 0)), 'c1');
let out2 = runFeed(feedPage(withSort(tweet('b1'), 0), withSort(tweet('b2'), 1), withSort(repost('b3'), 2)), 'c2');
assert.ok(out2.some((e) => /dmhidden/.test(e.entryId)) === false, 'b2 is new: no placeholder');
let out3 = runFeed(feedPage(withSort(tweet('b1'), 0), withSort(tweet('b2'), 1)), 'c3');
const ph3 = out3.find((e) => /dmhidden/.test(e.entryId));
assert.ok(ph3, 'nothing new: placeholder');
assert.strictEqual(ph3.content.itemContent.tweet_results.result.tombstone.text.text, 'No new posts on this page');
let out4 = runFeed(feedPage(withSort(tweet('b1'), 0), withSort(tweet('b2'), 1)), 'c4');
assert.notStrictEqual(out4.find((e) => /dmhidden/.test(e.entryId)).entryId, ph3.entryId, 'each placeholder is new');
// Third page in a row with nothing unseen: the feed has ended, no placeholder.
let out5 = runFeed(feedPage(withSort(tweet('b1'), 0)), 'c5');
assert.ok(!out5.some((e) => /dmhidden/.test(e.entryId)), 'ended after three dry pages');
// Something new resets that; a fresh load (no cursor) starts over.
runFeed(feedPage(withSort(repost('n1'), 0)), 'c6');
let out7 = runFeed(feedPage(withSort(tweet('b1'), 0)), null);
assert.ok(!out7.some((e) => /dmhidden/.test(e.entryId)), 'fresh load: b1 is new again');
// Repeats don't count towards "hidden".
runFeed(feedPage(withSort(repost('h1'), 0), withSort(tweet('h2'), 1)), 'c3b');
const outRepeat = runFeed(feedPage(withSort(repost('h1'), 0), withSort(repost('h3'), 1)), 'c3c');
assert.strictEqual(outRepeat.find((e) => /dmhidden/.test(e.entryId)).content.itemContent.tweet_results.result.tombstone.text.text, '1 post hidden by your filters');
// Pages with something new and visible: untouched.
const someLeft = runFeed(mixed(), 'c8');
assert.ok(!someLeft.some((e) => /dmhidden/.test(e.entryId)));
});

test("always Recent: the Following request is rewritten to enableRanking: false", () => {
// Always Recent: the Following timeline request is rewritten to enableRanking: false; nothing else changes.
const popularURL = 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=' + encodeURIComponent(JSON.stringify({ count: 20, enableRanking: true, cursor: 'xyz' })) + '&features=%7B%7D';
const rewritten = new URL(window.__dmRecentOnly(popularURL));
assert.deepStrictEqual(JSON.parse(rewritten.searchParams.get('variables')), { count: 20, enableRanking: false, cursor: 'xyz' });
assert.strictEqual(rewritten.searchParams.get('features'), '{}');
const recentURL = 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=' + encodeURIComponent('{"enableRanking":false}');
assert.strictEqual(window.__dmRecentOnly(recentURL), recentURL, 'already Recent: untouched');
assert.strictEqual(window.__dmRecentOnly('https://x.com/i/api/graphql/abc/TweetDetail?variables=%7B%7D'), 'https://x.com/i/api/graphql/abc/TweetDetail?variables=%7B%7D');
const recentXHR = new XMLHttpRequest();
recentXHR.open('GET', popularURL);
assert.ok(/enableRanking%22%3Afalse|enableRanking":false/.test(recentXHR.__dmUrl), 'XHR open rewrites to Recent');
});

test("post pages: Show probable spam goes; Show more replies stays", () => {
// Post pages: "Show probable spam" goes; "Show more replies" stays.
const spamCursor = { entryId: 'cursor-showmorethreads-7', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTimelineCursor', cursorType: 'ShowMoreThreads', value: 'v', displayTreatment: { actionText: 'Show probable spam' } } } };
const promptCursor = { entryId: 'cursor-showmorethreadsprompt-8', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTimelineCursor', cursorType: 'ShowMoreThreadsPrompt', value: 'w' } } };
const moreCursor = { entryId: 'cursor-showmorethreads-9', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTimelineCursor', cursorType: 'ShowMoreThreads', value: 'x', displayTreatment: { actionText: 'Show more replies' } } } };
const spamPage = { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries: [tweet('sp'), spamCursor, promptCursor, moreCursor] }] } } };
assert.deepStrictEqual(JSON.parse(window.__dmFilterTimeline(JSON.stringify(spamPage), detailURL('sp'))).data.threaded_conversation_with_injections_v2.instructions[0].entries.map((e) => e.entryId),
  ['tweet-sp', 'cursor-showmorethreads-9']);
});

test('out of the box every kind of post is off (the plainest timeline)', () => {
const source = fs.readFileSync(MOD, 'utf8');
const literal = /const options = (\{[^}]*\});/.exec(source);
assert.ok(literal, 'the defaults are one object literal');
const defaults = Function(`return ${literal[1]}`)();
assert.ok(Object.keys(defaults).length >= 9);
for (const [key, on] of Object.entries(defaults)) assert.equal(on, false, key);
});

test("the page's own UI keeps its styles", () => {
// The page's own UI keeps its styles (they were once lost in an edit).
const source = fs.readFileSync(MOD, 'utf8');
for (const selector of ['#placeholder::after', 'header[role=banner] h1 a[href="/home"] > div::after', '.dm-search {', 'html[data-dm-explore]', '.dm-unfollowed {', '.dm-unfollowed:not([data-open]) .dm-threads', '.dm-reply img.av', '.dm-filters {', '.dm-menu {', '[data-dm-placeholder] article']) {
  assert.ok(source.includes(selector), `stylesheet has ${selector}`);
}
});

test("a feed page with a post type Detox Timeline doesn't know is let through, not emptied", () => {
const renamed = (id) => ({ entryId: `tweet-${id}`, content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelinePost', tweet_results: { result: { rest_id: id } } } } });
const page = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [renamed('r1'), renamed('r2'), whoToFollow, cursor] }] } } } };
const out = window.__dmFilterTimeline(JSON.stringify(page), 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables={"cursor":"c9"}');
assert.strictEqual(out, JSON.stringify(page));
assert.match(window.__dmFilterStats.at(-1).passedThrough, /no post of a known type; new types: TimelinePost/);
// A page of known non-posts only (say, just a who-to-follow block) is still cleaned as usual.
const junkOnly = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [whoToFollow, cursor] }] } } } };
const kept = JSON.parse(window.__dmFilterTimeline(JSON.stringify(junkOnly))).data.home.home_timeline_urt.instructions[0].entries.map((e) => e.entryId);
assert.ok(!kept.includes('who-to-follow-1') && kept.includes('cursor-bottom-1'), kept.join());
});

test("XHR with parsed JSON: filtered on a copy; if filtering fails, X gets its data as it was", () => {
const xhr = new XMLHttpRequest();
xhr.open('GET', 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=1');
const parsed = JSON.parse(JSON.stringify(data));
Object.assign(xhr, { readyState: 4, status: 200, _text: parsed });
assert.deepStrictEqual(xhr.response.data.home.home_timeline_urt.instructions[1].entries.map((e) => e.entryId), ['tweet-1', 'tweet-7', 'cursor-bottom-1']);
assert.strictEqual(parsed.data.home.home_timeline_urt.instructions[1].entries.length, 10, 'X\'s own object untouched');
const broken = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [tweet('b1'), null] }] } } } };
const bad = new XMLHttpRequest();
bad.open('GET', 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=1');
Object.assign(bad, { readyState: 4, status: 200, _text: broken });
assert.strictEqual(bad.response, broken);
});

test("a reused XHR filters its new response, not the last one again", () => {
const xhr = new XMLHttpRequest();
xhr.open('GET', 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=1');
Object.assign(xhr, { readyState: 4, status: 200, _text: JSON.stringify(data) });
assert.deepStrictEqual(ids(xhr.responseText), ['tweet-1', 'tweet-7', 'cursor-bottom-1']);
xhr.open('GET', 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=2');
const second = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries: [tweet('n1'), cursor] }] } } } };
Object.assign(xhr, { _text: JSON.stringify(second) });
assert.deepStrictEqual(ids(xhr.responseText), ['tweet-n1', 'cursor-bottom-1']);
});

test("fetch: responses with no body (204, 304…) come back untouched; others filtered", async () => {
const url = 'https://x.com/i/api/graphql/abc/HomeLatestTimeline?variables=1';
const empty = new Response(null, { status: 204 });
fetchImpl = async () => empty;
assert.strictEqual(await window.fetch(url), empty);
fetchImpl = async () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const res = await window.fetch(url);
assert.deepStrictEqual(ids(await res.text()), ['tweet-1', 'tweet-7', 'cursor-bottom-1']);
fetchImpl = async () => { throw new Error('unused'); };
});
