'use strict';
// web-ext's config file for release.js's signing step (`web-ext sign --config scripts/web-ext-amo.cjs`):
// the addons.mozilla.org API key and secret, read from the keychain here, inside web-ext's own process.
// So they're in no process's arguments or environment, which any process of the same user can read while
// signing runs (minutes). Nothing is written to disk. A missing item is left out: web-ext then says which
// option it needs (release.js checks both are there before it starts).

const { keychain, AMO_ISSUER, AMO_SECRET } = require('./release');

const sign = {};
const issuer = keychain(AMO_ISSUER);
const secret = keychain(AMO_SECRET);
if (issuer) sign.apiKey = issuer;
if (secret) sign.apiSecret = secret;

module.exports = { sign };
