const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const leadFinder = require('../services/leadFinder');

// Mounted at /api/target-profiles/:profileId/searches — mergeParams gives us :profileId.
const router = express.Router({ mergeParams: true });

function requireOrgUser(req, res, next) {
  if (!req.user.organizationId) {
    return res.status(403).json({ error: 'Platform-Admins have no organization-level access here' });
  }
  next();
}

router.use(requireAuth, requireOrgUser);

function findProfile(req) {
  return db
    .prepare('SELECT * FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.profileId, req.user.organizationId);
}

router.get('/', (req, res) => {
  const profile = findProfile(req);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }
  const runs = db
    .prepare('SELECT * FROM search_runs WHERE target_profile_id = ? ORDER BY started_at DESC')
    .all(profile.id);
  res.json({ searchRuns: runs });
});

router.get('/:runId', (req, res) => {
  const profile = findProfile(req);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }
  const run = db
    .prepare('SELECT * FROM search_runs WHERE id = ? AND target_profile_id = ?')
    .get(req.params.runId, profile.id);
  if (!run) {
    return res.status(404).json({ error: 'Search run not found' });
  }
  res.json({ searchRun: run });
});

// Starting a new search (or repeating one) is a Manager action.
router.post('/', requireRole('manager'), async (req, res) => {
  const profile = findProfile(req);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }

  const id = newId();
  db.prepare(
    "INSERT INTO search_runs (id, target_profile_id, organization_id, status) VALUES (?, ?, ?, 'pending')"
  ).run(id, profile.id, req.user.organizationId);

  try {
    const searchRun = await leadFinder.runSearch(id);
    res.status(201).json({ searchRun });
  } catch (err) {
    res.status(500).json({ error: `Search failed: ${err.message}` });
  }
});

module.exports = router;
