const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { canAccessProfile, memberAccessClause } = require('../services/listAccess');

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

// Managers/Platform-Admins see every profile. Members only see profiles granted to
// them directly or via a group they belong to (see services/listAccess.js).
router.get('/', (req, res) => {
  let sql = 'SELECT * FROM target_profiles WHERE organization_id = ?';
  const params = [req.user.organizationId];
  if (req.user.role === 'member') {
    sql += ` AND ${memberAccessClause('id')}`;
    params.push(req.user.sub, req.user.sub);
  }
  sql += ' ORDER BY created_at DESC';

  const profiles = db.prepare(sql).all(...params);
  res.json({ targetProfiles: profiles });
});

router.get('/:id', (req, res) => {
  const profile = db
    .prepare('SELECT * FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.id, req.user.organizationId);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }
  if (!canAccessProfile({ userId: req.user.sub, role: req.user.role, targetProfileId: profile.id })) {
    return res.status(403).json({ error: 'No access to this list' });
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

// --- List permissions ("Zugriff verwalten") — who can see this list/board ---------
// Manager-only, both to view and to change: this is exactly the "Manager grants
// access" mechanism from the spec, not something a member can inspect or self-serve.

router.get('/:id/permissions', requireRole('manager'), (req, res) => {
  const profile = db
    .prepare('SELECT id FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.id, req.user.organizationId);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }

  const grants = db
    .prepare(
      `SELECT lp.id, lp.user_id, lp.group_id, lp.is_default_for_group, lp.created_at,
              u.email AS user_email, u.full_name AS user_full_name,
              g.name AS group_name
       FROM list_permissions lp
       LEFT JOIN users u ON u.id = lp.user_id
       LEFT JOIN groups g ON g.id = lp.group_id
       WHERE lp.target_profile_id = ?
       ORDER BY lp.created_at DESC`
    )
    .all(profile.id);

  res.json({ permissions: grants });
});

router.post('/:id/permissions', requireRole('manager'), (req, res) => {
  const profile = db
    .prepare('SELECT id FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.id, req.user.organizationId);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }

  const { userId, groupId, isDefaultForGroup } = req.body || {};
  if (!userId && !groupId) {
    return res.status(400).json({ error: 'userId or groupId is required' });
  }
  if (userId && groupId) {
    return res.status(400).json({ error: 'Provide either userId or groupId, not both' });
  }
  if (userId) {
    const user = db.prepare('SELECT id FROM users WHERE id = ? AND organization_id = ?').get(userId, req.user.organizationId);
    if (!user) return res.status(404).json({ error: 'User not found in this organization' });
  }
  if (groupId) {
    const group = db.prepare('SELECT id FROM groups WHERE id = ? AND organization_id = ?').get(groupId, req.user.organizationId);
    if (!group) return res.status(404).json({ error: 'Group not found in this organization' });
  }

  const id = newId();
  db.prepare(
    `INSERT INTO list_permissions (id, organization_id, target_profile_id, user_id, group_id, is_default_for_group)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.organizationId, profile.id, userId || null, groupId || null, isDefaultForGroup ? 1 : 0);

  res.status(201).json({ id });
});

router.delete('/:id/permissions/:permissionId', requireRole('manager'), (req, res) => {
  const changes = db
    .prepare('DELETE FROM list_permissions WHERE id = ? AND target_profile_id = ? AND organization_id = ?')
    .run(req.params.permissionId, req.params.id, req.user.organizationId).changes;
  if (!changes) {
    return res.status(404).json({ error: 'Permission not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
