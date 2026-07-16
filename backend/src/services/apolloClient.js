// Wraps the Apollo.io People Search API. Kept isolated behind searchPeople()
// so leadFinder.js never has to change if Apollo is swapped for another
// provider later (e.g. Hunter.io, per the Phase 5 roadmap).
//
// NOTE: field names below follow Apollo's documented People Search endpoint
// as of this writing. Since we don't have a live Apollo key yet, verify the
// exact request/response field names against your Apollo account's API docs
// once you have access, and adjust buildSearchParams()/normalizePerson() here
// if anything differs — that's the only place it needs to change.
const env = require('../config/env');
const mockProviders = require('./mockProviders');

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1';

function buildSearchParams(criteria, perPage) {
  return {
    person_titles: criteria.job_titles || [],
    organization_locations: criteria.locations || [],
    organization_num_employees_ranges: criteria.employee_ranges || [],
    person_seniorities: criteria.seniorities || [],
    q_organization_keyword_tags: [...(criteria.industries || []), ...(criteria.keywords || [])],
    reveal_personal_emails: true,
    page: 1,
    per_page: perPage,
  };
}

function normalizePerson(person) {
  const org = person.organization || {};
  const email = person.email && !String(person.email).includes('not_unlocked') ? person.email : null;
  return {
    company: {
      name: org.name || 'Unbekannte Firma',
      domain: org.primary_domain || org.website_url || null,
      industry: org.industry || null,
      size: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
    },
    person: {
      firstName: person.first_name || '',
      lastName: person.last_name || '',
      title: person.title || null,
      email,
      phone: null, // Phone reveal is async via an Apollo webhook — deferred past Phase 1.
      linkedinUrl: person.linkedin_url || null,
      sourcePersonId: person.id,
    },
  };
}

async function searchPeople(criteria) {
  const perPage = env.MAX_LEADS_PER_SEARCH;

  if (env.MOCK_MODE) {
    return mockProviders.mockSearchPeople(criteria, perPage);
  }

  const response = await fetch(`${APOLLO_BASE_URL}/mixed_people/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': env.APOLLO_API_KEY,
    },
    body: JSON.stringify(buildSearchParams(criteria, perPage)),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apollo API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return (data.people || []).map(normalizePerson);
}

module.exports = { searchPeople };
