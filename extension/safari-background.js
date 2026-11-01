// The Safari build's background script: the Safari adapter first (it provides chrome.userScripts and
// chrome.runtime.connectNative), then the usual background.
import './safari.js';
import './background.js';
