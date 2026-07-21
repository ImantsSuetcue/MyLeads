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

Open the project folder (not just `/frontend`) in VS Code and start `frontend/index.html` with the
"Live Server" extension (usually runs on http://127.0.0.1:5500, serving from the project root — so
pages are reached at e.g. `http://127.0.0.1:5500/frontend/index.html`). The frontend talks to the
backend via `fetch()` calls defined in `frontend/js/api.js`.

If Live Server serves from a different root on your machine (e.g. you open the `/frontend` folder
directly as its own workspace), update `FRONTEND_BASE_URL` in `backend/.env` to match — it's used
to build the (mock) Stripe checkout link, so it has to point at wherever `index.html` actually loads
from.

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

## Design System & Navigation

`frontend/css/style.css` defines the whole visual language as CSS custom properties (colors,
spacing, type scale, badge/status colors) plus reusable component classes (`.card`, `.badge-*`,
`.btn-*`, `.data-table`, `.skeleton`, `.stat-card`) — change the tokens once, every page updates.

Every logged-in page shares one sidebar (`Dashboard` / `Suchanfragen` / `Leads` / `Team` /
`Einstellungen`), with the active link highlighted automatically by `frontend/js/sidebar.js`.
The layout adapts to window width: the sidebar collapses to a horizontal scrollable bar below
~880px, and content blocks stretch to the full available width on wide windows instead of being
capped.

## Project Status

Being built phase by phase (see the plan). Done so far:

- **Phase 1** — core Lead-Finder (free-text target profile → Claude-structured filters → Apollo
  search → AI-written fit reasoning + value proposition).
- **Phase 2** — compliance scraper + Tiefen-Recherche (see above), plus the design-system pass
  (sidebar navigation, cross-profile Leads view, per-lead value proposition + company/person links).
- **Phase 3** — roles & permissions (Manager-managed teammates/groups, per-list access grants), a
  Manager KPI dashboard with drill-down charts per metric, license top-ups + a mock Stripe Billing
  Portal, and a Platform-Admin area for managing organizations.
- **Phase 4** — CRM pipeline: editable lead status (new/contacted/qualified/proposal/won/lost) and
  freeform notes per lead.

Still open: Phase 5 (real invite emails via Resend, an additional data provider alongside Apollo),
and going from mock-mode demo to a real deployment (real API keys, automated tests/CI, hosting).
