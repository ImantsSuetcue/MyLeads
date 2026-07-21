// Deterministic fake data used while MOCK_MODE=true, so the whole app can be
// built and tested before real Anthropic/Apollo/Stripe keys exist.
const FAKE_FIRST_NAMES = ['Anna', 'Jonas', 'Lea', 'Felix', 'Marie', 'Tobias', 'Sophie', 'Lukas'];
const FAKE_LAST_NAMES = ['Schmidt', 'Weber', 'Fischer', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'Koch'];
const FAKE_COMPANY_WORDS = ['Nova', 'Alpin', 'Blue', 'Nordic', 'Bright', 'Summit', 'Quanta', 'Pioneer'];
const FAKE_COMPANY_SUFFIXES = ['Systems', 'Solutions', 'Group', 'Technologies', 'Labs', 'Software', 'Partners'];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function mockExtractCriteria(targetProfile) {
  const jobTitles = (targetProfile.contact_role || 'Head of Sales')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const locations = (targetProfile.region || 'Germany')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const industries = (targetProfile.industry || 'Software')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    industries,
    employee_ranges: ['51,200', '201,500'],
    locations,
    job_titles: jobTitles,
    seniorities: ['head', 'director', 'vp'],
    keywords: industries,
    summary: `Suche nach ${jobTitles.join('/')} bei ${industries.join('/')}-Firmen in ${locations.join('/')} (Mock-Daten).`,
  };
}

function mockSearchPeople(criteria, count = 8) {
  const leads = [];
  for (let i = 0; i < count; i += 1) {
    const companyName = `${pick(FAKE_COMPANY_WORDS, i)} ${pick(FAKE_COMPANY_SUFFIXES, i + 3)}`;
    const domain = `${companyName.toLowerCase().replace(/\s+/g, '')}.example.com`;
    const firstName = pick(FAKE_FIRST_NAMES, i);
    const lastName = pick(FAKE_LAST_NAMES, i + 2);
    // Every 4th mock lead simulates a company Apollo covers incompletely (no
    // industry/size), so the compliance-scraper gap-filling stage has something
    // to actually do when testing against mock data.
    const incomplete = i % 4 === 0;
    leads.push({
      company: {
        name: companyName,
        domain,
        industry: incomplete ? null : criteria.industries?.[0] || 'Software',
        size: incomplete ? null : pick(['51-200', '201-500'], i),
      },
      person: {
        firstName,
        lastName,
        title: criteria.job_titles?.[0] || 'Head of Sales',
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
        phone: null,
        linkedinUrl: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`,
        sourcePersonId: `mock_person_${i}`,
      },
    });
  }
  return leads;
}

function mockEnrichLead(lead, targetProfile) {
  const buckets = ['medium', 'high', 'medium', 'low', 'high'];
  const score = buckets[lead.company_name.length % buckets.length];
  const reasoning =
    `${lead.company_name} passt zum Zielprofil "${targetProfile.name}": das Unternehmen ist in der Branche ` +
    `${lead.company_industry || 'passend zur Zielgruppe'} aktiv und die Firmengröße entspricht der gesuchten ` +
    `Zielgruppe. (Mock-Begründung, da MOCK_MODE=true — mit echtem API-Key würde hier eine auf aktuellen ` +
    `Web-Recherchen basierende Begründung stehen.)`;
  const valueProposition =
    `Für ${lead.company_name} bietet "${targetProfile.name}" konkret: schnellere Lead-Qualifizierung und weniger ` +
    `manuelle Recherche für das Vertriebsteam. (Mock-Mehrwert-Pitch, da MOCK_MODE=true.)`;
  return { reasoning, valueProposition, score };
}

function mockScrapeCompany(domain) {
  return {
    domain,
    companyName: null, // the scraper only ever fills gaps, never overwrites Apollo's company name
    industry: 'Software',
    companySize: '11-50',
    genericEmail: `info@${domain}`,
    sourceUrls: [`https://${domain}/impressum`, `https://${domain}/ueber-uns`],
    robotsTxtChecked: true,
  };
}

function mockDeepResearch(lead, targetProfile) {
  return {
    newsSummary: `${lead.company_name} wurde in den letzten Monaten mehrfach in Branchen-News erwähnt (Mock-Daten, da MOCK_MODE=true).`,
    companyKpis: { employees: '51-200', revenueRange: 'unbekannt (öffentlich nicht einsehbar)', foundedYear: null },
    companyStage: 'Wachstumsphase',
    fitCategory: lead.score || 'medium',
    fitReasoning:
      `${lead.company_name} passt gut zum Zielprofil "${targetProfile.name}", da Größe und Branche der ` +
      `gesuchten Zielgruppe entsprechen. (Mock-Begründung.)`,
    valueProposition:
      lead.value_proposition ||
      `Für ${lead.company_name} bietet "${targetProfile.name}" konkret: schnellere Lead-Qualifizierung und weniger ` +
        `manuelle Recherche für das Vertriebsteam. (Mock-Mehrwert-Pitch, vertieft.)`,
    salesTalkingPoints: [
      'Frage nach aktuellen Wachstumsplänen für das nächste Quartal.',
      'Beziehe dich auf die zuletzt veröffentlichten Stellenanzeigen als Gesprächseinstieg.',
    ],
    sources: [`https://${lead.company_domain || 'example.com'}/news`],
  };
}

function mockPlanResearchSignals(targetProfile) {
  return {
    signals: [
      {
        category: 'hiring_activity',
        rationale:
          `Aktuelle Stellenanzeigen können zeigen, ob "${targetProfile.name}" gerade wächst und Bedarf ` +
          `für unser Produkt hat (Mock-Begründung, da MOCK_MODE=true).`,
      },
      {
        category: 'recent_news_pr',
        rationale: 'Aktuelle Presse-/News-Erwähnungen geben Hinweise auf den richtigen Zeitpunkt für eine Ansprache (Mock-Begründung).',
      },
      {
        category: 'funding_investment',
        rationale: 'Finanzierungsrunden deuten auf verfügbares Budget für neue Tools/Anbieter hin (Mock-Begründung).',
      },
    ],
  };
}

module.exports = {
  mockExtractCriteria,
  mockSearchPeople,
  mockEnrichLead,
  mockScrapeCompany,
  mockDeepResearch,
  mockPlanResearchSignals,
};
