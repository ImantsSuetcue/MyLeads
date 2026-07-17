const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { memberAccessClause } = require('../services/listAccess');

// Mounted at /api/leads — cross-profile lead list for the whole organization,
// powering the top-level "Leads" nav page. The nested /target-profiles/:id/leads
// (routes/leads.js) stays as the per-profile view used from target-profile.html.
const router = express.Router();

function requireOrgUser(req, res, next) {
  if (!req.user.organizationId) {
    return res.status(403).json({ error: 'Platform-Admins have no organization-level access here' });
  }
  next();
}

router.use(requireAuth, requireOrgUser);

router.get('/', (req, res) => {
  let sql = `SELECT l.*, c.first_name, c.last_name, c.job_title, c.email, c.phone, c.linkedin_url,
                    tp.name AS target_profile_name
             FROM leads l
             LEFT JOIN contacts c ON c.lead_id = l.id
             LEFT JOIN target_profiles tp ON tp.id = l.target_profile_id
             WHERE l.organization_id = ?`;
  const params = [req.user.organizationId];

  if (req.user.role === 'member') {
    sql += ` AND ${memberAccessClause('l.target_profile_id')}`;
    params.push(req.user.sub, req.user.sub);
  }

  sql += ' ORDER BY l.created_at DESC';

  const leads = db.prepare(sql).all(...params);
  res.json({ leads });
});

module.exports = router;
