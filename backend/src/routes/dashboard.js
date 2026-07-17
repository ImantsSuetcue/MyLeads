const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

// Mounted at /api/dashboard. The KPI dashboard is a Manager privilege per the
// spec ("Hat Zugriff auf ein KPI-Dashboard") — members don't get org-wide numbers.
const router = express.Router();

function requireOrgUser(req, res, next) {
  if (!req.user.organizationId) {
    return res.status(403).json({ error: 'Platform-Admins have no organization-level access here' });
  }
  next();
}

router.use(requireAuth, requireOrgUser, requireRole('manager'));

// Computed live from leads/contacts — nothing is pre-aggregated, so this always
// reflects the current state (incl. status changes made later in Phase 4's pipeline).
function computeKpis(where, params) {
  const leadsFound = db.prepare(`SELECT count(*) AS c FROM leads l WHERE ${where}`).get(...params).c;

  const companiesFound = db
    .prepare(`SELECT count(DISTINCT COALESCE(l.company_domain, l.company_name)) AS c FROM leads l WHERE ${where}`)
    .get(...params).c;

  const companiesWithContact = db
    .prepare(
      `SELECT count(DISTINCT COALESCE(l.company_domain, l.company_name)) AS c
       FROM leads l JOIN contacts c ON c.lead_id = l.id
       WHERE ${where} AND c.first_name IS NOT NULL`
    )
    .get(...params).c;

  const leadsWithPhone = db
    .prepare(`SELECT count(*) AS c FROM leads l JOIN contacts c ON c.lead_id = l.id WHERE ${where} AND c.phone IS NOT NULL`)
    .get(...params).c;

  const leadsWithEmail = db
    .prepare(`SELECT count(*) AS c FROM leads l JOIN contacts c ON c.lead_id = l.id WHERE ${where} AND c.email IS NOT NULL`)
    .get(...params).c;

  const statusRows = db.prepare(`SELECT l.status, count(*) AS c FROM leads l WHERE ${where} GROUP BY l.status`).all(...params);
  const statusDistribution = {};
  for (const row of statusRows) statusDistribution[row.status] = row.c;

  return { leadsFound, companiesFound, companiesWithContact, leadsWithPhone, leadsWithEmail, statusDistribution };
}

// ?searchRunId=... scopes to one search run (per-search view on target-profile.html).
// ?targetProfileId=... scopes to one profile, aggregated across its runs.
// Neither param -> org-wide aggregate (the Dashboard page).
router.get('/kpis', (req, res) => {
  const { targetProfileId, searchRunId } = req.query;

  let where = 'l.organization_id = ?';
  const params = [req.user.organizationId];

  if (searchRunId) {
    where += ' AND l.search_run_id = ?';
    params.push(searchRunId);
  } else if (targetProfileId) {
    where += ' AND l.target_profile_id = ?';
    params.push(targetProfileId);
  }

  res.json(computeKpis(where, params));
});

module.exports = router;
