// The no-Node installer for Windows that timsrobot.com/install.ps1 serves (index.js):
// `irm https://timsrobot.com/install.ps1 | iex` in PowerShell. Made by scripts/release.js (installModuleWindows)
// for each release from scripts/install.ps1, once the package as GitHub serves it is the one the script pins:
// that release's package and TRIF's own node.exe .zip, each pinned by SHA-256 in the script (the .zip's checked
// against nodejs.org's SHASUMS256.txt first), which checks both before it runs anything. It changes only with a
// commit here and a deploy of the site, never with a file uploaded to a GitHub release.
// null: no release has made one yet, and the address is a 404.
export const INSTALL_PS1_VERSION = null;
export const INSTALL_PS1 = null;
