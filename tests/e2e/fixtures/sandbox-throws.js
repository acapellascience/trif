// ==WebMod==
// @name        E2E Sandboxed mod that throws
// @match       *://127.0.0.1/sandbox.html*
// @sandboxed
// ==/WebMod==
throw new Error('thrown at the top of a sandboxed mod');
