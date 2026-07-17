const express = require('express');
const db = require('../db/db');
const env = require('../config/env');
const plans = require('../config/plans');
const stripeClient = require('../services/stripeClient');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

// This handler needs the RAW request body (for Stripe signature verification), so it is
// registered directly in app.js with express.raw(), before the app's global express.json().
function webhookHandler(req, res) {
  if (env.MOCK_MODE) {
    return res.status(400).json({ error: 'Real webhook is disabled in MOCK_MODE — use /api/billing/mock-complete-checkout' });
  }

  let event;
  try {
    event = stripeClient.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata || {};

    if (metadata.type === 'license_topup' && metadata.organization_id) {
      db.prepare('UPDATE organizations SET license_count = license_count + ? WHERE id = ?').run(
        Number(metadata.additional_licenses || 0),
        metadata.organization_id
      );
    } else if (metadata.organization_id) {
      db.prepare(
        `UPDATE organizations SET subscription_status = 'active', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`
      ).run(session.customer, session.subscription, metadata.organization_id);
    }
  }

  res.json({ received: true });
}

const router = express.Router();

// Mock-only stand-in for the real Stripe webhook above: the fake checkout page calls this
// directly to "complete" the subscription, since there is no real Stripe event to receive.
router.post('/mock-complete-checkout', (req, res) => {
  if (!env.MOCK_MODE) {
    return res.status(400).json({ error: 'Only available while MOCK_MODE=true' });
  }
  const { organizationId } = req.body || {};
  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId is required' });
  }

  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  if (!organization) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  db.prepare(
    `UPDATE organizations SET subscription_status = 'active', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`
  ).run(`mock_cust_${organizationId}`, `mock_sub_${organizationId}`, organizationId);

  res.json({ ok: true });
});

// --- Extra licenses ("zusätzliche Lizenzen dazubuchen") ------------------------

router.post('/licenses/checkout', requireAuth, requireRole('manager'), async (req, res) => {
  const count = Number(req.body && req.body.additionalLicenses);
  if (!Number.isInteger(count) || count <= 0) {
    return res.status(400).json({ error: 'additionalLicenses must be a positive integer' });
  }

  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.organizationId);
  const planDef = plans[organization.plan];
  const costEur = count * planDef.extraLicensePriceEur;

  const checkout = await stripeClient.createLicenseCheckoutSession({ organization, additionalLicenses: count, costEur });
  res.json({ checkoutUrl: checkout.url, costEur });
});

// Mock-only stand-in for the license-topup webhook branch above.
router.post('/licenses/mock-complete-checkout', (req, res) => {
  if (!env.MOCK_MODE) {
    return res.status(400).json({ error: 'Only available while MOCK_MODE=true' });
  }
  const { organizationId } = req.body || {};
  const count = Number(req.body && req.body.additionalLicenses);
  if (!organizationId || !Number.isInteger(count) || count <= 0) {
    return res.status(400).json({ error: 'organizationId and a positive additionalLicenses are required' });
  }

  const organization = db.prepare('SELECT id FROM organizations WHERE id = ?').get(organizationId);
  if (!organization) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  db.prepare('UPDATE organizations SET license_count = license_count + ? WHERE id = ?').run(count, organizationId);
  const updated = db.prepare('SELECT license_count FROM organizations WHERE id = ?').get(organizationId);
  res.json({ ok: true, licenseCount: updated.license_count });
});

// --- Billing Portal (plan switch / cancel) --------------------------------------

router.post('/portal', requireAuth, requireRole('manager'), async (req, res) => {
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.organizationId);
  const portal = await stripeClient.createBillingPortalSession({ organization });
  res.json({ url: portal.url });
});

// Mock-only stand-in for what the real Stripe Billing Portal + webhook would do.
router.post('/mock-change-plan', (req, res) => {
  if (!env.MOCK_MODE) {
    return res.status(400).json({ error: 'Only available while MOCK_MODE=true' });
  }
  const { organizationId, plan, cancel } = req.body || {};
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  if (!organization) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  if (cancel) {
    db.prepare("UPDATE organizations SET subscription_status = 'canceled' WHERE id = ?").run(organizationId);
    return res.json({ ok: true, subscription_status: 'canceled' });
  }

  const planDef = plans[plan];
  if (!planDef) {
    return res.status(400).json({ error: `Unknown plan: ${plan}` });
  }

  // Never silently lock out existing teammates: raise (never lower) license_count
  // to at least the new plan's included seats.
  const newLicenseCount = Math.max(organization.license_count, planDef.includedLicenses);
  db.prepare(
    "UPDATE organizations SET plan = ?, search_quota_monthly = ?, license_count = ?, subscription_status = 'active' WHERE id = ?"
  ).run(plan, planDef.searchQuotaMonthly, newLicenseCount, organizationId);

  const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  res.json({ ok: true, organization: updated });
});

module.exports = { router, webhookHandler };
