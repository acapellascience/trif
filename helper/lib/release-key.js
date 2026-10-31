'use strict';
// The public half of the release signing key (Ed25519, PEM). Updates are installed only when the release
// feed is signed with the matching private key, which lives only in the maintainer's keychain
// (`node scripts/release.js keygen` creates the pair and rewrites this file). null: no key yet, so this
// build never installs updates.
module.exports = null;
