# MyLeads

Multi-tenant SaaS: companies describe their product/target audience in plain text,
and MyLeads turns that into real companies + real contacts with an AI-written
"why this lead fits" reasoning.

- `/backend` – Node.js + Express REST API, SQLite database (Node's built-in `node:sqlite`, no install needed)
- `/frontend` – Plain HTML/CSS/JS (no build step), opened via VS Code "Live Server"

## Local Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate      # creates backend/data/myleads.db with all tables
npm run seed:admin   # creates the first Platform-Admin login (uses PLATFORM_ADMIN_EMAIL/PASSWORD from .env)
npm run dev          # starts the API on http://localhost:3000
```

Check it worked: open http://localhost:3000/api/health — should show `{"ok":true,"mockMode":true}`.

### 2. Frontend

Open the `/frontend` folder in VS Code and start `index.html` with the "Live Server" extension
(usually runs on http://127.0.0.1:5500). The frontend talks to the backend via `fetch()` calls
defined in `frontend/js/api.js`.

## Mock Mode (no API keys needed to start)

`.env` has `MOCK_MODE=true` by default. While it's on, the Claude, Apollo.io, and Stripe
integrations all return realistic fake data instead of making real API calls — so you can
build and test the whole app before you have any API keys.

Once you have real keys (see below), set the key(s) in `.env` and switch `MOCK_MODE=false`.
No code changes needed.

## API Keys

| Key | Where to get it | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | Turning free-text target profiles into structured search filters, and writing the per-lead "why this fits" reasoning (with web search) |
| `APOLLO_API_KEY` | https://app.apollo.io → Settings → API | Finding real companies and contact people with verified emails |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | https://dashboard.stripe.com/test/apikeys | Subscription checkout & billing management |

All go in `backend/.env` — see `backend/.env.example` for the full list and comments.

## Compliance Scraper & Deep Research (Phase 2)

Two extra backend services complement Apollo:

- `services/complianceScraper.js` — for leads Apollo left incomplete (missing industry/size)
  but with a known company domain, this fetches only that company's own public Impressum/About/
  Presse/Karriere pages — never anything else, never LinkedIn/Xing, never a generic web crawl.
  It always checks `robots.txt` first, waits at least `SCRAPER_MIN_DELAY_MS` (default 3s) between
  requests to the same domain, and checks the `suppression_list` table before ever fetching a
  domain — domains listed there are permanently skipped.
- `services/deepResearch.js` — for the best-scoring leads of a search (how many depends on the
  organization's plan — see `deepResearchLeadLimit` in `backend/src/config/plans.js`), generates
  a fuller research mini-report (recent news, rough KPIs, company stage, fit category, sales
  talking points), shown on each lead's detail page.
- GDPR-style deletion: `POST /api/platform-admin/scraping/suppress` (Platform-Admin only) adds a
  domain to the suppression list, deletes its cached scraped data, and clears any lead fields that
  came from that scrape.

## Project Status

Being built phase by phase (see the plan). Phase 1 (core Lead-Finder) and Phase 2 (compliance
scraper + deep research) are done. This README will grow with setup instructions for each new
phase (roles/teams, billing UI, CRM features, email) as they're built.
