const express = require('express');
const db = require('../db/db');
const { newId } = require('../utils/ids');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const { signToken } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const plans = require('../config/plans');
const stripeClient = require('../services/stripeClient');

const router = express.Router();

function toPublicUser(user) {
  return { id: user.id, email: user.email, role: user.role, fullName: user.full_name };
}

// Self-registration: creates the organization, makes the first user its "manager",
// and kicks off Stripe Checkout for the chosen plan (see stripeClient for MOCK_MODE behavior).
router.post('/register', async (req, res) => {
  const { companyName, plan, email, password, fullName } = req.body || {};

  if (!companyName || !plan || !email || !password) {
    return res.status(400).json({ error: 'companyName, plan, email and password are required' });
  }
  const planDef = plans[plan];
  if (!planDef) {
    return res.status(400).json({ error: `Unknown plan: ${plan}` });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  const organizationId = newId();
  db.prepare(
    `INSERT INTO organizations (id, name, plan, subscription_status, license_count, search_quota_monthly)
     VALUES (?, ?, ?, 'pending_checkout', ?, ?)`
  ).run(organizationId, companyName, plan, planDef.includedLicenses, planDef.searchQuotaMonthly);

  const userId = newId();
  const passwordHash = await hashPassword(password);
  db.prepare(
    `INSERT INTO users (id, organization_id, email, password_hash, role, full_name)
     VALUES (?, ?, ?, ?, 'manager', ?)`
  ).run(userId, organizationId, email, passwordHash, fullName || null);

  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const checkout = await stripeClient.createCheckoutSession({ organization, planKey: plan, userEmail: email });

  res.status(201).json({
    token: signToken(user),
    organization,
    user: toPublicUser(user),
    checkoutUrl: checkout.url,
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const organization = user.organization_id
    ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.organization_id)
    : null;

  res.json({ token: signToken(user), organization, user: toPublicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const organization = user.organization_id
    ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.organization_id)
    : null;

  res.json({ user: toPublicUser(user), organization });
});

module.exports = router;
