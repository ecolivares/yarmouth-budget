# Yarmouth Budget Explorer

A public, static web page that explains the Town of Yarmouth, ME budget and lets
residents chat with an AI assistant to test property-tax-cut scenarios against the
**real, validated numbers** — dollars → rate impact → savings on their home.

- **Front-end** (`public/`) — static HTML/CSS/JS, no build step. Renders the
  embedded dataset (`public/data.js`) and the chat UI.
- **Proxy** (`api/chat.js`) — a Vercel Edge Function that holds the Anthropic API
  key server-side (never in the browser) and streams answers back. Builds the
  system prompt from the same dataset (`api/_budget-data.js`).

Both data files are generated from the validated CSVs by `../build_data.py`
(run it from the repo root after any data change: `python3 build_data.py`).

---

## Deploy (GitHub → Vercel)

1. **Push the repo to GitHub** (the whole `yarmouth-budget` repo; only `app/` is deployed).
2. In Vercel: **Add New… → Project → Import** the GitHub repo.
3. **Set Root Directory to `app`** (Vercel → project → Settings → General, or during
   import click *Edit* next to Root Directory). Framework Preset: **Other**. Leave
   Build & Output commands empty — there's no build step.
4. Add environment variables (Settings → Environment Variables), then deploy:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Your Anthropic key. The proxy uses it; it's never sent to browsers. |
| `CHAT_MODEL` | No | Model id. Default `claude-sonnet-5`. Set `claude-haiku-4-5` to cut cost further, or `claude-opus-4-8` for maximum capability. |
| `ACCESS_WORD` | No | If set, visitors must enter this word before chatting (see below). Unset = open to anyone with the link. |
| `MAX_TOKENS` | No | Cap on answer length. Default `1024`. |
| `MAX_TURNS` | No | Conversation messages kept per request. Default `16`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Enable durable per-IP rate limiting (see below). |
| `RL_LIMIT` / `RL_WINDOW_SEC` | No | Rate-limit budget. Default `20` requests per `600`s per IP. |

That's it — each `git push` to the default branch auto-deploys.

> Running locally: `npm i -g vercel` then `vercel dev` **from the `app/` folder**
> (put the env vars in `app/.env.local`). Plain static preview without the chat:
> `python3 -m http.server` inside `public/`.

---

## Controlling cost (you're paying for the API usage)

Vercel hosting is free (Hobby tier); the only cost is Anthropic API usage. Layers of protection:

1. **Hard monthly spend cap — do this first.** In the Anthropic Console
   (Settings → Limits / Billing), set a monthly spend limit on the workspace whose
   key you used. This is the real ceiling: if it's hit, calls stop, full stop.
2. **Per-request caps (built in):** fixed model, `MAX_TOKENS` answer cap, capped
   conversation length and per-message size — so no single visitor can send a
   huge, expensive request.
3. **Rate limiting (optional but recommended for a public link):** create a free
   [Upstash Redis](https://upstash.com) database, copy its REST URL + token into
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Without these the app
   still runs — it just leans on caps + the console spend cap.
4. **Cheaper model:** the default is `claude-sonnet-5`; set `CHAT_MODEL=claude-haiku-4-5`
   to cut cost further. For a Q&A tool over this small dataset Haiku is very capable.

## Locking it down (optional)

Set `ACCESS_WORD` to any phrase (e.g. `townmeeting`). The page will ask visitors
for it once and remember it in their browser. Share the word at meetings or on the
town page. Flip it on/off anytime by adding/removing the env var and redeploying —
no code change. (To pre-seed it for testing, the page also honors a `?access=WORD`
URL parameter.)

## Editing the data

The budget numbers live in the repo's `data/*.csv` (Phase-1 validated dataset).
After changing them, regenerate the embedded bundles from the repo root:

```
python3 build_data.py
git add app/public/data.js app/api/_budget-data.js && git commit && git push
```

Vercel redeploys automatically.
