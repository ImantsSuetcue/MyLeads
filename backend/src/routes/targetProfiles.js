const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

// Field names match the target_profiles DB columns 1:1, so no camelCase<->snake_case
// mapping layer is needed for this resource.
const UPDATABLE_FIELDS = ['name', 'product_description', 'target_audience', 'region', 'industry', 'contact_role', 'goals'];

function requireOrgUser(req, res, next) {
  if (!req.user.organizationId) {
    return res.status(403).json({ error: 'Platform-Admins have no organization-level access here' });
  }
  next();
}

router.use(requireAuth, requireOrgUser);

// Phase 1: every org member can see every target profile. Per-list visibility via
// groups/list_permissions (the "Manager grants access" model from the spec) is Phase 2.
router.get('/', (req, res) => {
  const profiles = db
    .prepare('SELECT * FROM target_profiles WHERE organization_id = ? ORDER BY created_at DESC')
    .all(req.user.organizationId);
  res.json({ targetProfiles: profiles });
});

router.get('/:id', (req, res) => {
  const profile = db
    .prepare('SELECT * FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.id, req.user.organizationId);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }
  res.json({ targetProfile: profile });
});

// Only Managers start new company-wide target profiles (spec: members cannot).
router.post('/', requireRole('manager'), (req, res) => {
  const { name, product_description, target_audience, region, industry, contact_role, goals } = req.body || {};
  if (!name || !product_description) {
    return res.status(400).json({ error: 'name and product_description are required' });
  }

  const id = newId();
  db.prepare(
    `INSERT INTO target_profiles
      (id, organization_id, created_by_user_id, name, product_description, target_audience, region, industry, contact_role, goals)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.organizationId,
    req.user.sub,
    name,
    product_description,
    target_audience || null,
    region || null,
    industry || null,
    contact_role || null,
    goals || null
  );

  const profile = db.prepare('SELECT * FROM target_profiles WHERE id = ?').get(id);
  res.status(201).json({ targetProfile: profile });
});

router.patch('/:id', requireRole('manager'), (req, res) => {
  const existing = db
    .prepare('SELECT id FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.id, req.user.organizationId);
  if (!existing) {
    return res.status(404).json({ error: 'Target profile not found' });
  }

  const updates = req.body || {};
  const setClauses = [];
  const values = [];
  for (const field of UPDATABLE_FIELDS) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  values.push(req.params.id);
  db.prepare(`UPDATE target_profiles SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM target_profiles WHERE id = ?').get(req.params.id);
  res.json({ targetProfile: updated });
});

module.exports = router;
