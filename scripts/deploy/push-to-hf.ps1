<#
.SYNOPSIS
  Publish this app to a Hugging Face Space (Docker SDK).

.DESCRIPTION
  Handles the two things that are easy to get wrong by hand:

    1. `.gitattributes` must be committed BEFORE the 243 MB corpus is added, or
       Git stores it as a normal blob and Hugging Face rejects the push (it
       refuses non-LFS files over 10 MB).
    2. `data/build/` is git-ignored on purpose - it is regenerable build output.
       The corpus has to be force-added for the deploy, which this does
       explicitly rather than by weakening .gitignore for everyone.

.PARAMETER Space
  The Space id, as "<your-hf-username>/<space-name>".

.EXAMPLE
  .\scripts\deploy\push-to-hf.ps1 -Space anirudh/medmcqa-practice
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$Space,

  # Hugging Face username. Defaults to the owner part of -Space.
  [string]$User,

  # WRITE token from https://huggingface.co/settings/tokens
  # Omit it and you'll be prompted securely (nothing lands in shell history).
  [string]$Token,

  [string]$Branch = 'main',
  [string]$Message = 'Deploy MedMCQA practice app'
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

if ($Space -notmatch '^[^/]+/[^/]+$') {
  Fail "Space must look like '<username>/<space-name>'. Got: $Space"
}

# ---- preflight -------------------------------------------------------------
Step 'Checking the corpus has been built'
foreach ($f in @('data/build/corpus.sqlite', 'data/build/manifest.json', 'data/build/facets.json')) {
  if (-not (Test-Path $f)) { Fail "$f is missing. Run: pnpm data:build" }
}
$size = [math]::Round((Get-Item 'data/build/corpus.sqlite').Length / 1MB, 1)
Write-Host "    corpus.sqlite  $size MB"

Step 'Checking git-lfs is installed'
git lfs version | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'git-lfs is not installed. See https://git-lfs.com' }

# ---- repo ------------------------------------------------------------------
if (-not (Test-Path '.git')) {
  Step 'Initialising the git repository'
  git init -b $Branch | Out-Null
} else {
  Step 'Using the existing git repository'
  git rev-parse --abbrev-ref HEAD 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $current = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($current -ne $Branch) { git checkout -B $Branch | Out-Null }
  } else {
    git checkout -B $Branch | Out-Null
  }
}

git lfs install --local | Out-Null

# ---- .gitattributes first, so LFS is active before the corpus is staged -----
Step 'Committing .gitattributes so LFS applies to the corpus'
git add -f .gitattributes
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m 'Track *.sqlite with Git LFS' | Out-Null }

# ---- application source ----------------------------------------------------
Step 'Staging the application'
git add -A

# ---- the corpus, force-added past .gitignore -------------------------------
Step 'Staging the built corpus (force-added past .gitignore)'
git add -f data/build/corpus.sqlite data/build/manifest.json data/build/facets.json

# Guard: confirm the corpus really is an LFS pointer, not a 243 MB blob.
$attr = git check-attr filter -- data/build/corpus.sqlite
if ($attr -notmatch 'filter: lfs') {
  Fail "corpus.sqlite is not being tracked by LFS ($attr). The push would be rejected."
}
Write-Host '    corpus.sqlite -> LFS pointer OK'

Step 'Committing'
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m $Message | Out-Null } else { Write-Host '    nothing new to commit' }

# ---- remote ----------------------------------------------------------------
$remoteUrl = "https://huggingface.co/spaces/$Space"
$existing = git remote get-url space 2>$null
if ($LASTEXITCODE -eq 0) {
  if ($existing.Trim() -ne $remoteUrl) { git remote set-url space $remoteUrl }
} else {
  git remote add space $remoteUrl
}
Write-Host "    remote 'space' -> $remoteUrl"

# ---- credentials -----------------------------------------------------------
# Windows Git Credential Manager caches per-host credentials and reuses a stale
# one WITHOUT prompting, which shows up as Hugging Face's "Password
# authentication is no longer supported" error even when your token is fine. GCM
# is bypassed here: `credential.helper=` (empty) clears inherited helpers and the
# token is supplied inline for this command only. Nothing is persisted.
if (-not $User) { $User = $Space.Split('/')[0] }
if (-not $Token) {
  Write-Host "`n    Paste your Hugging Face WRITE token (input is hidden)."
  Write-Host '    Get one at https://huggingface.co/settings/tokens'
  $secure = Read-Host -AsSecureString '    Token'
  $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $Token) { Fail 'No token supplied.' }
if ($Token -notmatch '^hf_') {
  Write-Host "    WARNING: tokens normally begin with 'hf_'. Continuing anyway." -ForegroundColor Yellow
}

$helper = "!f() { echo username=$User; echo password=$Token; }; f"

# A Space created through the web UI is seeded with a starter commit, which has
# no shared history with this repo, so a plain push is rejected as a
# non-fast-forward. Replacing it is correct: the Space is a deploy target and the
# starter commit holds nothing. Detected explicitly rather than forcing blindly.
$pushArgs = @()
$remoteHead = git -c credential.helper= -c credential.helper=$helper ls-remote --heads space main
if ($LASTEXITCODE -eq 0 -and $remoteHead) {
  Write-Host "    Space already has a 'main' branch (the starter commit) - replacing it" -ForegroundColor Yellow
  $pushArgs = @('--force')
}

Step "Pushing to $Space as '$User' (uploads ~$size MB, a few minutes)"
git -c credential.helper= -c credential.helper=$helper push @pushArgs space "${Branch}:main"
if ($LASTEXITCODE -ne 0) {
  Fail @"
Push failed.

  * 401/403 -> the token lacks WRITE access, or belongs to another account.
  * 404     -> the Space does not exist yet. Create it at
               https://huggingface.co/new-space (SDK: Docker, Public).
  * cached credential interfering -> cmdkey /delete:git:https://huggingface.co
"@
}

Write-Host "`nDone. The Space is building at:" -ForegroundColor Green
Write-Host "  https://huggingface.co/spaces/$Space"
Write-Host "`nOnce the build finishes, your public link is:" -ForegroundColor Green
$appUrl = "https://$($Space.Replace('/', '-').ToLower()).hf.space"
Write-Host "  $appUrl"
Write-Host "`nCheck it is healthy with:"
Write-Host "  curl $appUrl/api/health"
