// The sandbox's page-wide rules, as data (docs/SAFE-MODS.md "Across mods: the page-wide rules"): one definition
// for the sandbox, which refuses by it (extension/sandbox.js partnersOk, clickOk, signalOk, arrivedOk, soundOk), and
// the helper, which asks the user to approve, for a site, the combinations its boxed mods' powers make together
// (helper/lib/sitecombos.js reads the JSON between the markers). tests/combinations.test.js keeps it in step with
// the table, and tests/sitecombos.test.js checks, for random sets of a site's mods, that the sandbox refuses
// exactly the pairs the site hasn't approved, and that approving what the holds asked lets every act through.
//
// - actPartners: an act (a power a mod uses), and the powers it's refused beside while another boxed mod on the
//   page has one of them and the acting mod doesn't (@migrate counts as site-storage; edit-uploads as a read: a
//   mod that was handed a picture the user attached).
// - alsoRefused: refused beside another mod that changed a draft (write-drafts) or an attached picture
//   (edit-uploads), or whose go-to brought the user to this page (go-to), unless the acting mod has that power.
// - channelOnly: acts refused only beside a mod they share a `mods` channel with (both have the mods power).
// A site's approval of the pair (helper/lib/sitecombos.js) lifts each of these refusals on that site.

/* page-wide rules: JSON from here */
export const PAGE_WIDE = {
  "actPartners": {
    "write-drafts": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads"],
    "click": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads", "rewrite-requests", "block-events"],
    "media": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads"],
    "go-to": ["site-storage", "block-events", "page-events", "click"],
    "page-events": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads", "rewrite-requests", "block-events"],
    "edit-uploads": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants"],
    "image-variants": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "edit-uploads"],
    "preload": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "edit-uploads"],
    "site-storage": ["read-drafts", "keys", "site-data", "page-data", "local-fonts", "image-variants", "edit-uploads", "go-to"],
    "block-events": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads"],
    "embeds": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads"],
    "sound": ["read-drafts", "keys", "site-data", "page-data", "site-storage", "local-fonts", "image-variants", "edit-uploads"]
  },
  "alsoRefused": {"click": ["write-drafts", "edit-uploads", "go-to"], "page-events": ["write-drafts", "edit-uploads", "go-to"]},
  "channelOnly": ["sound"]
};
/* page-wide rules: JSON to here */
