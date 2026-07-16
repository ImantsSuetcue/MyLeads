// DSGVO-compliant company-website scraper. Deliberately narrow in scope:
//   - Only fetches a small, fixed set of firm-level public page types
//     (Impressum/imprint, about, press/news, careers) on a domain we already
//     know about (from an Apollo lead) — it never discovers new companies
//     and never crawls links found on a page.
//   - Never touches platforms whose terms forbid scraping (LinkedIn, Xing, ...) —
//     that's a contract/copyright issue independent of GDPR and is out of scope
//     by construction: only the lead's own company_domain is ever fetched.
//   - Always checks robots.txt and the local suppression_list before fetching.
//   - Only extracts firm-level facts (name, industry, size, a generic mailbox
//     like info@) — never a named individual's data or any special category
//     of personal data.
const robotsParser = require('robots-parser');
const db = require('../db/db');
const env = require('../config/env');
const { newId } = require('../utils/ids');
const claudeClient = require('./claudeClient');
const mockProviders = require('./mockProviders');

const USER_AGENT = 'MyLeadsComplianceBot/1.0 (+https://example.com/bot-info)';

// Candidate paths per allowed page type. We try each in order and keep the
// first one that passes robots.txt AND returns HTTP 200 — we stop after a
// handful of hits. We never follow links found on the page itself.
const CANDIDATE_PATHS = [
  '/impressum',
  '/imprint',
  '/ueber-uns',
  '/unternehmen',
  '/about',
  '/about-us',
  '/presse',
  '/press',
  '/news',
  '/aktuelles',
  '/karriere',
  '/jobs',
  '/careers',
];

const MAX_PAGES_PER_DOMAIN = 3;

// domain -> timestamp of the last request we made to it, for rate limiting.
const lastFetchAt = new Map();

async function waitForRateLimit(domain) {
  const last = lastFetchAt.get(domain) || 0;
  const wait = env.SCRAPER_MIN_DELAY_MS - (Date.now() - last);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastFetchAt.set(domain, Date.now());
}

async function getRobots(domain) {
  const robotsUrl = `https://${domain}/robots.txt`;
  let body = '';
  try {
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      body = await res.text();
    }
  } catch (err) {
    // Unreachable robots.txt — the standard convention is "no restrictions",
    // same as an explicitly empty robots.txt.
    body = '';
  }
  return robotsParser(robotsUrl, body);
}

function isSuppressed(domain) {
  return Boolean(db.prepare('SELECT id FROM suppression_list WHERE domain = ?').get(domain));
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fetches up to MAX_PAGES_PER_DOMAIN allowed pages for a domain. Exported on
// its own so it can be exercised/tested in isolation from the Claude call.
async function fetchAllowedPages(domain) {
  const robots = await getRobots(domain);
  const pages = [];

  for (const candidatePath of CANDIDATE_PATHS) {
    if (pages.length >= MAX_PAGES_PER_DOMAIN) break;

    const url = `https://${domain}${candidatePath}`;
    if (robots.isAllowed(url, USER_AGENT) === false) {
      continue; // robots.txt explicitly disallows this path — skip it
    }

    await waitForRateLimit(domain);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.ok) {
        const html = await res.text();
        pages.push({ url, text: stripHtml(html).slice(0, 4000) });
      }
    } catch (err) {
      // Page unreachable/timed out — skip it, not a hard failure for the whole domain.
    }
  }

  return pages;
}

function saveScrapedCompany(result) {
  db.prepare(
    `INSERT INTO scraped_company_data (id, domain, company_name, industry, company_size, generic_email, source_urls, robots_txt_checked, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(domain) DO UPDATE SET
       company_name = excluded.company_name,
       industry = excluded.industry,
       company_size = excluded.company_size,
       generic_email = excluded.generic_email,
       source_urls = excluded.source_urls,
       robots_txt_checked = 1,
       scraped_at = datetime('now')`
  ).run(
    newId(),
    result.domain,
    result.companyName,
    result.industry,
    result.companySize,
    result.genericEmail,
    JSON.stringify(result.sourceUrls)
  );
}

// Main entry point: scrape (or return cached/mocked) firmographic data for one domain.
// Returns null if the domain is suppressed or nothing could be found.
async function scrapeCompany(domain) {
  if (!domain) return null;
  if (isSuppressed(domain)) return null;

  let result;
  if (env.MOCK_MODE) {
    result = mockProviders.mockScrapeCompany(domain);
  } else {
    const pages = await fetchAllowedPages(domain);
    if (pages.length === 0) return null;

    const combinedText = pages.map((p) => p.text).join('\n\n').slice(0, 8000);
    const extracted = await claudeClient.extractCompanyInfoFromText(combinedText, domain);

    result = {
      domain,
      companyName: extracted.company_name || null,
      industry: extracted.industry || null,
      companySize: extracted.company_size || null,
      genericEmail: extracted.generic_email || null,
      sourceUrls: pages.map((p) => p.url),
      robotsTxtChecked: true,
    };
  }

  saveScrapedCompany(result);
  return result;
}

module.exports = { scrapeCompany, fetchAllowedPages, getRobots, isSuppressed, stripHtml };
