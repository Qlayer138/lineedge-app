# LineEdge — API + Dashboard (one project)

This folder is everything needed for one Vercel deploy: a serverless API
(`/api/v1/odds`) plus a plain HTML dashboard (`index.html`) that calls it.
No build step, no framework — just files Vercel can deploy as-is.

## Deploy from your phone (no terminal needed)

### 1. Put these files on GitHub
- Go to github.com, sign in (or create an account)
- Tap **+** → **New repository** → name it `lineedge-app` → Create
- Tap **Add file** → **Upload files**
- Upload all files in this folder, **keeping the folder structure**:
  - `index.html`
  - `vercel.json`
  - `package.json`
  - `.env.example`
  - `api/v1/odds.js`  ← make sure this stays nested under `api/v1/`, not flattened
- Commit

  > If GitHub's mobile upload won't let you create the `api/v1/` folder
  > directly: create a file first named `api/v1/odds.js` in the "Add file →
  > Create new file" screen — typing that path with slashes auto-creates the
  > folders — then paste the contents in.

### 2. Import into Vercel
- Go to vercel.com, sign in with GitHub (this links your account automatically)
- Tap **Add New** → **Project**
- Select `lineedge-app` → **Import**

### 3. Add your API key
- Before deploying, expand **Environment Variables**
- Name: `ODDS_API_KEY`
- Value: your Odds API key
- Tap **Add**

### 4. Deploy
- Tap **Deploy**
- Wait ~30–60 seconds

### 5. Open it
You'll get a URL like `lineedge-app-xyz.vercel.app`. Open it — you should see
the dashboard load live odds within a couple seconds. If something's wrong,
the page shows the actual error (e.g. missing API key, no games in season)
with a Retry button.

## What's in here

- **`api/v1/odds.js`** — the backend abstraction layer. Calls The Odds API
  server-side, normalizes the response, never exposes your key to the
  browser. Swap providers later by editing this one file.
- **`index.html`** — a minimal read-only dashboard: fetches `/api/v1/odds`,
  shows each game's books ranked by EV with the no-vig fair line highlighted.
  It's intentionally simple — for the full feature set (player props, parlay
  builder, AI scans, betslip reader), use the React version of LineEdge and
  point its `LIVE_ODDS_BASE_URL` constant at this same deployed URL.

## Updating later

Any time you edit a file on GitHub (even from your phone, using GitHub's
"Edit" pencil icon), Vercel automatically redeploys. No CLI required for
ongoing changes either.
