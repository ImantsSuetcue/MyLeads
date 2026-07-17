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
    return { url: `${FRONTEND_URL}/mock-billing-portal.html?org_id=${organization.id}&plan=${organization.plan}` };
  }
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: organization.stripe_customer_id,
    return_url: `${FRONTEND_URL}/settings.html`,
  });
  return { url: portalSession.url };
}

// One-off top-up checkout for extra seats. In MOCK_MODE mirrors the same shape as
// createCheckoutSession(): a local fake page instead of a real Stripe redirect.
async function createLicenseCheckoutSession({ organization, additionalLicenses, costEur }) {
  if (env.MOCK_MODE) {
    const sessionId = `mock_lic_sess_${organization.id}_${Date.now()}`;
    return {
      sessionId,
      url: `${FRONTEND_URL}/mock-license-checkout.html?session_id=${sessionId}&org_id=${organization.id}&additionalLicenses=${additionalLicenses}&costEur=${costEur}`,
    };
  }

  // One-off "payment" checkout (not a subscription-item update) — simplest correct
  // way to charge a top-up without touching the base subscription's line items.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: `${additionalLicenses} zusätzliche Lizenz(en)` },
          unit_amount: Math.round((costEur / additionalLicenses) * 100),
        },
        quantity: additionalLicenses,
      },
    ],
    success_url: `${FRONTEND_URL}/settings.html?licenses=success`,
    cancel_url: `${FRONTEND_URL}/settings.html?licenses=cancelled`,
    metadata: { type: 'license_topup', organization_id: organization.id, additional_licenses: String(additionalLicenses) },
  });

  return { sessionId: session.id, url: session.url };
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

module.exports = {
  createCheckoutSession,
  createBillingPortalSession,
  createLicenseCheckoutSession,
  constructWebhookEvent,
};
