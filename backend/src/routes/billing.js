const express = require('express');
const db = require('../db/db');
const env = require('../config/env');
const stripeClient = require('../services/stripeClient');

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
    const organizationId = session.metadata && session.metadata.organization_id;
    if (organizationId) {
      db.prepare(
        `UPDATE organizations SET subscription_status = 'active', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`
      ).run(session.customer, session.subscription, organizationId);
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

module.exports = { router, webhookHandler };
