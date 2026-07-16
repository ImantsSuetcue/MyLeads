// Placeholder plan definitions for the hybrid package+license Stripe model.
// Prices/quotas here are starting defaults — change freely, incl. later editing
// directly in the Stripe Dashboard once real Products/Prices exist.
//
// deepResearchLeadLimit: how many of a search run's leads (best score first)
// get an automatic Phase-2 deep-research report (see services/deepResearch.js).
// Spec says Enterprise = "all leads" — capped here at 25 so one search can't
// run unboundedly long (each report costs two extra Claude calls per lead).
module.exports = {
  starter: {
    key: 'starter',
    label: 'Starter',
    monthlyPriceEur: 49,
    includedLicenses: 3,
    searchQuotaMonthly: 100,
    deepResearchLeadLimit: 0,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || '',
  },
  team: {
    key: 'team',
    label: 'Team',
    monthlyPriceEur: 149,
    includedLicenses: 10,
    searchQuotaMonthly: 500,
    deepResearchLeadLimit: 10,
    stripePriceId: process.env.STRIPE_PRICE_TEAM || '',
  },
  enterprise: {
    key: 'enterprise',
    label: 'Enterprise',
    monthlyPriceEur: 399,
    includedLicenses: 25,
    searchQuotaMonthly: 2000,
    deepResearchLeadLimit: 25,
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || '',
  },
};
