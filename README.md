# Social Intelligence Platform — Vercel + Supabase Deployment Guide

This is the same platform you've been using as a Claude.ai artifact, rebuilt to run as a
real deployed app. The big change: data now lives in a real Postgres database (Supabase)
instead of the artifact's browser-only storage, and the Claude/YouTube API calls happen on
a server you control instead of in the browser — so your API keys are never exposed.

**What you get:** a YouTube comment fetcher that runs automatically once a day, covering
~12 models per run (all 58 within about 5 days), tagging and querying that work the same
way they did before, and all your data safely in a database instead of trapped in a browser tab.

---

## Part 1 — Set up Supabase (free tier is enough)

1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**. Pick any name (e.g. `sip-lava`), set a database password (save it
   somewhere — you won't need it for this setup, but it's good practice), pick a region close
   to India if available, and create the project. Takes about 2 minutes to provision.
3. Once it's ready, go to the **SQL Editor** in the left sidebar → **New query**.
4. Open `sql/schema.sql` from this project, copy the entire contents, paste into the editor,
   and click **Run**. This creates all the tables (models, comments, tags, specs, video_map,
   marketing_assets, fetch_progress, quota_log).
5. Open a **second new query**, paste in `sql/seed_data.sql`, and run it. This loads your 58
   models, their specs, and all 3,029 comments. This file is large (~700KB) — if the SQL
   Editor chokes on pasting it all at once, split it into 2-3 chunks at natural `insert into`
   boundaries and run each chunk separately; it's all idempotent-safe inserts.
6. Go to **Project Settings → API** (gear icon, bottom left). You'll need two values from here
   in Part 3:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **service_role key** (under "Project API keys" — NOT the `anon` key; the service role key
     bypasses row-level security, which is what the server-side functions need since this is a
     single-user internal tool)

**One thing worth knowing:** Supabase's free tier pauses your project after 7 days with zero
database activity. If you don't touch the tool for a week, the next load will be slow (~30
seconds) while it wakes back up — not broken, just sleepy. The daily cron job actually helps
here, since it touches the database every day and resets that 7-day clock automatically.

---

## Part 2 — Get your API keys

### Claude API key
You'll need an Anthropic API key (separate from your claude.ai login) — get one at
[console.anthropic.com](https://console.anthropic.com) under **API Keys**. This is what
powers the Tagging Engine and the Query analysis. Note this incurs small per-use costs
(roughly $3-6 to tag all ~3,000 existing comments in one go, per our earlier estimate).

### YouTube Data API key
1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project (or
   use an existing one).
2. **APIs & Services → Library**, search "YouTube Data API v3", click **Enable**.
3. **APIs & Services → Credentials → Create Credentials → API Key**. Copy the key.
4. (Recommended) Click "Restrict Key" → restrict it to "YouTube Data API v3" only, so it
   can't be misused for other Google APIs if it ever leaks.

This key gets a free 10,000-unit daily quota, with a separate 100-calls/day cap specifically
on search — which is the real bottleneck for mapping models to videos. The cron job is built
to respect both caps automatically.

### A secret for manual cron triggers
Just make up a long random string yourself (20+ characters, letters and numbers). This isn't
from any provider — it's a password only you and Vercel's cron scheduler know, used to stop
random people on the internet from triggering your YouTube quota usage by guessing your
function URL. Save it somewhere; you'll enter it once into Vercel and use it again if you
ever want to manually trigger a fetch from the UI.

---

## Part 3 — Deploy to Vercel

1. Push this project folder to a GitHub repository (Vercel deploys from Git).
   ```
   cd vercel-app
   git init
   git add .
   git commit -m "Initial deploy"
   # create a repo on github.com, then:
   git remote add origin https://github.com/<you>/<repo-name>.git
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com), sign up/log in (GitHub login is easiest), click
   **Add New Project**, and import the repo you just pushed.
3. Before clicking Deploy, expand **Environment Variables** and add these (all as Production —
   add to Preview too if you want preview branches to work, but Production is what matters):

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | from Supabase Project Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase Project Settings → API (the service_role one) |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com |
   | `YOUTUBE_API_KEY` | from Google Cloud Console |
   | `CRON_SECRET` | a random 20+ character string you make up (used internally by Vercel's own cron scheduler) |
   | `VIEWER_PASSWORD` | a password you'll share with colleagues who need read access |
   | `ADMIN_PASSWORD` | a separate password only you know, for write access |
   | `AUTH_TOKEN_SECRET` | another random 20+ character string you make up (signs login session tokens — never shared with anyone) |

4. Click **Deploy**. First deploy takes 1-2 minutes. Vercel will give you a URL like
   `https://your-project-name.vercel.app` — that's your live tool.
5. Open it. You should see the Query tab load with your 58 models. If you see a red error
   message instead, it's almost always a typo in one of the environment variables — double
   check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` first.

### Confirm the cron job is registered
Go to your Vercel project → **Settings → Cron Jobs**. You should see one job pointing at
`/api/cron-youtube-fetch` running daily. Vercel's free Hobby plan only allows once-a-day cron
(which is exactly what we want here), and it may fire anytime within the scheduled hour rather
than at the exact minute — that's normal and fine for this use case.

### Run the first fetch batch immediately (don't wait for tomorrow's cron)
Go to the **YouTube** tab in the app, click **Run Fetch Batch Now**, and paste in your
`CRON_SECRET` when prompted. This runs the exact same job the cron will run daily, just
triggered immediately — useful right after deploy so you don't wait until the next scheduled run.

---

## Part 4 — Using the platform day to day

### Access model
There are two passwords, both set as environment variables (`VIEWER_PASSWORD` and
`ADMIN_PASSWORD`) — there's no per-person account system, just two shared secrets:

- **Viewer password** — share this with anyone who needs to use the dashboard (Query,
  Overview, Model Deep-Dive, Matrix, Gap Analysis, Themes, Specs, and read-only views of
  E-com Data, YouTube, and Tagging Engine). They enter it once when the page loads; it's
  forgotten the moment they close the browser tab (by design — no "remember me").
- **Admin password — only you should know this.** It unlocks write actions: running the
  Tagging Engine, adding e-com comments, manually triggering a YouTube fetch, and adding/
  removing marketing assets. To use it, click **Admin Login** in the topbar (or any write
  button will offer to open it for you) — this opens `/admin.html` in a new tab. Log in
  there, and the original dashboard tab picks up admin rights automatically, no reload
  needed. Admin sessions last 8 hours or until you close that tab's session, whichever
  comes first — you'll just log in again via `/admin.html` if it expires.

This is enforced on the server, not just hidden in the UI — even someone who knows how to
call the API directly cannot run a write action without the admin password. The viewer
password gates reading any data at all.

If you ever want real named accounts (e.g. to know *who* tagged what, or revoke one
person's access without changing the password for everyone), that's a bigger change
(Supabase Auth with per-user logins) — flag it if you want that built later.

- **Query & Competition** tab is now the landing page, same as before.
- **YouTube** tab shows live progress (X of 58 models covered, today's quota usage) instead
  of needing you to paste a key — the cron handles fetching automatically in the background.
- **Tagging Engine** works the same as before, just calling your own server instead of Claude
  directly from the browser.
- **Marketing Assets** (inside Model Deep-Dive) work the same — paste URLs, they're stored in
  Supabase now instead of browser storage, so they survive across devices and browser sessions.
- No more Export/Import button needed — there's nothing browser-local left to lose. Your data
  lives in Supabase permanently regardless of which device or browser you open the tool from.

### Pacing expectations
With the default batch size of 12 models/run and ~90 search calls/day cap, all 58 models get
their first video mapped within about 5 daily cron runs. After that, the cron switches to
just refreshing comments on already-mapped videos (1 unit each — cheap), so steady-state daily
runs are fast and use very little quota.

If you want a different pace (e.g. faster than 12/day, since you mentioned "10-15 if not all"),
open `api/cron-youtube-fetch.js` and change the `BATCH_SIZE` constant near the top — just keep
in mind search.list has a hard ~100/day Google-side ceiling regardless of what you set here.

---

## What's NOT included / known limitations

- **No login/auth** — this assumes you're the only person using it. Anyone with the URL can
  use the app and its data (though they'd need your `CRON_SECRET` to manually trigger fetches).
  If you ever want to share this with your team, that's the first thing to add.
- **No product photos** — same as before, this was explicitly deferred.
- **Marketing asset hosting** — still URL-only, you provide where the actual files live.
- **Single Claude/YouTube key** — shared across all usage; no per-user usage tracking.
