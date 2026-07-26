# Hosting this app

## The one constraint that decides everything

`data/build/corpus.sqlite` is **243 MB**. That single fact rules out most of the
obvious answers:

| Host | Card needed? | Viable? | Why |
|---|---|---|---|
| **Hugging Face Spaces** | **No** | ✅ **recommended** | Free, Docker SDK, 16 GB RAM, native large-file support via LFS. Built for exactly this. |
| Cloudflare Tunnel | No | ⚠️ stopgap | A public link in 5 minutes, but only while your PC is on. |
| Fly.io | **Yes** | ✅ | Works well, but now requires a payment method before the first deploy. |
| Railway | Yes, after trial | ✅ | CLI uploads the local directory, so the corpus never touches Git. |
| Render, Heroku, Koyeb | Varies | ❌ *as-is* | Git-based. GitHub rejects any file over 100 MB, and `train.json` (141 MB) and `corpus.sqlite` (243 MB) both exceed it. Even zipped the corpus is 103 MB — still over. |
| Vercel, Netlify, Cloudflare Workers | No | ❌ | Serverless bundles cap far below 243 MB and the filesystem is read-only. Needs a rewrite to hosted SQLite. |

You hit Fly's payment wall. **Use Hugging Face Spaces instead** — it is free, needs
no card, and is arguably a better home for this anyway since MedMCQA itself lives
on Hugging Face.

---

## Deploy to Hugging Face Spaces (free, no card)

### 1. Create an account and a token

Sign up at [huggingface.co/join](https://huggingface.co/join), then create a
**write** token at
[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). Copy
it — you'll paste it as the password when git asks.

### 2. Create the Space

Go to [huggingface.co/new-space](https://huggingface.co/new-space) and set:

- **Space name** — e.g. `medmcqa-practice`
- **Licence** — Apache 2.0
- **SDK** — **Docker** → *Blank*
- **Visibility** — **Public** (this is what makes the link shareable)

Don't add any files. The push in step 4 supplies them.

### 3. Confirm the corpus is built

```bash
pnpm data:build
```

Skip if `data/build/corpus.sqlite` already exists.

### 4. Push

```powershell
.\scripts\deploy\push-to-hf.ps1 -Space YOUR-USERNAME/medmcqa-practice
```

Enter your Hugging Face **username** and paste the **write token** as the
password when prompted.

The upload is ~243 MB, so give it a few minutes. The script handles the two
things that are easy to get wrong by hand:

- It commits `.gitattributes` **before** staging the corpus. Get that order wrong
  and git stores the 243 MB file as a normal blob, and Hugging Face rejects the
  push — it refuses non-LFS files over 10 MB.
- It force-adds `data/build/`, which is git-ignored on purpose (it is regenerable
  build output), rather than weakening `.gitignore` for everyone.

It refuses to push if the corpus is not actually an LFS pointer, so a rejected
push is caught locally instead of after a 243 MB upload.

### 5. Watch it build, then share

The Space builds automatically. Watch the log at
`https://huggingface.co/spaces/YOUR-USERNAME/medmcqa-practice`.

When it's running, your public link is:

```
https://YOUR-USERNAME-medmcqa-practice.hf.space
```

Verify it's healthy:

```bash
curl https://YOUR-USERNAME-medmcqa-practice.hf.space/api/health
```

You want `"ready": true` and `"integrity": {"ok": true}`. If integrity is false
the app deliberately serves no questions — see §3.2 of the spec.

**Anyone with that link can use it.** There is no sign-in.

> Free Spaces sleep after about 48 hours of inactivity and wake on the next
> visit, which costs a few seconds on the first request.

---

## If Hugging Face gates the Docker SDK behind a paid plan

Then the corpus and the code have to be hosted separately, because every
remaining free host deploys from Git and a 243 MB file cannot live in a Git repo.

**The split:** corpus → a Hugging Face *dataset* repo (free, no card, no Docker
involved). Code → GitHub. Host → Render, which builds a Dockerfile that
downloads the corpus.

### 1. Publish the corpus

```powershell
.\scripts\deploy\push-corpus-to-hf.ps1 -Repo YOUR-USERNAME/medmcqa-corpus
```

Create the dataset first at [huggingface.co/new-dataset](https://huggingface.co/new-dataset)
(public). The script prints your `CORPUS_BASE_URL` when it finishes — it looks like:

```
https://huggingface.co/datasets/YOUR-USERNAME/medmcqa-corpus/resolve/main
```

### 2. Push the code to GitHub

`data/build/` is already git-ignored, so the corpus is excluded automatically and
nothing exceeds GitHub's 100 MB file limit.

```powershell
git remote add origin https://github.com/YOUR-USERNAME/medmcqa-practice.git
git push -u origin main
```

### 3. Deploy on Render

At [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**
→ connect the GitHub repo, then set:

| Field | Value |
|---|---|
| Language / Runtime | **Docker** |
| Dockerfile Path | `./Dockerfile.fetch` |
| Instance Type | **Free** |
| Build argument | `CORPUS_BASE_URL` = the URL from step 1 |

`Dockerfile.fetch` downloads the three build artefacts, verifies the file really
is a SQLite database and is over 100 MB — a truncated download or an HTML error
page fails the build rather than producing a confusing runtime error — and bakes
them into the image.

The integrity guarantee is unchanged: the downloaded corpus still has to pass the
§3.2 answer-key checksum at startup. The checksum does not care whether the file
arrived by `COPY` or by `curl`.

> Verify the free tier's current card policy before you start — these change.
> [Koyeb](https://www.koyeb.com) is the fallback and takes the same Dockerfile.

---

## Want a link in five minutes instead?

A Cloudflare tunnel publishes straight from your machine. Instant, and genuinely
only up while your PC is on and the command is running — use it to show someone
today, not as hosting.

```bash
pnpm build
```

```bash
pnpm start
```

Then in a second terminal:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

It prints a `https://<random>.trycloudflare.com` URL. Don't rely on it: the URL
changes every run, there's no uptime guarantee, and your home connection serves
the traffic.

---

## Fly.io, if you do add a card

`fly.toml` and the `Dockerfile` are already set up for it.

```bash
fly launch --no-deploy --copy-config --name YOUR-APP-NAME --region bom
```

```bash
fly deploy
```

Expect roughly **$0–5/month** — the config scales to zero when idle. Fly builds
remotely, so you don't need Docker installed locally.

---

## What I changed to make this deployable

| Change | Why |
|---|---|
| `output: 'standalone'` | Self-contained server bundle; the image needs no `node_modules` tree. |
| `Dockerfile` | Multi-stage. `better-sqlite3` is installed in the deps stage so its native binary builds for Linux, then arrives via Next's traced standalone output. Runs as uid 1000 (`node`), which is what Hugging Face Spaces expects. The corpus is copied as **root, mode 444** so the app user cannot write to the answer key (I3). |
| `.dockerignore` | Excludes `data/raw` (141 MB, not needed at runtime) but deliberately *keeps* `data/build`. |
| `README.md` front matter | Hugging Face Space card: `sdk: docker`, `app_port: 3000`. |
| `.gitattributes` | Tracks `*.sqlite` via LFS and forces LF endings so a Windows checkout produces the same build context as Linux. |
| `middleware.ts` | Per-IP rate limiting: 240 req/min general, 60 req/min on search. There is no auth by design, so search was the obvious way to make the box expensive for everyone else. |
| Security headers | CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policy. `connect-src 'self'` is a browser-enforced second line behind invariant I2 — the page cannot reach an external inference endpoint even if a dependency were compromised. |
| `CORPUS_DIR` env var | Lets a container mount the corpus somewhere other than the working directory. |
| Footer credits | Apache-2.0 redistribution requires attribution. The paper is cited and the dataset repo and licence linked, per §2.4. **Keep this visible** — it is a licence obligation, not decoration. |
| `/api/health` trimmed | Failure reasons contained absolute filesystem paths; suppressed in production. |

## Measured before deploying

- Production build: **126 kB First Load JS** (budget 180 kB gzipped — this is the uncompressed figure).
- Startup integrity check: passes, 186,791 rows.
- FTS5 search: **1–11 ms server-side**, 17 ms median round-trip (budget: p95 < 150 ms).
- Rate limiter: exactly 60 search requests allowed per window, then 429.
- Session planning: same seed → identical sequence.
- LFS: verified `corpus.sqlite` resolves to `filter: lfs` before any push is attempted.

## Known gaps at launch

- **Not yet verified:** axe-core accessibility sweep, Lighthouse on a throttled
  mid-range profile, and the Playwright end-to-end suite. Those are Phase 4 of
  the spec and have not been run.
- **The Docker image has not been built locally.** Docker Desktop's engine needs
  interactive setup on this machine. Static verification did catch and fix two
  real bugs in the Dockerfile (`bindings` and `file-uri-to-path` do not exist as
  top-level packages under pnpm). Both Hugging Face and Fly build remotely and
  fail loudly, so a broken build will not half-deploy.
- **Rate limiting is per-instance.** In-memory, so scaling past one machine makes
  it a per-machine limit. Move to Redis if you scale out.
- **No analytics of any kind.** Deliberate (§13.13). You will not know how many
  people use it unless you add something — and if you do, it must not transmit
  question content or user answers.
- **No custom domain.** Hugging Face supports one on paid tiers; Fly does it with
  `fly certs add`.

## Later: if you outgrow a single box

`DECISIONS.md` D-005 chose local SQLite for sub-millisecond queries with no
network hop. If you ever need serverless or multi-region, the migration is
**Turso** (hosted libSQL — SQLite-compatible, keeps FTS5). It means converting
`lib/db/` from synchronous `better-sqlite3` to the async `@libsql/client`, which
touches `queries.ts`, the six route handlers, and the integrity check. That would
unlock Vercel. It is a real refactor, not a config change, and it adds a network
round-trip per query — which is why it is not the starting point.
