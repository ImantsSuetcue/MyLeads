const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

// Backend-only for now — the full Platform-Admin UI/area (org management,
// license overrides, etc.) is built in Phase 3. This route exists early
// because it's a compliance requirement of the Phase 2 scraper.
const router = express.Router();

router.use(requireAuth, requireRole('platform_admin'));

// GDPR-style opt-out/deletion for the compliance scraper (see services/complianceScraper.js):
//   1. Adds the domain to suppression_list — checked before every future scrape.
//   2. Deletes the cached scraped_company_data row for that domain.
//   3. Clears company_industry/company_size on every lead that got those fields FROM the
//      scraper for this domain (never touches fields Apollo provided) — the
//      "vollständiger Datensatz inkl. aller Kopien in Kunden-Listen" requirement.
router.post('/scraping/suppress', (req, res) => {
  const { domain, reason } = req.body || {};
  if (!domain) {
    return res.status(400).json({ error: 'domain is required' });
  }

  const existing = db.prepare('SELECT id FROM suppression_list WHERE domain = ?').get(domain);
  if (!existing) {
    db.prepare('INSERT INTO suppression_list (id, domain, reason) VALUES (?, ?, ?)').run(
      newId(),
      domain,
      reason || null
    );
  }

  const deletedScrapedRows = db.prepare('DELETE FROM scraped_company_data WHERE domain = ?').run(domain).changes;

  const affectedLeads = db
    .prepare(
      "UPDATE leads SET company_industry = NULL, company_size = NULL, industry_size_source = NULL WHERE company_domain = ? AND industry_size_source = 'scraper'"
    )
    .run(domain).changes;

  res.json({ ok: true, domain, suppressed: true, deletedScrapedRows, affectedLeads });
});

module.exports = router;
