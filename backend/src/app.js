const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const plans = require('./config/plans');
const authRoutes = require('./routes/auth');
const { router: billingRoutes, webhookHandler } = require('./routes/billing');
const targetProfilesRoutes = require('./routes/targetProfiles');
const searchesRoutes = require('./routes/searches');
const leadsRoutes = require('./routes/leads');
const allLeadsRoutes = require('./routes/allLeads');
const platformAdminRoutes = require('./routes/platformAdmin');
const teamRoutes = require('./routes/team');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));

// Registered before express.json() below: Stripe needs the raw, unparsed body to
// verify the webhook signature. Every other route uses the parsed JSON body.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mockMode: env.MOCK_MODE });
});

app.get('/api/plans', (req, res) => {
  const publicPlans = Object.values(plans).map(({ stripePriceId, ...rest }) => rest);
  res.json({ plans: publicPlans });
});

app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/target-profiles', targetProfilesRoutes);
app.use('/api/target-profiles/:profileId/searches', searchesRoutes);
app.use('/api/target-profiles/:profileId/leads', leadsRoutes);
app.use('/api/leads', allLeadsRoutes);
app.use('/api/platform-admin', platformAdminRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/dashboard', dashboardRoutes);

module.exports = app;
