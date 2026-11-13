// Registered while the extension runs (scripting.registerContentScripts), for the page's own world at its start.
globalThis.__trifProbeDyn = { readyState: document.readyState, pageRan: document.documentElement.getAttribute('data-page-ran') };
