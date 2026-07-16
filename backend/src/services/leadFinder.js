// Orchestrates the lead-finding pipeline for one search run. Kept as its own
// service (separate from the routes) so a piece — e.g. Apollo — can be swapped
// for another provider without touching the DB layer or HTTP routes.
//
// Stage 1: claudeClient.extractCriteria    — free text -> structured filters
// Stage 2: apolloClient.searchPeople       — filters -> real companies + contacts
// Stage 2.5: complianceScraper.scrapeCompany — fills industry/size gaps Apollo left, via each lead's own domain
// Stage 3: claudeClient.enrichLead         — per-lead "why this fits" reasoning
// Stage 4: deepResearch.runForSearch       — deep-dive report for top leads (plan-gated)
const db = require('../db/db');
const { newId } = require('../utils/ids');
const claudeClient = require('./claudeClient');
const apolloClient = require('./apolloClient');
const complianceScraper = require('./complianceScraper');
const deepResearch = require('./deepResearch');

async function runSearch(searchRunId) {
  const searchRun = db.prepare('SELECT * FROM search_runs WHERE id = ?').get(searchRunId);
  const targetProfile = db.prepare('SELECT * FROM target_profiles WHERE id = ?').get(searchRun.target_profile_id);

  db.prepare("UPDATE search_runs SET status = 'running' WHERE id = ?").run(searchRunId);

  try {
    const criteria = await claudeClient.extractCriteria(targetProfile);
    db.prepare('UPDATE search_runs SET criteria_json = ? WHERE id = ?').run(JSON.stringify(criteria), searchRunId);

    const results = await apolloClient.searchPeople(criteria);
    const domains = new Set();
    const insertedLeads = [];

    for (const result of results) {
      const leadId = newId();
      db.prepare(
        `INSERT INTO leads
          (id, search_run_id, target_profile_id, organization_id, company_name, company_domain, company_industry, company_size, source, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'apollo', 'new')`
      ).run(
        leadId,
        searchRunId,
        targetProfile.id,
        targetProfile.organization_id,
        result.company.name,
        result.company.domain,
        result.company.industry,
        result.company.size
      );

      db.prepare(
        `INSERT INTO contacts (id, lead_id, first_name, last_name, job_title, email, phone, linkedin_url, source_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        leadId,
        result.person.firstName,
        result.person.lastName,
        result.person.title,
        result.person.email,
        result.person.phone,
        result.person.linkedinUrl,
        result.person.sourcePersonId
      );

      if (result.company.domain) domains.add(result.company.domain);
      insertedLeads.push({
        id: leadId,
        company_name: result.company.name,
        company_domain: result.company.domain,
        company_industry: result.company.industry,
        company_size: result.company.size,
      });
    }

    db.prepare(
      'UPDATE search_runs SET leads_found_count = ?, companies_found_count = ?, contacts_found_count = ? WHERE id = ?'
    ).run(results.length, domains.size, results.length, searchRunId);

    // Stage 2.5: for leads Apollo left incomplete (missing industry or size) but with a
    // known domain, try to fill the gap via our own compliance-safe scraper. Rate limiting
    // is per-domain, so different domains are scraped in parallel; one domain's failure
    // must never fail the whole search run.
    const gapLeads = insertedLeads.filter(
      (lead) => lead.company_domain && (!lead.company_industry || !lead.company_size)
    );
    await Promise.all(
      gapLeads.map(async (lead) => {
        try {
          const scraped = await complianceScraper.scrapeCompany(lead.company_domain);
          if (!scraped) return;

          const filledIndustry = lead.company_industry || scraped.industry || null;
          const filledSize = lead.company_size || scraped.companySize || null;
          if (filledIndustry === lead.company_industry && filledSize === lead.company_size) return;

          db.prepare(
            "UPDATE leads SET company_industry = ?, company_size = ?, industry_size_source = 'scraper' WHERE id = ?"
          ).run(filledIndustry, filledSize, lead.id);

          // Keep the in-memory copy in sync so the enrichLead prompt below sees the filled data.
          lead.company_industry = filledIndustry;
          lead.company_size = filledSize;
        } catch (err) {
          // Best-effort: a scraper hiccup on one domain should never fail the whole search.
        }
      })
    );

    // Stage 3: enrich each lead with a "why this fits" reasoning, an individual value
    // proposition, and a fit score.
    for (const lead of insertedLeads) {
      const { reasoning, valueProposition, score } = await claudeClient.enrichLead(lead, targetProfile);
      db.prepare(
        'UPDATE leads SET ai_reasoning = ?, value_proposition = ?, score = ? WHERE id = ?'
      ).run(reasoning, valueProposition, score, lead.id);
    }

    db.prepare("UPDATE search_runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(
      searchRunId
    );

    // Stage 4: deep-research reports for the best leads (plan-gated, see deepResearch.js).
    // Runs after the search is already marked completed — a failure here must never flip
    // the run back to failed; the base results are already saved.
    try {
      await deepResearch.runForSearch(searchRunId);
    } catch (err) {
      // Best-effort — see comment above.
    }

    return db.prepare('SELECT * FROM search_runs WHERE id = ?').get(searchRunId);
  } catch (err) {
    db.prepare("UPDATE search_runs SET status = 'failed', error_message = ? WHERE id = ?").run(err.message, searchRunId);
    throw err;
  }
}

module.exports = { runSearch };
