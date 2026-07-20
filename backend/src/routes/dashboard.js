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

const METRICS = ['leadsFound', 'companiesFound', 'companiesWithContact', 'leadsWithEmail', 'leadsWithPhone', 'targetProfiles'];

const RANGE_CONFIG = {
  '1d': { unit: 'hour', count: 24 },
  '7d': { unit: 'day', count: 7 },
  '30d': { unit: 'day', count: 30 },
  '1y': { unit: 'month', count: 12 },
  '3y': { unit: 'month', count: 36 },
};

function addUnit(date, unit, n) {
  const d = new Date(date);
  if (unit === 'hour') d.setUTCHours(d.getUTCHours() + n);
  else if (unit === 'day') d.setUTCDate(d.getUTCDate() + n);
  else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

// SQLite datetime('now') strings ('YYYY-MM-DD HH:MM:SS', UTC) -> real Date objects.
function parseSqliteDate(value) {
  return new Date(value.replace(' ', 'T') + 'Z');
}

// Buckets a flat list of timestamps into a cumulative-count series for the given
// range. Filtering/grouping happens in JS rather than SQL since data volumes here
// are small (per-org counts), which keeps the per-metric queries below trivial.
function bucketAndAccumulate(dateStrings, range) {
  const config = RANGE_CONFIG[range];
  const dates = dateStrings.filter(Boolean).map(parseSqliteDate).sort((a, b) => a - b);

  const now = new Date();
  const rangeStart = addUnit(now, config.unit, -config.count);
  let cumulative = dates.filter((d) => d < rangeStart).length;

  const series = [];
  let cursor = rangeStart;
  for (let i = 0; i < config.count; i++) {
    const bucketEnd = addUnit(cursor, config.unit, 1);
    cumulative += dates.filter((d) => d >= cursor && d < bucketEnd).length;
    series.push({ date: bucketEnd.toISOString(), value: cumulative });
    cursor = bucketEnd;
  }
  return series;
}

// Raw timestamps behind each metric, for the org. Company metrics use the first
// time each distinct company appeared (MIN created_at) so a company re-surfaced by
// a later search run isn't counted twice — same de-dup logic as computeKpis' use
// of count(DISTINCT COALESCE(company_domain, company_name)).
function loadMetricDates(metric, organizationId) {
  const params = [organizationId];
  switch (metric) {
    case 'leadsFound':
      return db.prepare('SELECT created_at FROM leads WHERE organization_id = ?').all(...params);
    case 'leadsWithEmail':
      return db
        .prepare('SELECT l.created_at AS created_at FROM leads l JOIN contacts c ON c.lead_id = l.id WHERE l.organization_id = ? AND c.email IS NOT NULL')
        .all(...params);
    case 'leadsWithPhone':
      return db
        .prepare('SELECT l.created_at AS created_at FROM leads l JOIN contacts c ON c.lead_id = l.id WHERE l.organization_id = ? AND c.phone IS NOT NULL')
        .all(...params);
    case 'targetProfiles':
      return db.prepare('SELECT created_at FROM target_profiles WHERE organization_id = ?').all(...params);
    case 'companiesFound':
      return db
        .prepare('SELECT MIN(l.created_at) AS created_at FROM leads l WHERE l.organization_id = ? GROUP BY COALESCE(l.company_domain, l.company_name)')
        .all(...params);
    case 'companiesWithContact':
      return db
        .prepare(
          `SELECT MIN(l.created_at) AS created_at
           FROM leads l JOIN contacts c ON c.lead_id = l.id
           WHERE l.organization_id = ? AND c.first_name IS NOT NULL
           GROUP BY COALESCE(l.company_domain, l.company_name)`
        )
        .all(...params);
    default:
      return [];
  }
}

router.get('/timeseries', (req, res) => {
  const { metric, range } = req.query;
  if (!METRICS.includes(metric)) {
    return res.status(400).json({ error: `metric must be one of: ${METRICS.join(', ')}` });
  }
  if (!RANGE_CONFIG[range]) {
    return res.status(400).json({ error: `range must be one of: ${Object.keys(RANGE_CONFIG).join(', ')}` });
  }

  const rows = loadMetricDates(metric, req.user.organizationId);
  const series = bucketAndAccumulate(rows.map((r) => r.created_at), range);
  res.json({ series });
});

// Per-target-profile counts for a metric, via correlated subqueries so every
// profile is listed even with a value of 0 (a plain LEFT JOIN + WHERE filter on
// the joined side would silently drop profiles with no matching rows instead).
const BREAKDOWN_SUBQUERIES = {
  leadsFound: '(SELECT count(*) FROM leads l WHERE l.target_profile_id = tp.id)',
  companiesFound: '(SELECT count(DISTINCT COALESCE(l.company_domain, l.company_name)) FROM leads l WHERE l.target_profile_id = tp.id)',
  companiesWithContact:
    `(SELECT count(DISTINCT COALESCE(l.company_domain, l.company_name))
      FROM leads l JOIN contacts c ON c.lead_id = l.id
      WHERE l.target_profile_id = tp.id AND c.first_name IS NOT NULL)`,
  leadsWithEmail:
    '(SELECT count(*) FROM leads l JOIN contacts c ON c.lead_id = l.id WHERE l.target_profile_id = tp.id AND c.email IS NOT NULL)',
  leadsWithPhone:
    '(SELECT count(*) FROM leads l JOIN contacts c ON c.lead_id = l.id WHERE l.target_profile_id = tp.id AND c.phone IS NOT NULL)',
};

router.get('/breakdown', (req, res) => {
  const { metric } = req.query;
  if (!METRICS.includes(metric)) {
    return res.status(400).json({ error: `metric must be one of: ${METRICS.join(', ')}` });
  }
  if (metric === 'targetProfiles') {
    return res.json({ breakdown: [] });
  }

  const rows = db
    .prepare(`SELECT tp.id, tp.name, ${BREAKDOWN_SUBQUERIES[metric]} AS value FROM target_profiles tp WHERE tp.organization_id = ? ORDER BY value DESC`)
    .all(req.user.organizationId);
  res.json({ breakdown: rows });
});

module.exports = router;
