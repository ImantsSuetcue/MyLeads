// Isolates all Stripe-specific code. In MOCK_MODE, mimics the same shapes
// (a checkout URL, a portal URL) with a local fake page instead of calling Stripe,
// so the rest of the app never needs to know which mode it's in.
const Stripe = require('stripe');
const env = require('../config/env');
const plans = require('../config/plans');

const stripe = !env.MOCK_MODE && env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

const FRONTEND_URL = env.FRONTEND_BASE_URL;

async function createCheckoutSession({ organization, planKey, userEmail }) {
  const plan = plans[planKey];
  if (!plan) throw new Error(`Unknown plan: ${planKey}`);

  if (env.MOCK_MODE) {
    const sessionId = `mock_sess_${organization.id}_${Date.now()}`;
    return {
      sessionId,
      url: `${FRONTEND_URL}/mock-checkout.html?session_id=${sessionId}&org_id=${organization.id}&plan=${planKey}`,
    };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: userEmail,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${FRONTEND_URL}/dashboard.html?checkout=success`,
    cancel_url: `${FRONTEND_URL}/register.html?checkout=cancelled`,
    metadata: { organization_id: organization.id, plan: planKey },
  });

  return { sessionId: session.id, url: session.url };
}

async function createBillingPortalSession({ organization }) {
  if (env.MOCK_MODE) {
    return { url: `${FRONTEND_URL}/dashboard.html?billing=mock-portal` };
  }
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: organization.stripe_customer_id,
    return_url: `${FRONTEND_URL}/dashboard.html`,
  });
  return { url: portalSession.url };
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { createCheckoutSession, createBillingPortalSession, constructWebhookEvent };
