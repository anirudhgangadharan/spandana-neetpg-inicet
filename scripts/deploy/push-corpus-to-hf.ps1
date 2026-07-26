<#
.SYNOPSIS
  Publish the built corpus to a Hugging Face *dataset* repo, so a Git-based host
  can download it at build time.

.DESCRIPTION
  A dataset repo, not a Space - datasets are free, need no payment method, and
  are designed for large files. Only the three build artefacts go here; no
  application code.

  Creates a scratch git repo in a temp directory rather than touching this one,
  because the project repo deliberately git-ignores `data/build/`.

.PARAMETER Repo
  Dataset repo id, as "<your-hf-username>/<repo-name>".

.EXAMPLE
  .\scripts\deploy\push-corpus-to-hf.ps1 -Repo medtachdev/medmcqa-corpus
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$Repo,

  # Hugging Face username. Defaults to the owner part of -Repo.
  [string]$User,

  # WRITE token from https://huggingface.co/settings/tokens
  # Omit it and you'll be prompted securely (nothing lands in shell history).
  [string]$Token
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path "$PSScriptRoot\..\..").Path

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

if ($Repo -notmatch '^[^/]+/[^/]+$') {
  Fail "Repo must look like '<username>/<repo-name>'. Got: $Repo"
}

Step 'Checking the corpus has been built'
$files = @('corpus.sqlite', 'manifest.json', 'facets.json')
foreach ($f in $files) {
  $p = Join-Path $projectRoot "data\build\$f"
  if (-not (Test-Path $p)) { Fail "data/build/$f is missing. Run: pnpm data:build" }
}
$corpusPath = Join-Path $projectRoot 'data\build\corpus.sqlite'
$size = [math]::Round((Get-Item $corpusPath).Length / 1MB, 1)
Write-Host "    corpus.sqlite  $size MB"

git lfs version | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'git-lfs is not installed. See https://git-lfs.com' }

# ---- scratch repo ----------------------------------------------------------
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "medmcqa-corpus-$(Get-Random)"
Step "Staging in $staging"
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
  Set-Location $staging
  git init -b main | Out-Null
  git lfs install --local | Out-Null

  # LFS must be active BEFORE the corpus is staged, or Hugging Face rejects the
  # push: it refuses non-LFS files over 10 MB.
  '*.sqlite filter=lfs diff=lfs merge=lfs -text' | Set-Content -Encoding ascii '.gitattributes'
  git add .gitattributes
  git commit -m 'Track *.sqlite with Git LFS' | Out-Null

  Step 'Copying build artefacts'
  foreach ($f in $files) { Copy-Item (Join-Path $projectRoot "data\build\$f") $staging }

  # A short card so the dataset repo explains itself to anyone who finds it.
  @"
---
license: apache-2.0
---

# MedMCQA practice corpus (build artefact)

Build output of the ETL in
[medmcqa-practice](https://github.com/). Not the original dataset - this is a
normalised, validated SQLite build of it, published here only so a Git-based
host can download it at deploy time (it is too large for a Git repository).

| File | Purpose |
|---|---|
| ``corpus.sqlite`` | 186,791 questions + FTS5 index |
| ``manifest.json`` | Build metadata, counts, and the answer-key checksum |
| ``facets.json`` | Subject/topic counts |

The application verifies ``manifest.json``'s ``answerKeyHash`` against the
database at startup and refuses to serve questions if they disagree, so a
corrupted or substituted download fails closed rather than showing wrong answers.

Source data: MedMCQA (Pal, Umapathi & Sankarasubbu, PMLR v174, 2022) -
<https://github.com/medmcqa/medmcqa>, Apache-2.0.

**Not clinical guidance.** Exam-preparation material containing known errata.
"@ | Set-Content -Encoding utf8 'README.md'

  git add -A

  $attr = git check-attr filter -- corpus.sqlite
  if ($attr -notmatch 'filter: lfs') { Fail "corpus.sqlite is not tracked by LFS ($attr)." }
  Write-Host '    corpus.sqlite -> LFS pointer OK'

  git commit -m 'Publish MedMCQA practice corpus build artefacts' | Out-Null

  $remoteUrl = "https://huggingface.co/datasets/$Repo"
  git remote add origin $remoteUrl
  Write-Host "    remote -> $remoteUrl"

  # ---- credentials ---------------------------------------------------------
  # Windows Git Credential Manager caches per-host credentials and will happily
  # reuse a stale one WITHOUT prompting, which surfaces as Hugging Face's
  # "Password authentication is no longer supported" error even when you have a
  # perfectly good token. So GCM is bypassed for this push: `credential.helper=`
  # (empty) clears every inherited helper, and the token is supplied inline for
  # this one command only. Nothing is written to disk or to the credential store.
  if (-not $User) { $User = $Repo.Split('/')[0] }
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

  # Creating a repo through the Hugging Face web UI seeds it with a starter
  # commit (a README and .gitattributes). This script builds its history from
  # scratch in a temp directory, so the two are unrelated and a plain push is
  # rejected as a non-fast-forward. Detect that up front rather than failing.
  #
  # Overwriting is the correct semantic here: this is a single-purpose build
  # artefact repo that this script owns, and the starter commit holds nothing
  # worth keeping. It is NOT the behaviour you would want against a repo with
  # real history, which is why it is detected explicitly and announced.
  $pushArgs = @()
  $remoteHead = git -c credential.helper= -c credential.helper=$helper ls-remote --heads origin main
  if ($LASTEXITCODE -eq 0 -and $remoteHead) {
    Write-Host "    remote already has a 'main' branch (the starter commit) - replacing it" -ForegroundColor Yellow
    $pushArgs = @('--force')
  }

  Step "Pushing ~$size MB as '$User' (a few minutes)"
  git -c credential.helper= -c credential.helper=$helper push @pushArgs origin main
  if ($LASTEXITCODE -ne 0) {
    Fail @"
Push failed.

  * 401/403      -> the token lacks WRITE access, or it belongs to a different
                    account than '$User'.
  * 404          -> the dataset repo does not exist yet. Create it at
                    https://huggingface.co/new-dataset (make it Public).
  * still asking
    for a password -> a cached credential is interfering. Clear it with:
                    cmdkey /delete:git:https://huggingface.co
"@
  }

  $base = "https://huggingface.co/datasets/$Repo/resolve/main"
  Write-Host "`nDone." -ForegroundColor Green
  Write-Host "`nYour CORPUS_BASE_URL is:" -ForegroundColor Green
  Write-Host "  $base"
  Write-Host "`nSanity-check it downloads (should print 'SQLite format 3'):"
  Write-Host "  curl -sL $base/corpus.sqlite | head -c 15"
}
finally {
  Set-Location $projectRoot
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
