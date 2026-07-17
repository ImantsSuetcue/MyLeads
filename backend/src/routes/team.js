const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { hashPassword } = require('../utils/passwords');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

// Mounted at /api/team. Reads are open to any org user (so members can see
// colleagues/groups); every mutation is Manager-only.
const router = express.Router();

function requireOrgUser(req, res, next) {
  if (!req.user.organizationId) {
    return res.status(403).json({ error: 'Platform-Admins have no organization-level access here' });
  }
  next();
}

router.use(requireAuth, requireOrgUser);

// --- Users ------------------------------------------------------------

router.get('/users', (req, res) => {
  const users = db
    .prepare('SELECT id, email, full_name, role, created_at FROM users WHERE organization_id = ? ORDER BY created_at ASC')
    .all(req.user.organizationId);

  const groupLinks = db
    .prepare(
      `SELECT gm.user_id, g.id AS group_id, g.name AS group_name
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       WHERE g.organization_id = ?`
    )
    .all(req.user.organizationId);

  const usersWithGroups = users.map((u) => ({
    ...u,
    groups: groupLinks.filter((g) => g.user_id === u.id).map((g) => ({ id: g.group_id, name: g.group_name })),
  }));

  const organization = db.prepare('SELECT license_count FROM organizations WHERE id = ?').get(req.user.organizationId);

  res.json({ users: usersWithGroups, licenseCount: organization.license_count, usedLicenses: users.length });
});

// Manager creates the teammate's account directly (email + password they set and
// share out-of-band) — no invite-token/email flow yet (that needs Phase 5's email
// sending). Blocked once the organization's license count is reached.
router.post('/users', requireRole('manager'), async (req, res) => {
  const { email, fullName, password, role } = req.body || {};
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password and role are required' });
  }
  if (!['manager', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "manager" or "member"' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const organization = db.prepare('SELECT license_count FROM organizations WHERE id = ?').get(req.user.organizationId);
  const usedLicenses = db
    .prepare('SELECT count(*) AS c FROM users WHERE organization_id = ?')
    .get(req.user.organizationId).c;
  if (usedLicenses >= organization.license_count) {
    return res.status(403).json({
      error: `Lizenzlimit erreicht (${organization.license_count} von ${organization.license_count} belegt). Bitte zusätzliche Lizenzen dazubuchen.`,
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  const id = newId();
  const passwordHash = await hashPassword(password);
  db.prepare(
    'INSERT INTO users (id, organization_id, email, password_hash, role, full_name) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, req.user.organizationId, email, passwordHash, role, fullName || null);

  const user = db.prepare('SELECT id, email, full_name, role, created_at FROM users WHERE id = ?').get(id);
  res.status(201).json({ user });
});

router.delete('/users/:userId', requireRole('manager'), (req, res) => {
  if (req.params.userId === req.user.sub) {
    return res.status(400).json({ error: 'Du kannst dich nicht selbst entfernen.' });
  }
  const changes = db
    .prepare('DELETE FROM users WHERE id = ? AND organization_id = ?')
    .run(req.params.userId, req.user.organizationId).changes;
  if (!changes) {
    return res.status(404).json({ error: 'User not found' });
  }
  db.prepare('DELETE FROM group_members WHERE user_id = ?').run(req.params.userId);
  res.json({ ok: true });
});

// --- Groups -------------------------------------------------------------

router.get('/groups', (req, res) => {
  const groups = db
    .prepare('SELECT * FROM groups WHERE organization_id = ? ORDER BY created_at ASC')
    .all(req.user.organizationId);

  const members = db
    .prepare(
      `SELECT gm.group_id, u.id AS user_id, u.email, u.full_name
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id IN (SELECT id FROM groups WHERE organization_id = ?)`
    )
    .all(req.user.organizationId);

  const groupsWithMembers = groups.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.group_id === g.id)
      .map((m) => ({ id: m.user_id, email: m.email, fullName: m.full_name })),
  }));

  res.json({ groups: groupsWithMembers });
});

router.post('/groups', requireRole('manager'), (req, res) => {
  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const id = newId();
  db.prepare('INSERT INTO groups (id, organization_id, name) VALUES (?, ?, ?)').run(id, req.user.organizationId, name);
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  res.status(201).json({ group });
});

router.delete('/groups/:groupId', requireRole('manager'), (req, res) => {
  const group = db
    .prepare('SELECT id FROM groups WHERE id = ? AND organization_id = ?')
    .get(req.params.groupId, req.user.organizationId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }
  db.prepare('DELETE FROM list_permissions WHERE group_id = ?').run(group.id);
  db.prepare('DELETE FROM group_members WHERE group_id = ?').run(group.id);
  db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
  res.json({ ok: true });
});

router.post('/groups/:groupId/members', requireRole('manager'), (req, res) => {
  const group = db
    .prepare('SELECT id FROM groups WHERE id = ? AND organization_id = ?')
    .get(req.params.groupId, req.user.organizationId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }
  const { userId } = req.body || {};
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND organization_id = ?').get(userId, req.user.organizationId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const existing = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, userId);
  if (!existing) {
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group.id, userId);
  }
  res.status(201).json({ ok: true });
});

router.delete('/groups/:groupId/members/:userId', requireRole('manager'), (req, res) => {
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.groupId, req.params.userId);
  res.json({ ok: true });
});

module.exports = router;
