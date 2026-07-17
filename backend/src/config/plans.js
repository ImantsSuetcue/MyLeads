// Plan definitions for the hybrid package+license Stripe model.
// Prices/quotas here are starting defaults — change freely, incl. later editing
// directly in the Stripe Dashboard once real Products/Prices exist. Pricing is
// set at typical sales-intelligence-SaaS levels (comparable tools in this
// category run roughly $50-150/seat/month) rather than generic-SaaS pricing.
//
// deepResearchLeadLimit: how many of a search run's leads (best score first)
// get an automatic Phase-2 deep-research report (see services/deepResearch.js).
// Spec says Enterprise = "all leads" — capped here at 25 so one search can't
// run unboundedly long (each report costs two extra Claude calls per lead).
//
// extraLicensePriceEur: flat add-on price per extra seat/month, same across
// plans, used by the "zusätzliche Lizenzen dazubuchen" checkout (Phase 3).
module.exports = {
  starter: {
    key: 'starter',
    label: 'Starter',
    monthlyPriceEur: 199,
    includedLicenses: 3,
    searchQuotaMonthly: 150,
    deepResearchLeadLimit: 0,
    extraLicensePriceEur: 79,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || '',
  },
  team: {
    key: 'team',
    label: 'Team',
    monthlyPriceEur: 599,
    includedLicenses: 10,
    searchQuotaMonthly: 750,
    deepResearchLeadLimit: 10,
    extraLicensePriceEur: 79,
    stripePriceId: process.env.STRIPE_PRICE_TEAM || '',
  },
  enterprise: {
    key: 'enterprise',
    label: 'Enterprise',
    monthlyPriceEur: 1499,
    includedLicenses: 25,
    searchQuotaMonthly: 3000,
    deepResearchLeadLimit: 25,
    extraLicensePriceEur: 79,
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || '',
  },
};
