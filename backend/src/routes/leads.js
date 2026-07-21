const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { canAccessProfile } = require('../services/listAccess');
const { newId } = require('../utils/ids');

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

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

// Shared by the status/notes routes below: loads the lead scoped to this org+profile
// and checks list access. Returns null (and has already sent the error response) on failure.
function loadAccessibleLead(req, res) {
  const lead = db
    .prepare('SELECT * FROM leads WHERE id = ? AND target_profile_id = ? AND organization_id = ?')
    .get(req.params.leadId, req.params.profileId, req.user.organizationId);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return null;
  }
  if (!canAccessProfile({ userId: req.user.sub, role: req.user.role, targetProfileId: lead.target_profile_id })) {
    res.status(403).json({ error: 'No access to this list' });
    return null;
  }
  return lead;
}

router.patch('/:leadId/status', (req, res) => {
  const lead = loadAccessibleLead(req, res);
  if (!lead) return;

  const { status } = req.body;
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${LEAD_STATUSES.join(', ')}` });
  }

  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, lead.id);
  if (status !== lead.status) {
    db.prepare(
      'INSERT INTO lead_status_history (id, lead_id, user_id, old_status, new_status) VALUES (?, ?, ?, ?, ?)'
    ).run(newId(), lead.id, req.user.sub, lead.status, status);
  }
  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
  res.json({ lead: updated });
});

router.get('/:leadId/status-history', (req, res) => {
  const lead = loadAccessibleLead(req, res);
  if (!lead) return;

  const history = db
    .prepare(
      `SELECT h.*, u.full_name, u.email
       FROM lead_status_history h
       JOIN users u ON u.id = h.user_id
       WHERE h.lead_id = ?
       ORDER BY h.changed_at DESC`
    )
    .all(lead.id);

  res.json({ history });
});

router.get('/:leadId/notes', (req, res) => {
  const lead = loadAccessibleLead(req, res);
  if (!lead) return;

  const notes = db
    .prepare(
      `SELECT n.*, u.full_name, u.email
       FROM notes n
       JOIN users u ON u.id = n.user_id
       WHERE n.lead_id = ?
       ORDER BY n.created_at DESC`
    )
    .all(lead.id);

  res.json({ notes });
});

router.post('/:leadId/notes', (req, res) => {
  const lead = loadAccessibleLead(req, res);
  if (!lead) return;

  const body = (req.body.body || '').trim();
  if (!body) {
    return res.status(400).json({ error: 'body is required' });
  }

  const id = newId();
  db.prepare('INSERT INTO notes (id, lead_id, user_id, body) VALUES (?, ?, ?, ?)').run(id, lead.id, req.user.sub, body);
  const note = db
    .prepare(
      `SELECT n.*, u.full_name, u.email
       FROM notes n
       JOIN users u ON u.id = n.user_id
       WHERE n.id = ?`
    )
    .get(id);

  res.status(201).json({ note });
});

module.exports = router;
