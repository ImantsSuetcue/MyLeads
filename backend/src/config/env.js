// Loads and validates environment variables in one place, so nothing else
// in the app calls process.env directly.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const asBool = (value) => String(value).toLowerCase() === 'true';

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_FILE: path.join(__dirname, '..', '..', 'data', process.env.DB_FILE_NAME || 'myleads.db'),
  JWT_SECRET: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  // CORS_ORIGIN must be scheme+host+port only (browsers never send a path in the
  // Origin header) — e.g. http://127.0.0.1:5500, NOT .../frontend.
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  // Base URL used to build links back to the frontend (mock Stripe checkout page,
  // real Stripe success/cancel URLs). Unlike CORS_ORIGIN this MAY include a path —
  // set it to wherever Live Server actually serves index.html from. If you open
  // frontend/index.html directly with VS Code's Live Server, it serves from the
  // project root, so the default below (with the /frontend suffix) is correct.
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5500/frontend',

  // When true, claudeClient/apolloClient/stripeClient return fake data instead of
  // calling real APIs. Lets the whole app be built and tested before real keys exist.
  MOCK_MODE: asBool(process.env.MOCK_MODE ?? 'true'),

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  APOLLO_API_KEY: process.env.APOLLO_API_KEY || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',

  PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL || '',
  PLATFORM_ADMIN_PASSWORD: process.env.PLATFORM_ADMIN_PASSWORD || '',

  MAX_LEADS_PER_SEARCH: Number(process.env.MAX_LEADS_PER_SEARCH || 20),

  // Compliance scraper: minimum wait between two requests to the same domain (ms).
  SCRAPER_MIN_DELAY_MS: Number(process.env.SCRAPER_MIN_DELAY_MS || 3000),
};
