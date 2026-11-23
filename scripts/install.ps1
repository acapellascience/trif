# Installs TRIF @@VERSION@@ on Windows 10 (1803 or newer) or 11, with no Node.js needed (docs/NO-NODE.md,
# docs/WINDOWS.md). In PowerShell:
#
#   irm <this file's URL> | iex
#   & ([scriptblock]::Create((irm <this file's URL>))) --browser edge      (setup's options after it)
#
# It downloads TRIF's own copy of Node (node.exe, from nodejs.org's .zip for this computer) and TRIF's
# package, checks both against the SHA-256 written below, then runs TRIF's setup with that node.exe, which
# takes over from there (it keeps Node in the workspace, %USERPROFILE%\.trif\runtime, and writes the
# browsers' connections and the trif command). Nothing is installed for other users, nothing needs an
# administrator, and the Node.js you may already have (and your PATH's node) is left alone.
#
# The template is scripts/install.ps1 in TRIF's repo; scripts/release.js fills in the placeholders for each
# release (installScriptWindows) and, once the package GitHub serves is the one pinned here, writes the result
# into site/src/install-windows.js, which timsrobot.com/install.ps1 serves (never a file on a release). Needs only Windows PowerShell 5.1 (every
# Windows 10 and 11 has it) and Windows' own tar.exe. Everything is inside one script block, run at its
# end: a download that's cut off doesn't parse, so it runs nothing. It never calls `exit` (under `iex`
# that would close the PowerShell window it was typed in): a problem is said, and it stops.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $TrifVersion = '@@VERSION@@'
  $PackageUrl = '@@PACKAGE_URL@@'
  $PackageSha256 = '@@PACKAGE_SHA256@@'
  $NodeVersion = '@@NODE_VERSION@@'
  $NodeBase = '@@NODE_BASE@@'
  # <platform> <archive> <sha256>, from helper/runtime.json (Windows' .zip archives).
  $NodeArchives = @'
@@NODE_ARCHIVES@@
'@

  function Say($text) { [Console]::Error.WriteLine($text) }
  function Stop-Install($text) { throw "TRIF install: $text" }
  # A program, with what it writes to stderr shown as it is: Windows PowerShell 5.1 turns a native program's
  # stderr into errors when its own is redirected, and 'Stop' would end the install on the first line.
  function Invoke-Program($exe, [string[]]$arguments) {
    $ErrorActionPreference = 'Continue'
    & $exe @arguments
  }

  # win-x64 or win-arm64: the computer's own architecture (an x64 PowerShell on an Arm computer still
  # gets Arm's node.exe).
  function Get-Platform {
    $arch = $null
    try { $arch = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture } catch { }
    if (-not $arch) { $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE } }
    switch -Regex ($arch) {
      '^arm64$' { return 'win-arm64' }
      '^(x64|amd64)$' { return 'win-x64' }
      default { Stop-Install "there's no TRIF for Windows on $arch" }
    }
  }

  # Downloads $Url to $File and checks its SHA-256 is $Sha256; nothing downloaded is used otherwise.
  # (https only, as the helper's updates; plain http only to this computer, for tests.) .NET's own classes,
  # not Invoke-WebRequest and Get-FileHash: a Windows PowerShell started from PowerShell 7 can be handed 7's
  # module folders, where those two don't load (seen on GitHub's runners).
  function Save-Checked($Url, $File, $Sha256) {
    if ($Url -notmatch '^https://' -and $Url -notmatch '^http://(127\.0\.0\.1|localhost):\d+/') { Stop-Install "refusing to download $Url (https only)" }
    $web = New-Object System.Net.WebClient
    try {
      $web.DownloadFile($Url, $File)
    } catch {
      Stop-Install "couldn't download ${Url}: $($_.Exception.Message)"
    } finally {
      $web.Dispose()
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($File)
    try { $got = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) } finally { $stream.Dispose(); $sha.Dispose() }
    if ($got -ne $Sha256) {
      [System.IO.File]::Delete($File)
      Stop-Install "the download of $(Split-Path -Leaf $Url) doesn't match its pinned checksum (got $got); not using it"
    }
  }

  function Install-Trif([string[]]$SetupArgs) {
    if (-not $SetupArgs) { $SetupArgs = @() }
    if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { Stop-Install 'this installer is for Windows: on macOS or Linux, use install.sh' }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tar)) { Stop-Install "needs Windows' own tar.exe (Windows 10 1803 or newer)" }
    # (Windows 10's .NET may not offer TLS 1.2 unless asked)
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $key = Get-Platform
    $file = $null
    $sum = $null
    foreach ($line in ($NodeArchives -split "`r?`n")) {
      $f = @($line.Trim() -split '\s+')
      if ($f.Count -eq 3 -and $f[0] -eq $key) { $file = $f[1]; $sum = $f[2]; break }
    }
    if (-not $file) { Stop-Install "there's no TRIF for $key" }
    $top = $file -replace '\.zip$', ''

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('trif-install-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $hadArchive = Test-Path Env:TRIF_RUNTIME_ARCHIVE
    $oldArchive = $env:TRIF_RUNTIME_ARCHIVE
    try {
      Say "Downloading Node $NodeVersion for TRIF..."
      $zip = Join-Path $tmp $file
      Save-Checked ($NodeBase + $file) $zip $sum
      $nodeDir = Join-Path $tmp 'node'
      New-Item -ItemType Directory -Path $nodeDir | Out-Null
      # (only node.exe: the .zip holds npm's ~2000 files beside it)
      # (tar.exe runs in the temporary folder with relative names: it takes its arguments in the console's
      # code page, so a profile folder with an accent in its name would reach it garbled)
      Push-Location -LiteralPath $tmp
      try { Invoke-Program $tar @('-xf', $file, '-C', 'node', "$top/node.exe") } finally { Pop-Location }
      if ($LASTEXITCODE -ne 0) { Stop-Install "couldn't unpack $file" }
      $node = Join-Path $nodeDir "$top\node.exe"
      $v = $null
      try { $v = Invoke-Program $node @('--version') } catch { }
      if ("$v".Trim() -ne "v$NodeVersion") { Stop-Install "the downloaded Node doesn't run on this computer ($v)" }

      Say "Downloading TRIF $TrifVersion..."
      $tgz = Join-Path $tmp 'trif.tgz'
      Save-Checked $PackageUrl $tgz $PackageSha256
      $pkg = Join-Path $tmp 'pkg'
      New-Item -ItemType Directory -Path $pkg | Out-Null
      Push-Location -LiteralPath $tmp
      try { Invoke-Program $tar @('-xzf', 'trif.tgz', '-C', 'pkg') } finally { Pop-Location }
      if ($LASTEXITCODE -ne 0) { Stop-Install "couldn't unpack TRIF's package" }
      $cli = Join-Path $pkg 'package\helper\cli.js'
      if (-not (Test-Path -LiteralPath $cli)) { Stop-Install "TRIF's package has no helper in it" }

      # Setup keeps TRIF's Node from the archive just checked (TRIF_RUNTIME_ARCHIVE: no second download).
      $env:TRIF_RUNTIME_ARCHIVE = $zip
      Invoke-Program $node (@($cli, 'setup', '--copy') + $SetupArgs)
      if ($LASTEXITCODE -ne 0) { Say "TRIF install: setup reported a problem (code $LASTEXITCODE): see above." }
    } finally {
      if ($hadArchive) { $env:TRIF_RUNTIME_ARCHIVE = $oldArchive } else { Remove-Item Env:TRIF_RUNTIME_ARCHIVE -ErrorAction SilentlyContinue }
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  try {
    Install-Trif $args
  } catch {
    $m = $_.Exception.Message
    Say $(if ($m -like 'TRIF install: *') { $m } else { "TRIF install: $m" })
  }
} @args
