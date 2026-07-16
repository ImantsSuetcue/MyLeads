// Generates an in-depth research mini-report for a search run's best leads,
// gated by the organization's subscription plan (config/plans.js
// deepResearchLeadLimit: starter=0, team=10, enterprise=25). Kept as its own
// service so "how many leads get a report" and "how a report is generated"
// can evolve independently of the rest of the lead-finding pipeline.
const db = require('../db/db');
const { newId } = require('../utils/ids');
const claudeClient = require('./claudeClient');
const plans = require('../config/plans');

const SCORE_RANK = { high: 3, medium: 2, low: 1 };

function rankLead(lead) {
  return SCORE_RANK[lead.score] || 0;
}

async function runForSearch(searchRunId) {
  const searchRun = db.prepare('SELECT * FROM search_runs WHERE id = ?').get(searchRunId);
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(searchRun.organization_id);
  const targetProfile = db.prepare('SELECT * FROM target_profiles WHERE id = ?').get(searchRun.target_profile_id);

  const planDef = plans[organization.plan];
  const limit = planDef ? planDef.deepResearchLeadLimit : 0;
  if (!limit || limit <= 0) {
    return; // e.g. Starter plan — no deep research included
  }

  // Best-scoring leads first (stable sort keeps ties in original/creation order).
  const leads = db
    .prepare('SELECT * FROM leads WHERE search_run_id = ? ORDER BY created_at ASC')
    .all(searchRunId)
    .sort((a, b) => rankLead(b) - rankLead(a))
    .slice(0, limit);

  for (const lead of leads) {
    try {
      const report = await claudeClient.researchLeadDeep(lead, targetProfile);
      db.prepare(
        `INSERT INTO lead_reports
          (id, lead_id, news_summary, company_kpis, company_stage, fit_category, fit_reasoning, sales_talking_points, sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        lead.id,
        report.newsSummary,
        JSON.stringify(report.companyKpis || {}),
        report.companyStage,
        report.fitCategory,
        report.fitReasoning,
        JSON.stringify(report.salesTalkingPoints || []),
        JSON.stringify(report.sources || [])
      );
    } catch (err) {
      // Best-effort: one lead's research failing must not affect the others.
    }
  }
}

module.exports = { runForSearch };
