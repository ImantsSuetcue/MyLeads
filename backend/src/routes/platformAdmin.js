const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { hashPassword } = require('../utils/passwords');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const plans = require('../config/plans');

const router = express.Router();

router.use(requireAuth, requireRole('platform_admin'));

// --- Organizations (the real Platform-Admin area, Phase 3) ----------------------

router.get('/organizations', (req, res) => {
  const organizations = db
    .prepare(
      `SELECT o.*, (SELECT count(*) FROM users u WHERE u.organization_id = o.id) AS user_count
       FROM organizations o
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json({ organizations });
});

// Platform-Admin creates an org + its first Manager directly — bypasses self-service
// checkout entirely (spec: "wird NICHT vom Kunden selbst angelegt").
router.post('/organizations', async (req, res) => {
  const { companyName, plan, managerEmail, managerPassword, managerFullName } = req.body || {};
  if (!companyName || !plan || !managerEmail || !managerPassword) {
    return res.status(400).json({ error: 'companyName, plan, managerEmail and managerPassword are required' });
  }
  const planDef = plans[plan];
  if (!planDef) {
    return res.status(400).json({ error: `Unknown plan: ${plan}` });
  }
  if (managerPassword.length < 8) {
    return res.status(400).json({ error: 'managerPassword must be at least 8 characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(managerEmail);
  if (existing) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  const organizationId = newId();
  db.prepare(
    `INSERT INTO organizations (id, name, plan, subscription_status, license_count, search_quota_monthly)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(organizationId, companyName, plan, planDef.includedLicenses, planDef.searchQuotaMonthly);

  const userId = newId();
  const passwordHash = await hashPassword(managerPassword);
  db.prepare(
    `INSERT INTO users (id, organization_id, email, password_hash, role, full_name)
     VALUES (?, ?, ?, ?, 'manager', ?)`
  ).run(userId, organizationId, managerEmail, passwordHash, managerFullName || null);

  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  res.status(201).json({ organization });
});

router.patch('/organizations/:id', (req, res) => {
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!organization) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const { plan, licenseCount, subscriptionStatus } = req.body || {};
  const updates = {};

  if (plan !== undefined) {
    if (!plans[plan]) return res.status(400).json({ error: `Unknown plan: ${plan}` });
    updates.plan = plan;
  }
  if (licenseCount !== undefined) {
    const n = Number(licenseCount);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'licenseCount must be a positive integer' });
    updates.license_count = n;
  }
  if (subscriptionStatus !== undefined) {
    if (!['pending_checkout', 'active', 'canceled'].includes(subscriptionStatus)) {
      return res.status(400).json({ error: 'Invalid subscriptionStatus' });
    }
    updates.subscription_status = subscriptionStatus;
  }

  const fields = Object.keys(updates);
  if (!fields.length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  const setClauses = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => updates[f]);
  values.push(req.params.id);
  db.prepare(`UPDATE organizations SET ${setClauses} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  res.json({ organization: updated });
});

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
