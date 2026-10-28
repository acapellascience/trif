// ==WebMod==
// @name        Plain X
// @description Home is just the people you follow, filtered (no ads, reposts or recommendations); a plainer X around it
// @match       https://x.com/*
// @match       https://twitter.com/*
// @run-at      document-start
// ==/WebMod==

/*
 * Plain X: Home is just the people you follow, filtered; recommendations go elsewhere too.
 *
 * - Timeline filter. The home timeline's data (the `HomeLatestTimeline` / `HomeTimeline` GraphQL
 *   responses) is filtered before X sees it. Ads and who-to-follow-style modules always go; reposts,
 *   quote posts, posts with links, long posts (over 280 characters), posts with videos and posts with
 *   images go when their toggle is off (reposts are off by default). Replies covers replies shown on
 *   their own (to someone else or to oneself). Conversations covers blocks of two or more posts shown
 *   together (a back-and-forth, or someone's own thread): a block shows only if Conversations is on, its
 *   top post is by someone you follow (or you), and every post in it passes the other toggles. Filtering
 *   the data rather than hiding posts on screen matters because X's list is virtualised (absolutely
 *   positioned rows), so hidden rows would leave gaps.
 * - Filters menu. "Filters ⌄" at the right of the header opens a menu styled like X's own Following
 *   menu, with a checkmark on each kind of post that's shown. Choices are kept in localStorage
 *   (`dmFeedOptions`); when the menu closes after a change, the page reloads so the timeline is fetched
 *   (and filtered) again.
 * - Following, Recent. The Following tab is selected whenever another is, and every feed request is
 *   rewritten to Recent (`enableRanking: false`; Popular re-serves pages and filters badly). The whole tab
 *   bar is hidden (For you, Following, pinned lists, "Manage timelines"), leaving just the Filters menu.
 * - Chrome. X's own navigation stays (the side bar, or the bottom bar in narrow windows), so all of X
 *   is reachable. The right column (trends, who to follow, Premium) is hidden, and the main column fills
 *   the space. Home keeps X's composer at the top.
 * - Posts open as X's own post page (replies, reply box, likes); its back arrow returns to the feed.
 *   Its data (`TweetDetail`) is filtered too, but only for what's algorithmic: ads, "Discover more"
 *   (related posts) and who-to-follow-style cards. The toggles don't apply to replies.
 * - Plain X's logo (a plain lowercase x) replaces X's: in the side bar, on the search page, and on the
 *   loading screen.
 * - Search is just a search field. Explore (trends, news, For You…) is replaced with one centered
 *   field; pressing Return opens X's results page.
 * - YouTube plays in place. Clicking a YouTube link card (X's "player" card) swaps it for YouTube's
 *   embedded player, instead of opening YouTube in a new tab.
 * - Profiles lose their "Who to follow" blocks and ads (the profile timelines' data is cleaned the
 *   same way as post pages'); nothing else on them is filtered.
 * - Replies, followed first. Reply threads with anyone you follow in them (or you, or the post's
 *   author) stay in X's list. The rest are taken out of the data and shown below it in a collapsed
 *   "Replies from people you don't follow" section rendered by this script (X's virtualised list can't
 *   take a section of its own); clicking one opens it as a post page.
 *
 * Debugging: `webmods run 'window.__dmFilterStats'` shows, for the last 20 timeline responses, what the
 * filter saw, kept and why it dropped the rest.
 *
 * WebMods port: this is the page script of the Plain X macOS app (XFeedGuard.swift), unchanged except
 * for comments. It never depended on the native app (no window.webkit message handlers, no native
 * routing); it ran as a WKUserScript at document start, the same timing as here. Notes marked
 * "WebMods port" below are the only edits.
 */

(() => {
  // (WebMods port: the hostname check repeats the @match lines; the flag stops a second copy running.)
  if (window.__dmGuard || !/(^|\.)(x|twitter)\.com$/.test(location.hostname)) return;
  window.__dmGuard = true;

  // ---- Options (true = show).
  const OPTIONS_KEY = 'dmFeedOptions';
  const OPTION_LABELS = { reposts: 'Reposts', quotes: 'Quotes', replies: 'Replies', conversations: 'Conversations', long: 'Long', links: 'Links', videos: 'Videos', images: 'Images' };
  const options = { reposts: false, quotes: true, replies: true, conversations: true, long: true, links: true, videos: true, images: true };
  try { Object.assign(options, JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')); } catch {}
  for (const key of Object.keys(options)) if (!(key in OPTION_LABELS)) delete options[key];   // e.g. the old "threads"

  // ---- Timeline filter.
  // The feed, post pages, and a profile's timelines (UserOriginalsTimeline, UserTweets, UserMedia, Likes…).
  const TIMELINE = /\/graphql\/[^/]+\/(HomeLatestTimeline|HomeTimeline|TweetDetail|User\w*Timeline|UserTweets\w*|UserMedia|UserHighlightsTweets|UserArticlesTweets|Likes)\b/;
  const JUNK_ENTRY = /^(promoted|who-to-follow|who-to-subscribe|trends|explore|community|messageprompt|relevanceprompt|stories|grok|tweetdetailrelatedtweets|related)/i;
  const JUNK_ITEM_TYPES = ['TimelineUser', 'TimelinePrompt', 'TimelineMessagePrompt', 'TimelineTrend'];
  const tweetOf = (result) => (result?.__typename === 'TweetWithVisibilityResults' ? result.tweet : result);
  const mediaTypes = (tweet) => {
    const legacy = tweet?.legacy || {};
    const own = (legacy.extended_entities?.media || legacy.entities?.media || []).map((m) => m.type);
    const quoted = tweetOf(tweet?.quoted_status_result?.result);
    return quoted && quoted !== tweet ? own.concat(mediaTypes(quoted)) : own;
  };
  // A reply, to someone else or to oneself (continuing a thread).
  const isReply = (tweet) => !!tweet?.legacy?.in_reply_to_status_id_str;
  // Links to other sites (not links to posts, which is how quotes are attached), in the post, its
  // long-post text or link card, or in a quoted post.
  const hasLink = (tweet) => {
    if (!tweet) return false;
    const urls = (tweet.legacy?.entities?.urls || [])
      .concat(tweet.note_tweet?.note_tweet_results?.result?.entity_set?.urls || []);
    const external = urls.some((u) => !/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i.test(u.expanded_url || ''));
    const quoted = tweetOf(tweet.quoted_status_result?.result);
    return external || !!tweet.card || (quoted && quoted !== tweet && hasLink(quoted));
  };
  // Over 280 characters: X sends the full text of long posts separately (note_tweet).
  const isLong = (tweet) => {
    const text = tweet?.note_tweet?.note_tweet_results?.result?.text;
    if (text) return [...text].length > 280;
    const range = tweet?.legacy?.display_text_range;
    return Array.isArray(range) && range[1] - range[0] > 280;
  };
  const tweetIn = (content) => tweetOf(content?.itemContent?.tweet_results?.result);
  // You follow the post's author, or it's yours.
  const followsAuthor = (tweet) => {
    const user = tweet?.core?.user_results?.result;
    const id = tweet?.legacy?.user_id_str || user?.rest_id;
    return !!(user?.relationship_perspectives?.following || user?.legacy?.following)
      || (!!id && id === (String(document.cookie || '').match(/(?:^|;\s*)twid=u%3D(\d+)/) || [])[1]);
  };
  // The reason a post is filtered out (for the debug stats), or '' to keep it. `inConversation`: a post
  // in a conversation block, which the Conversations toggle covers instead of Replies.
  const isUnwanted = (content, inConversation = false) => {
    const tweet = tweetIn(content);
    if (!tweet) return '';
    // A repost, when shown, is judged by the post it reposts (a reposted reply, video, link…).
    const reposted = tweetOf(tweet.legacy?.retweeted_status_result?.result);
    if (tweet.legacy?.retweeted_status_result) {
      if (!options.reposts) return 'repost';
      const why = reposted ? isUnwanted({ itemContent: { tweet_results: { result: reposted } } }, inConversation) : '';
      return why && `repost:${why}`;
    }
    if (!options.quotes && (tweet.legacy?.is_quote_status || tweet.quoted_status_result)) return 'quote';
    if (!inConversation && !options.replies && isReply(tweet)) return 'reply';
    if (!options.long && isLong(tweet)) return 'long';
    if (!options.links && hasLink(tweet)) return 'link';
    const media = mediaTypes(tweet);
    if (!options.videos && media.some((t) => t === 'video' || t === 'animated_gif')) return 'video';
    if (!options.images && media.includes('photo')) return 'image';
    return '';
  };
  let reasons = {};
  const why = (content) => {
    const item = content?.itemContent;
    const reason = !content ? 'empty' : item?.promotedMetadata ? 'ad' : JUNK_ITEM_TYPES.includes(item?.itemType) ? item.itemType
      : item && !['TimelineTweet', 'TimelineTimelineCursor'].includes(item.itemType) ? `type:${item.itemType}` : isUnwanted(content) || 'kept?';
    reasons[reason] = (reasons[reason] || 0) + 1;
  };
  // `home`: the feed, where the toggles apply and anything but posts goes. On a post page only
  // ads and recommendation cards go; "Show more replies" and the like stay.
  const isJunk = (content, home) => {
    const item = content?.itemContent;
    if (!content || item?.promotedMetadata || JUNK_ITEM_TYPES.includes(item?.itemType)) return true;
    if (!home) return false;
    return (item && !['TimelineTweet', 'TimelineTimelineCursor'].includes(item.itemType)) || isUnwanted(content);
  };
  // "Show probable spam" (and X's "may contain offensive content" variant) on post pages.
  const isSpamPrompt = (content) => {
    const cursor = content?.itemContent?.itemType === 'TimelineTimelineCursor' ? content.itemContent
      : content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor' ? content : null;
    return !!cursor && /probable spam|offensive|ShowMoreThreadsPrompt/i.test(JSON.stringify(cursor));
  };
  const idOf = (content) => { const t = tweetIn(content); return t?.rest_id || t?.legacy?.id_str || null; };
  const cleanEntries = (entries, home) => entries.filter((entry) => {
    if (JUNK_ENTRY.test(entry.entryId || '')) return false;
    if (!home && isSpamPrompt(entry.content)) return false;
    const content = entry.content;
    // In the feed, remember what's kept: X shows a post only once, so a later block that repeats it
    // shows without it.
    // (A repost shows the post it reposts, so that counts as shown too.)
    const keep = (contents) => {
      if (home) contents.forEach((c) => {
        const tweet = tweetIn(c), inner = tweetOf(tweet?.legacy?.retweeted_status_result?.result);
        for (const t of [tweet, inner]) { const id = t?.rest_id || t?.legacy?.id_str; if (id) feed.shown.add(id); }
      });
      return true;
    };
    if (Array.isArray(content?.items)) {
      if (home) {
        content.items = content.items.filter((i) => !i.item?.itemContent?.promotedMetadata);
        // Posts already shown higher up are hidden by X in this block (a reply then reads "Replying
        // to @…" on its own), so judge the block by what's left.
        content.items = content.items.filter((i) => !tweetIn(i.item) || !feed.shown.has(idOf(i.item)));
        const posts = content.items.filter((i) => tweetIn(i.item));
        // A conversation: two or more posts shown together (a back-and-forth, or someone's own
        // thread). It's kept or dropped as one: only if Conversations is on, it starts with a post by
        // someone you follow (or you), and every post passes the toggles.
        if (posts.length >= 2) {
          const count = (reason) => { reasons[reason] = (reasons[reason] || 0) + 1; return false; };
          if (!options.conversations) return count('conversation');
          if (!followsAuthor(tweetIn(posts[0].item))) return count('conversation:unfollowed-top');
          const failed = posts.map((i) => isUnwanted(i.item, true)).find(Boolean);
          return failed ? count(`conversation:${failed}`) : keep(posts.map((i) => i.item));
        }
        // One post left: it's a standalone post (a lone reply goes with Replies off).
        content.items = content.items.filter((i) => !JUNK_ENTRY.test(i.entryId || '') && !isJunk(i.item, home));
        return content.items.length > 0 && keep(content.items.map((i) => i.item));
      }
      content.items = content.items.filter((i) => !JUNK_ENTRY.test(i.entryId || '') && !isJunk(i.item, home) && !isSpamPrompt(i.item));
      return content.items.length > 0;
    }
    if (!content?.itemContent) return true;   // cursors and the like stay
    return !isJunk(content, home) && keep([content]);
  });
  // ---- Replies from people you don't follow, held back from a post page's data (see below).
  // Kept per post: going back to a post shows X's cached copy, without asking for its data again.
  const unfollowed = { posts: {}, version: 0 };
  const heldFor = (focal) => (unfollowed.posts[focal] ||= { author: null, threads: [] });
  const me = () => (String(document.cookie || '').match(/(?:^|;\s*)twid=u%3D(\d+)/) || [])[1];
  const authorOf = (tweet) => tweet?.legacy?.user_id_str || tweet?.core?.user_results?.result?.rest_id;
  const isFollowed = (tweet) => {
    const user = tweet?.core?.user_results?.result;
    const id = authorOf(tweet);
    return !!(user?.relationship_perspectives?.following || user?.legacy?.following)
      || (id && (id === me() || id === currentAuthor));
  };
  let currentAuthor = null;
  const holdBackUnfollowed = (instructions, focal) => {
    if (!focal) return;
    const post = heldFor(focal);
    for (const instruction of instructions) {
      const entries = instruction.entries || [];
      const focalEntry = entries.find((e) => e.entryId === `tweet-${focal}`);
      if (focalEntry) post.author = authorOf(tweetIn(focalEntry.content)) || post.author;
    }
    currentAuthor = post.author;
    for (const instruction of instructions) {
      if (Array.isArray(instruction.entries)) {
        instruction.entries = instruction.entries.filter((entry) => {
          if (!/^conversationthread-/.test(entry.entryId || '')) return true;
          // Stays in X's list if anyone in it is someone you follow (or you, or the post's author): a
          // stranger's reply that someone you follow answered belongs with the followed replies, and
          // taking it out of X's data would also leave X without that conversation when you open it.
          const tweets = (entry.content?.items || []).map((i) => tweetIn(i.item)).filter(Boolean);
          if (!tweets.length || tweets.some(isFollowed) || tweets.some((t) => (t.rest_id || t.legacy?.id_str) === focal)) return true;
          const thread = { id: entry.entryId, tweets };
          const i = post.threads.findIndex((t) => t.id === entry.entryId);   // fetched again: replace
          if (i >= 0) post.threads[i] = thread; else post.threads.push(thread);
          return false;
        });
      }
      // More of a held-back thread: add it to the section instead.
      const held = post.threads.find((t) => t.id === instruction.moduleEntryId);
      if (held && Array.isArray(instruction.moduleItems)) {
        held.tweets.push(...instruction.moduleItems.map((i) => tweetIn(i.item)).filter(Boolean));
        instruction.moduleItems = [];
      }
    }
    unfollowed.version++;
  };

  // X only loads the next page of the feed when the end of its list moves. A page that adds nothing
  // new (all filtered away, or all posts X already shows: Popular re-serves pages) leaves the list as
  // it was, so scrolling just stops at the end (and an empty first page shows X's "Welcome to X!"
  // screen). Such pages get a placeholder at the bottom, "N posts hidden by your filters" (an X
  // tombstone, styled as one slim line), with an id of its own so the list always grows. After three
  // pages in a row with nothing unseen at all, the feed really has ended and no placeholder is added.
  const feed = { seen: new Set(), shown: new Set(), dryPages: 0, placeholders: 0 };
  const keepTimelineGoing = (original, kept) => {
    const isPostEntry = (e) => e.content?.itemContent?.itemType === 'TimelineTweet' || Array.isArray(e.content?.items);
    const posts = original.filter((e) => isPostEntry(e) && !/^promoted/.test(e.entryId || ''));
    const unseen = new Set(posts.map((e) => e.entryId).filter((id) => !feed.seen.has(id)));
    posts.forEach((e) => feed.seen.add(e.entryId));
    if (kept.some((e) => isPostEntry(e) && unseen.has(e.entryId))) { feed.dryPages = 0; return; }
    if (!posts.length) return;
    if (unseen.size === 0 && ++feed.dryPages >= 3) return;
    if (unseen.size) feed.dryPages = 0;
    // Count only posts not seen before: Popular re-serves the same ones page after page.
    const hidden = posts.filter((e) => !kept.includes(e) && unseen.has(e.entryId)).length;
    const bottom = kept.find((e) => /^cursor-bottom/.test(e.entryId || ''));
    let sortIndex;
    try { sortIndex = bottom?.sortIndex ? String(BigInt(bottom.sortIndex) + 1n) : undefined; } catch {}
    const placeholder = {
      entryId: `tweet-dmhidden-${++feed.placeholders}-${Date.now()}`,
      sortIndex: sortIndex ?? posts.at(-1).sortIndex,
      content: {
        entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet', __typename: 'TimelineTweet',
          tweet_results: { result: { __typename: 'TweetTombstone', tombstone: { __typename: 'TextTombstone',
            text: { rtl: false, text: hidden
              ? `${hidden} ${hidden === 1 ? 'post' : 'posts'} hidden by your filters`
              : 'No new posts on this page', entities: [] } } } },
        },
      },
    };
    const at = kept.indexOf(bottom);
    kept.splice(at >= 0 ? at : kept.length, 0, placeholder);
  };

  // What the filter saw and kept, per response (for debugging; the last 20).
  const stats = window.__dmFilterStats = [];
  const describe = (entries) => (entries || []).map((e) => {
    const item = e.content?.itemContent;
    return `${(e.entryId || '').replace(/\d{6,}/g, 'N')}:${e.content?.entryType || e.content?.__typename || '?'}/${item?.itemType || (e.content?.items ? `module${e.content.items.length}` : '-')}`;
  });

  // A GraphQL request's variables: in the URL (GET), or in a JSON body (X sends later feed pages as POSTs).
  const requestVariables = (url, body) => {
    try {
      if (typeof body === 'string' && body.trim().startsWith('{')) return JSON.parse(body).variables || {};
      return JSON.parse(new URL(url, location.href).searchParams.get('variables') || '{}');
    } catch { return {}; }
  };

  const filterData = (data, url, body) => {
    const variables = requestVariables(url, body);
    const home = data?.data?.home?.home_timeline_urt?.instructions;
    // A profile's timelines: only ads and recommendations go (as on post pages). Their layout varies by
    // request, so find the instructions list wherever it is.
    const findInstructions = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 7) return null;
      if (Array.isArray(node.instructions)) return node;
      for (const value of Object.values(node)) { const found = findInstructions(value, depth + 1); if (found) return found; }
      return null;
    };
    const userTimeline = data?.data?.user ? findInstructions(data.data.user) : null;
    // A fresh load of the feed (no cursor) starts over.
    if (home && !variables.cursor) Object.assign(feed, { seen: new Set(), shown: new Set(), dryPages: 0 });
    const instructions = home || data?.data?.threaded_conversation_with_injections_v2?.instructions || userTimeline?.instructions;
    const before = (instructions || []).flatMap((i) => describe(i.entries));
    reasons = {};
    const beforeIds = (instructions || []).flatMap((i) => (i.entries || []).map((e) => e.entryId));
    if (!instructions && url) stats.push({ op: String(url).split('?')[0].split('/').pop(), keys: Object.keys(data?.data || {}) });
    for (const instruction of instructions || []) {
      if (Array.isArray(instruction.entries)) {
        const original = instruction.entries;
        instruction.entries = cleanEntries(original, !!home);
        if (home) for (const e of original) if (!instruction.entries.includes(e) && e.content?.itemContent) why(e.content);
        if (home) keepTimelineGoing(original, instruction.entries);
      }
      if (instruction.entry && JUNK_ENTRY.test(instruction.entry.entryId || '')) delete instruction.entry;
      // More of a module (e.g. more "Discover more" posts) arrives as TimelineAddToModule.
      if (Array.isArray(instruction.moduleItems)) {
        instruction.moduleItems = JUNK_ENTRY.test(instruction.moduleEntryId || '') ? []
          : instruction.moduleItems.filter((i) => !JUNK_ENTRY.test(i.entryId || '') && !isJunk(i.item, !!home));
      }
    }
    // After the ads are gone, so none end up in the unfollowed section.
    if (!home && instructions && variables.focalTweetId) holdBackUnfollowed(instructions, variables.focalTweetId);
    if (instructions) {
      const cursor = variables.cursor || null;
      stats.push({ op: String(url || '').split('?')[0].split('/').pop(), cursor: cursor && cursor.slice(-12), reasons,
        ids: beforeIds, kept: instructions.flatMap((i) => (i.entries || []).map((e) => e.entryId)),
        modules: instructions.flatMap((i) => (i.entries || []).filter((e) => Array.isArray(e.content?.items)).map((e) => ({
          entryId: e.entryId,
          items: e.content.items.map((x) => { const t = tweetIn(x.item); return t ? `${t.rest_id}@${t.core?.user_results?.result?.core?.screen_name}${t.legacy?.in_reply_to_status_id_str ? '>' + t.legacy.in_reply_to_status_id_str : ''}` : x.entryId; }),
        }))),
        before, after: instructions.flatMap((i) => describe(i.entries)) });
      if (stats.length > 20) stats.shift();
    }
    return data;
  };
  const filterText = (text, url, body) => {
    try { return JSON.stringify(filterData(JSON.parse(text), url, body)); } catch { return text; }
  };
  window.__dmFilterTimeline = filterText;   // for tests
  window.__dmFeedOptions = options;
  window.__dmUnfollowed = unfollowed;

  // Following, sorted Recent: X's Popular sort is the same request with enableRanking: true.
  const FOLLOWING = /\/graphql\/[^/]+\/HomeLatestTimeline\b/;
  const recentOnly = (url) => {
    if (!FOLLOWING.test(url)) return url;
    try {
      const u = new URL(url, location.href);
      const variables = JSON.parse(u.searchParams.get('variables') || '{}');
      if (variables.enableRanking === false) return url;
      variables.enableRanking = false;
      u.searchParams.set('variables', JSON.stringify(variables));
      return u.href;
    } catch { return url; }
  };
  const recentBody = (body) => {
    if (typeof body !== 'string' || !body.trim().startsWith('{')) return body;
    try {
      const json = JSON.parse(body);
      if (!json.variables || json.variables.enableRanking === false) return body;
      json.variables.enableRanking = false;
      return JSON.stringify(json);
    } catch { return body; }
  };
  window.__dmRecentOnly = recentOnly;   // for tests
  window.__dmRecentBody = recentBody;

  const fetch0 = window.fetch;
  window.fetch = async function (input, init) {
    if (typeof input === 'string' && FOLLOWING.test(input)) {
      arguments[0] = input = recentOnly(input);
      if (init?.body) arguments[1] = init = { ...init, body: recentBody(init.body) };
    }
    const response = await fetch0.apply(this, arguments);
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!TIMELINE.test(url) || !response.ok) return response;
    const text = filterText(await response.text(), url, init?.body);
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__dmTimeline = TIMELINE.test(String(url));
    if (FOLLOWING.test(String(url))) arguments[1] = url = recentOnly(String(url));
    this.__dmUrl = String(url);
    this.__dmFollowing = FOLLOWING.test(String(url));
    return open.apply(this, arguments);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__dmFollowing) arguments[0] = body = recentBody(body);
    if (this.__dmTimeline) this.__dmBody = body;
    return send.apply(this, arguments);
  };
  const textGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get;
  const responseGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response').get;
  const filtered = (xhr) => {
    if (xhr.__dmFiltered === undefined) {
      const raw = responseGetter.call(xhr);
      xhr.__dmFiltered = typeof raw === 'string' ? filterText(raw, xhr.__dmUrl, xhr.__dmBody)
        : raw && typeof raw === 'object' && !(raw instanceof Blob) && !(raw instanceof ArrayBuffer) ? filterData(raw, xhr.__dmUrl, xhr.__dmBody) : raw;
    }
    return xhr.__dmFiltered;
  };
  const isDone = (xhr) => xhr.__dmTimeline && xhr.readyState === 4 && xhr.status >= 200 && xhr.status < 300;
  Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
    configurable: true,
    get() { return isDone(this) && typeof responseGetter.call(this) === 'string' ? filtered(this) : textGetter.call(this); },
  });
  Object.defineProperty(XMLHttpRequest.prototype, 'response', {
    configurable: true,
    get() { return isDone(this) ? filtered(this) : responseGetter.call(this); },
  });

  // ---- Chrome.
  const style = document.createElement('style');
  style.textContent = `
    [data-testid=sidebarColumn] { display: none !important; }
    /* X's side bar sits right-aligned in a column that stretches; keep the column to the bar's width. */
    header[role=banner] { flex-grow: 0 !important; }
    [data-dm-hide] { display: none !important; }
    /* Plain X's logo, a plain lowercase x, in place of X's. The loading screen (#placeholder, in X's HTML)
       is styled before it's parsed; its theme isn't known yet, so the x inverts whatever is behind it. */
    #placeholder > svg { visibility: hidden !important; }
    #placeholder::after { content: "x"; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -56%);
      font: 400 96px/1 -apple-system, system-ui, sans-serif; color: #fff; mix-blend-mode: difference; pointer-events: none; }
    header[role=banner] h1 a[href="/home"] svg { visibility: hidden !important; }
    header[role=banner] h1 a[href="/home"] { position: relative; }
    header[role=banner] h1 a[href="/home"]::after { content: "x"; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -56%);
      font: 400 42px/1 -apple-system, system-ui, sans-serif; color: var(--dm-fg, rgb(231, 233, 234)); pointer-events: none; }
    /* The timeline fills the window instead of sitting in a 600px column on the left. */
    main[role=main] > div, main[role=main] > div > div, main[role=main] > div > div > div { width: 100% !important; max-width: none !important; }
    [data-testid=primaryColumn] { max-width: none !important; border-right: none !important; border-left: none !important; }
    [data-dm-wide] { max-width: none !important; }
    /* Explore: X's page hidden, a centered search field instead. */
    /* Hidden from the first frame (the flag is set as the route changes, before X draws anything). */
    html[data-dm-explore] [data-testid=primaryColumn], html[data-dm-explore] main[role=main] > * { visibility: hidden !important; }
    .dm-search { position: fixed; z-index: 2; top: 0; bottom: 0; right: 0; left: var(--dm-nav-width, 88px);
      background: var(--dm-bg, #000); display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 28px; padding: 0 24px 18vh; box-sizing: border-box; }
    html:not([data-dm-explore]) .dm-search { display: none !important; }
    .dm-search .logo { font: 400 88px/0.7 -apple-system, system-ui, sans-serif; color: var(--dm-fg); padding-bottom: 12px; }
    .dm-search form { width: 100%; max-width: 584px; position: relative; }
    .dm-search input { width: 100%; box-sizing: border-box; height: 48px; padding: 0 20px 0 48px; border-radius: 24px;
      border: 1px solid var(--dm-search-border); background: var(--dm-search-bg); color: var(--dm-fg); outline: none;
      font: 16px TwitterChirp, -apple-system, system-ui, sans-serif; }
    .dm-search input:hover, .dm-search input:focus { box-shadow: var(--dm-search-shadow); border-color: transparent; }
    .dm-search form svg { position: absolute; left: 17px; top: 14px; width: 20px; height: 20px; fill: rgb(113, 118, 123); pointer-events: none; }
    /* A YouTube card swapped for the player (X's own card is hidden, not removed, so React keeps its DOM). */
    [data-dm-yt] > :not(.dm-yt) { display: none !important; }
    .dm-yt { width: 100%; aspect-ratio: 16 / 9; background: #000; }
    .dm-yt iframe { width: 100%; height: 100%; border: 0; display: block; }
    /* "N posts hidden by your filters" (an X tombstone): it only has to exist, so X's list grows and X
       loads the next page; it takes no space. (X re-measures rows, so an empty one leaves no gap.) */
    [data-dm-placeholder] > * { display: none !important; }
    [data-dm-placeholder] article { padding: 6px 16px !important; }
    [data-dm-merged] > *, [data-dm-straggler] > * { display: none !important; }
    [data-dm-placeholder] article * { background: transparent !important; border-color: transparent !important; padding: 0 !important;
      margin: 0 !important; min-height: 0 !important; font-size: 13px !important; line-height: 16px !important; text-align: center; }
    [data-dm-tabs] { display: flex !important; flex-direction: row !important; align-items: center !important; }
    [data-dm-tabs] > nav { flex: 0 0 auto !important; order: 1; }
    [data-dm-tabs] > .dm-filters { order: 2; }
    /* Above X's rows: pulled up under the last reply, it sits where X's empty, invisible end rows are. */
    .dm-unfollowed { position: relative; z-index: 1; border-top: 1px solid rgba(128, 128, 128, .3); font: 15px/1.35 TwitterChirp, -apple-system, system-ui, sans-serif; }
    .dm-unfollowed > button { all: unset; box-sizing: border-box; width: 100%; padding: 16px; cursor: pointer; color: rgb(29, 155, 240); display: flex; gap: 8px; align-items: center; }
    .dm-unfollowed > button:hover { background: rgba(128, 128, 128, .08); }
    .dm-unfollowed .chev { display: inline-block; transition: transform .15s; }
    .dm-unfollowed[data-open] .chev { transform: rotate(90deg); }
    .dm-unfollowed:not([data-open]) .dm-threads { display: none; }
    .dm-thread { border-top: 1px solid rgba(128, 128, 128, .3); }
    .dm-reply { display: flex; gap: 10px; padding: 12px 16px; cursor: pointer; }
    .dm-reply:hover { background: rgba(128, 128, 128, .06); }
    .dm-reply + .dm-reply { padding-top: 4px; }
    .dm-reply img.av { width: 40px; height: 40px; border-radius: 50%; flex: none; }
    .dm-reply .body { min-width: 0; flex: 1; }
    .dm-reply .who { color: rgb(113, 118, 123); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dm-reply .who b { color: var(--dm-fg, inherit); }
    .dm-reply .text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
    .dm-reply .media { display: flex; gap: 4px; margin-top: 8px; }
    .dm-reply .media img { max-height: 120px; max-width: 45%; border-radius: 12px; object-fit: cover; }
    .dm-filters { margin-left: auto; align-self: stretch; display: flex; min-height: 53px; }
    .dm-filters > button { all: unset; display: flex; align-items: center; gap: 4px; padding: 0 16px; cursor: pointer;
      font: 700 15px/20px TwitterChirp, -apple-system, system-ui, sans-serif; color: var(--dm-fg); }
    .dm-filters > button:hover { background: var(--dm-hover); }
    .dm-filters > button svg, .dm-menu svg { fill: currentColor; }
    .dm-filters > button svg { width: 16px; height: 16px; color: rgb(113, 118, 123); }
    .dm-menu { position: fixed; z-index: 10000; min-width: 180px; max-width: 384px; border-radius: 12px; overflow: hidden;
      background: var(--dm-menu-bg); box-shadow: var(--dm-menu-shadow); font: 700 15px/20px TwitterChirp, -apple-system, system-ui, sans-serif; }
    .dm-menu [role=menuitemcheckbox] { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 12px 16px;
      height: 44px; box-sizing: border-box; cursor: pointer; color: var(--dm-fg); }
    .dm-menu [role=menuitemcheckbox]:hover { background: var(--dm-hover); }
    .dm-menu [role=menuitemcheckbox] svg { width: 20px; height: 20px; color: rgb(29, 155, 240); visibility: hidden; }
    .dm-menu [aria-checked=true] svg { visibility: visible; }
  `;
  (document.head || document.documentElement).append(style);

  // ---- The "Replies from people you don't follow" section under a post's replies.
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (date) => {
    const s = (Date.now() - new Date(date)) / 1000;
    return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h`
      : new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const replyText = (tweet) => {
    const legacy = tweet.legacy || {};
    let text = tweet.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '';
    const range = legacy.display_text_range;
    if (!tweet.note_tweet && Array.isArray(range)) text = [...text].slice(range[0], range[1]).join('');
    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    for (const u of legacy.entities?.urls || []) if (u.url) text = text.split(u.url).join(u.display_url || u.expanded_url || '');
    return text;
  };
  const renderReply = (tweet) => {
    const user = tweet.core?.user_results?.result || {};
    const name = user.core?.name || user.legacy?.name || '';
    const handle = user.core?.screen_name || user.legacy?.screen_name || '';
    const avatar = user.avatar?.image_url || user.legacy?.profile_image_url_https || '';
    const media = (tweet.legacy?.extended_entities?.media || []).map((m) => m.media_url_https).filter((u) => /^https:/.test(u || ''));
    const href = `/${encodeURIComponent(handle || 'i')}/status/${encodeURIComponent(tweet.rest_id || tweet.legacy?.id_str || '')}`;
    return `<div class="dm-reply" data-href="${esc(href)}">` +
      (avatar ? `<img class="av" src="${esc(avatar.replace('_normal.', '_bigger.'))}" alt="">` : '') +
      `<div class="body"><div class="who"><b>${esc(name)}</b> @${esc(handle)} · ${esc(ago(tweet.legacy?.created_at))}</div>` +
      `<div class="text">${esc(replyText(tweet))}</div>` +
      (media.length ? `<div class="media">${media.slice(0, 4).map((u) => `<img src="${esc(u)}?name=small" alt="">`).join('')}</div>` : '') +
      `</div></div>`;
  };
  // Opens a post through X's own router (no reload), falling back to a normal navigation.
  const openPost = (href) => {
    history.pushState({}, '', href);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    setTimeout(() => { if (location.pathname === href && !document.querySelector('[data-testid=primaryColumn] article')) location.assign(href); }, 1500);
  };
  let rendered = { focal: null, version: -1 };
  const showUnfollowed = () => {
    const focal = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
    const threads = focal ? unfollowed.posts[focal]?.threads || [] : [];
    let box = document.querySelector('.dm-unfollowed');
    if (!threads.length) { box?.remove(); return; }
    const section = document.querySelector('[data-testid=primaryColumn] section');
    if (!section) return;
    if (!box || box.previousElementSibling !== section) {
      box?.remove();
      box = document.createElement('div');
      box.className = 'dm-unfollowed';
      box.innerHTML = '<button type="button"><span class="chev">›</span><span class="label"></span></button><div class="dm-threads"></div>';
      box.firstChild.addEventListener('click', () => box.toggleAttribute('data-open'));
      box.addEventListener('click', (e) => {
        const reply = e.target.closest('.dm-reply');
        if (reply) { e.preventDefault(); e.stopPropagation(); openPost(reply.dataset.href); }
      });
      section.after(box);
      rendered = { focal: null, version: -1 };
    }
    // X keeps the reply list taller than its replies (a fixed minimum height and an empty cell at
    // the end). When that end cell is on screen (the list is virtualised, so it may not be), pull
    // the section up to just under the last reply, unless more replies are still loading.
    const list = section.querySelector('div[style*="min-height"]');
    let pull = 0;
    if (list) {
      const top = list.getBoundingClientRect().top;
      const cells = [...list.children].map((c) => ({ c, bottom: c.getBoundingClientRect().bottom - top }));
      const end = cells.reduce((a, b) => (b.bottom > (a?.bottom ?? -1) ? b : a), null);
      // The last row with anything in it (a reply, or one of X's buttons such as "Show more replies").
      const lastContent = Math.max(0, ...cells.filter(({ c }) => c.querySelector('article, [role=button], button') || c.innerText.trim())
        .map(({ bottom }) => bottom));
      if (end && !end.c.querySelector('article, [role=progressbar], [role=button], button') && !end.c.innerText.trim() && lastContent > 0) {
        pull = Math.max(0, list.getBoundingClientRect().height - lastContent);
      }
    }
    box.style.marginTop = pull ? `-${Math.round(pull)}px` : '';
    // X colours text per element, so pick the theme's text colour from its background.
    const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
    box.style.color = r * 0.3 + g * 0.59 + b * 0.11 < 128 ? 'rgb(231, 233, 234)' : 'rgb(15, 20, 25)';
    if (rendered.focal === focal && rendered.version === unfollowed.version) return;
    rendered = { focal, version: unfollowed.version };
    const count = threads.length;
    box.querySelector('.label').textContent = `${count} ${count === 1 ? 'reply' : 'replies'} from people you don’t follow`;
    box.querySelector('.dm-threads').innerHTML = threads
      .map((t) => `<div class="dm-thread">${t.tweets.map(renderReply).join('')}</div>`).join('');
  };

  // ---- The Filters menu, at the right of the tab bar, styled like X's Following menu.
  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.543 8.96l1.414-1.42L12 14.59l7.043-7.05 1.414 1.42L12 17.41 3.543 8.96z"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z"/></svg>';
  // X's light and dark themes, picked from the page background.
  const applyTheme = () => {
    const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
    const dark = r * 0.3 + g * 0.59 + b * 0.11 < 128;
    const root = document.documentElement.style;
    root.setProperty('--dm-bg', `rgb(${r}, ${g}, ${b})`);
    root.setProperty('--dm-fg', dark ? 'rgb(231, 233, 234)' : 'rgb(15, 20, 25)');
    root.setProperty('--dm-hover', dark ? 'rgba(231, 233, 234, 0.1)' : 'rgba(15, 20, 25, 0.1)');
    root.setProperty('--dm-menu-bg', dark ? 'rgb(20, 20, 20)' : 'rgb(255, 255, 255)');
    root.setProperty('--dm-search-bg', dark ? 'rgb(32, 35, 39)' : 'rgb(255, 255, 255)');
    root.setProperty('--dm-search-border', dark ? 'rgb(47, 51, 54)' : 'rgb(223, 225, 229)');
    root.setProperty('--dm-search-shadow', dark ? '0 1px 6px rgba(0, 0, 0, 0.6)' : '0 1px 6px rgba(32, 33, 36, 0.28)');
    root.setProperty('--dm-menu-shadow', dark
      ? 'rgba(0, 0, 0, 0.5) 0px 4px 12px 0px, rgba(0, 0, 0, 0.35) 0px 0px 2px 0px, rgba(255, 255, 255, 0.12) 0px 0px 0px 1px'
      : 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px');
  };
  let menu = null, openedWith = '';
  const closeMenu = () => {
    if (!menu) return;
    menu.remove(); menu = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    if (JSON.stringify(options) !== openedWith) location.reload();   // only if something really changed
  };
  const outside = (e) => { if (menu && !menu.contains(e.target) && !e.target.closest?.('.dm-filters')) closeMenu(); };
  const escape = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
  const openMenu = (button) => {
    applyTheme();
    openedWith = JSON.stringify(options);
    menu = document.createElement('div');
    menu.className = 'dm-menu';
    menu.setAttribute('role', 'menu');
    for (const [key, label] of Object.entries(OPTION_LABELS)) {
      const item = document.createElement('div');
      item.setAttribute('role', 'menuitemcheckbox');
      item.setAttribute('aria-checked', String(options[key]));
      item.innerHTML = `<span>${label}</span>${CHECK}`;
      item.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        options[key] = !options[key];
        item.setAttribute('aria-checked', String(options[key]));
        try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch {}
      });
      menu.append(item);
    }
    document.body.append(menu);
    const b = button.getBoundingClientRect();
    menu.style.top = `${Math.round(b.bottom + 4)}px`;
    menu.style.right = `${Math.max(8, Math.round(innerWidth - b.right + 8))}px`;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
  };
  const filtersButton = () => {
    const wrap = document.createElement('div');
    wrap.className = 'dm-filters';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu');
    button.innerHTML = `<span>Filters</span>${CHEVRON}`;
    button.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (menu) closeMenu(); else openMenu(button);
    });
    wrap.append(button);
    applyTheme();
    return wrap;
  };

  // Back-to-back placeholders read as one line with their combined count. (X measures each row, so
  // emptying the later ones closes them up rather than leaving gaps.)
  const mergePlaceholders = () => {
    const list = document.querySelector('[data-testid=primaryColumn] section [data-testid=cellInnerDiv]')?.parentElement;
    if (!list) return;
    const rows = [...list.children]
      .map((c) => ({ c, top: parseFloat((c.style.transform.match(/translateY\(([-\d.]+)px\)/) || [])[1]) }))
      .filter((r) => !Number.isNaN(r.top))
      .sort((a, b) => a.top - b.top)
      .map((r) => r.c)
      .filter((c) => c.hasAttribute('data-dm-placeholder') || c.querySelector('article, [role=progressbar]'));   // skip empty separators
    let head = null, total = 0;
    const finish = () => {
      if (!head) return;
      const span = [...head.querySelectorAll('span')].reverse().find((sp) => /hidden by your filters|No new posts/.test(sp.textContent));
      const label = total ? `${total} ${total === 1 ? 'post' : 'posts'} hidden by your filters` : 'No new posts on this page';
      if (span && span.textContent !== label) span.textContent = label;
    };
    for (const row of rows) {
      if (!row.hasAttribute('data-dm-placeholder')) { finish(); head = null; total = 0; continue; }
      const n = Number(row.dataset.dmHidden || 0);
      if (head) { if (!row.hasAttribute('data-dm-merged')) row.setAttribute('data-dm-merged', ''); }
      else { head = row; row.removeAttribute('data-dm-merged'); }
      total += n;
    }
    finish();
  };

  // A safety net after X has drawn the feed. X regroups conversations across pages (a post shown in a
  // later block is taken out of an earlier one), so a block can end up as a lone reply the data filter
  // couldn't foresee. With Replies off, any reply X shows on its own (standalone, or alone in its
  // block) has its row emptied; X re-measures rows, so this leaves no gap.
  const fiberOf = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactFiber$'))];
  const entryOf = (cell) => { let f = fiberOf(cell); for (let i = 0; f && i < 25; i++, f = f.child) if (f.memoizedProps?.entry) return f.memoizedProps.entry; return null; };
  const tweetOfArticle = (article) => { let f = fiberOf(article); for (let i = 0; f && i < 40; i++, f = f.return) if (f.memoizedProps?.tweet) return f.memoizedProps.tweet; return null; };
  const hideStragglers = () => {
    const list = document.querySelector('[data-testid=primaryColumn] section [data-testid=cellInnerDiv]')?.parentElement;
    if (!list) return;
    const rows = [...list.children].map((cell) => ({
      cell, top: parseFloat((cell.style.transform.match(/translateY\(([-\d.]+)px\)/) || [])[1]),
      article: cell.querySelector('article[data-testid=tweet]'),
    })).filter((r) => r.article && !Number.isNaN(r.top)).sort((a, b) => a.top - b.top);
    rows.forEach((r) => { r.entry = entryOf(r.cell); });
    rows.forEach((r, i) => {
      const pos = r.entry?.conversationPosition;
      const nextPos = rows[i + 1]?.entry?.conversationPosition;
      const alone = !pos || (pos.isStart && (!nextPos || nextPos.isStart));
      const tweet = alone && !options.replies ? tweetOfArticle(r.article) : null;
      const straggler = !!tweet?.in_reply_to_status_id_str && !tweet.retweeted_status;
      if (straggler !== r.cell.hasAttribute('data-dm-straggler')) r.cell.toggleAttribute('data-dm-straggler', straggler);
    });
  };

  // ---- Explore becomes a plain search field. Return opens X's results page through its own router.
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"/></svg>';
  const X_LOGO = '<div class="logo" aria-hidden="true">x</div>';   // Plain X's logo
  // A layer of its own over the main area, so it shows at once without waiting for X's page.
  const showSearch = () => {
    const explore = /^\/explore(\/|$)/.test(location.pathname);
    document.documentElement.toggleAttribute('data-dm-explore', explore);
    let box = document.querySelector('.dm-search');
    if (!explore) { box?.remove(); return; }
    const nav = document.querySelector('header[role=banner]');
    document.documentElement.style.setProperty('--dm-nav-width', `${nav ? Math.round(nav.getBoundingClientRect().right) : 0}px`);
    if (box || !document.body) return;
    applyTheme();
    box = document.createElement('div');
    box.className = 'dm-search';
    box.innerHTML = `${X_LOGO}<form role="search"><input type="search" name="q" placeholder="Search" autocomplete="off" spellcheck="false" aria-label="Search">${SEARCH_ICON}</form>`;
    box.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = box.querySelector('input').value.trim();
      if (!q) return;
      history.pushState({}, '', `/search?q=${encodeURIComponent(q)}&src=typed_query`);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    document.body.append(box);
    setTimeout(() => box.querySelector('input')?.focus(), 50);
  };
  // Flip the Explore flag the moment the route changes, not after X has drawn the page.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function () { const result = original.apply(this, arguments); showSearch(); return result; };
  }
  addEventListener('popstate', showSearch);
  if (/^\/explore(\/|$)/.test(location.pathname)) document.documentElement.setAttribute('data-dm-explore', '');
  addEventListener('DOMContentLoaded', showSearch);
  addEventListener('resize', showSearch);

  // ---- YouTube cards play in place. X's player card for a YouTube link has the embed URL in its
  // binding values; clicking the card would otherwise open YouTube in a new tab. (WebMods port: the app's
  // comment said "open the browser"; the code is unchanged.)
  const youtubeEmbed = (tweet) => {
    const card = tweet?.card;
    const values = card?.binding_values || card?.legacy?.binding_values || {};
    const value = (k) => (Array.isArray(values) ? values.find((v) => v.key === k)?.value : values[k])?.string_value;
    const player = value('player_url');
    if (!player) return null;
    try {
      const u = new URL(player);
      if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(u.hostname) || !u.pathname.startsWith('/embed/')) return null;
      u.searchParams.set('autoplay', '1');
      u.searchParams.set('rel', '0');
      return u.href;
    } catch { return null; }
  };
  document.addEventListener('click', (e) => {
    const wrapper = e.target.closest?.('[data-testid="card.wrapper"]');
    if (!wrapper || wrapper.hasAttribute('data-dm-yt')) return;
    const embed = youtubeEmbed(tweetOfArticle(wrapper.closest('article')));
    if (!embed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const box = document.createElement('div');
    box.className = 'dm-yt';
    const frame = document.createElement('iframe');
    frame.src = embed;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    box.append(frame);
    wrapper.append(box);
    wrapper.setAttribute('data-dm-yt', '');
  }, true);

  // ---- Following tab, and hiding what's left around the timeline.
  const hide = (el) => { if (el && !el.hasAttribute('data-dm-hide')) el.setAttribute('data-dm-hide', ''); };
  const tidy = () => {
    // X caps the timeline (and a post's replies) at 600px a few wrappers in; lift any such cap.
    const column = document.querySelector('[data-testid=primaryColumn]');
    for (let el = column?.querySelector('section'); el && el !== column; el = el.parentElement) {
      if (!el.hasAttribute('data-dm-wide') && getComputedStyle(el).maxWidth !== 'none') el.setAttribute('data-dm-wide', '');
    }
    showUnfollowed();
    showSearch();
    if (!location.pathname.startsWith('/home')) return;
    for (const article of document.querySelectorAll('[data-testid=cellInnerDiv] article:not([data-testid=tweet])')) {
      const cell = article.closest('[data-testid=cellInnerDiv]');
      const text = article.textContent.trim();
      if (!cell.hasAttribute('data-dm-placeholder') && /(hidden by your filters|No new posts on this page)$/.test(text)) {
        cell.setAttribute('data-dm-placeholder', '');
        cell.dataset.dmHidden = String(parseInt(text, 10) || 0);
      }
    }
    mergePlaceholders();
    hideStragglers();
    const tabs = [...document.querySelectorAll('[data-testid=primaryColumn] [role=tab]')];
    const following = tabs.find((t) => /^Following\b/.test(t.textContent.trim()));
    if (following && following.getAttribute('aria-selected') !== 'true') following.click();
    const nav = following?.closest('nav');
    if (nav) {
      hide(nav);   // no tabs at all: it's always Following, Recent
      const row = nav.parentElement;
      const manage = row.parentElement?.querySelector('[aria-label="Manage timelines"]');
      if (manage) hide([...row.parentElement.children].find((c) => c.contains(manage)) || manage);
      row.setAttribute('data-dm-tabs', '');
      if (!row.querySelector(':scope > .dm-filters')) row.append(filtersButton());
    }
  };
  let queued = false;
  new MutationObserver(() => {
    if (!queued) { queued = true; setTimeout(() => { queued = false; tidy(); }, 100); }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
