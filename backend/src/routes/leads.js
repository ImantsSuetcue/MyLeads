const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { canAccessProfile } = require('../services/listAccess');

// Mounted at /api/target-profiles/:profileId/leads — mergeParams gives us :profileId.
const router = express.Router({ mergeParams: true });

function requireOrgUser(req, res, next) {
  if (!req.user.organizationId) {
    return res.status(403).json({ error: 'Platform-Admins have no organization-level access here' });
  }
  next();
}

router.use(requireAuth, requireOrgUser);

// Leads joined with their one contact (Phase 1: exactly one contact per lead).
// Optional ?searchRunId= filters to a single run instead of the whole profile.
router.get('/', (req, res) => {
  const profile = db
    .prepare('SELECT id FROM target_profiles WHERE id = ? AND organization_id = ?')
    .get(req.params.profileId, req.user.organizationId);
  if (!profile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }
  if (!canAccessProfile({ userId: req.user.sub, role: req.user.role, targetProfileId: profile.id })) {
    return res.status(403).json({ error: 'No access to this list' });
  }

  const params = [profile.id];
  let where = 'l.target_profile_id = ?';
  if (req.query.searchRunId) {
    where += ' AND l.search_run_id = ?';
    params.push(req.query.searchRunId);
  }

  const leads = db
    .prepare(
      `SELECT l.*, c.first_name, c.last_name, c.job_title, c.email, c.phone, c.linkedin_url
       FROM leads l
       LEFT JOIN contacts c ON c.lead_id = l.id
       WHERE ${where}
       ORDER BY l.created_at DESC`
    )
    .all(...params);

  res.json({ leads });
});

// Single-lead detail, including its deep-research report if one exists (see
// services/deepResearch.js). The frontend uses this to render lead-detail.html.
router.get('/:leadId', (req, res) => {
  const lead = db
    .prepare(
      `SELECT l.*, c.first_name, c.last_name, c.job_title, c.email, c.phone, c.linkedin_url
       FROM leads l
       LEFT JOIN contacts c ON c.lead_id = l.id
       WHERE l.id = ? AND l.target_profile_id = ? AND l.organization_id = ?`
    )
    .get(req.params.leadId, req.params.profileId, req.user.organizationId);

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }
  if (!canAccessProfile({ userId: req.user.sub, role: req.user.role, targetProfileId: lead.target_profile_id })) {
    return res.status(403).json({ error: 'No access to this list' });
  }

  const reportRow = db.prepare('SELECT * FROM lead_reports WHERE lead_id = ?').get(lead.id);
  const report = reportRow
    ? {
        newsSummary: reportRow.news_summary,
        companyKpis: JSON.parse(reportRow.company_kpis || '{}'),
        companyStage: reportRow.company_stage,
        fitCategory: reportRow.fit_category,
        fitReasoning: reportRow.fit_reasoning,
        valueProposition: reportRow.value_proposition,
        salesTalkingPoints: JSON.parse(reportRow.sales_talking_points || '[]'),
        sources: JSON.parse(reportRow.sources || '[]'),
        generatedAt: reportRow.generated_at,
      }
    : null;

  res.json({ lead, report });
});

module.exports = router;
