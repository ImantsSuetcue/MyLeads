// Wraps every Claude API call the app makes:
//   1. extractCriteria()            — free text -> structured Apollo filters (forced tool-use)
//   2. planResearchSignals()        — which public signal categories are worth checking for
//                                      THIS product/target profile (forced tool-use, cached
//                                      once per target profile — see leadFinder.js)
//   3. enrichLead()                  — web-search-backed "why this lead fits" reasoning,
//                                      guided by the target profile's signal plan
//   4. extractCompanyInfoFromText()  — structures text our own compliance scraper already
//                                      fetched (no web_search tool here — Claude never fetches
//                                      anything itself for this one, see complianceScraper.js)
//   5. researchLeadDeep()            — longer web-search research + structured mini-report
//                                      for top leads (see services/deepResearch.js)
// MOCK_MODE short-circuits all of these to mockProviders so the rest of the app never
// needs to know whether a real ANTHROPIC_API_KEY is configured yet.
const Anthropic = require('@anthropic-ai/sdk');
const env = require('../config/env');
const mockProviders = require('./mockProviders');

const client = !env.MOCK_MODE && env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

const MODEL = 'claude-opus-4-8';

const EMPLOYEE_RANGES = ['1,10', '11,50', '51,200', '201,500', '501,1000', '1001,5000', '5001,10000', '10001+'];
const SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager', 'senior', 'entry', 'intern'];

const CRITERIA_TOOL = {
  name: 'extract_search_criteria',
  description: 'Turn a free-text B2B sales target profile into structured Apollo.io search filters.',
  input_schema: {
    type: 'object',
    properties: {
      industries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Industry/keyword tags describing the target companies, e.g. "saas", "e-commerce"',
      },
      employee_ranges: {
        type: 'array',
        items: { type: 'string', enum: EMPLOYEE_RANGES },
        description: 'Apollo organization employee-count buckets matching the target audience company size',
      },
      locations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Company locations, e.g. "Germany", "Austria", "Switzerland"',
      },
      job_titles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Target contact job titles, e.g. "Head of Sales"',
      },
      seniorities: {
        type: 'array',
        items: { type: 'string', enum: SENIORITIES },
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Extra free-text keywords describing the ideal company',
      },
      summary: {
        type: 'string',
        description: 'One short sentence (in German) summarizing the interpreted search, for display to the user',
      },
    },
    required: ['job_titles', 'summary'],
  },
};

async function extractCriteria(targetProfile) {
  if (env.MOCK_MODE) {
    return mockProviders.mockExtractCriteria(targetProfile);
  }

  const prompt = `Translate this B2B sales target profile into structured search filters.

Name: ${targetProfile.name}
Product: ${targetProfile.product_description}
Target audience: ${targetProfile.target_audience || '(not specified)'}
Region: ${targetProfile.region || '(not specified)'}
Industry: ${targetProfile.industry || '(not specified)'}
Desired contact role: ${targetProfile.contact_role || '(not specified)'}
Sales goals: ${targetProfile.goals || '(not specified)'}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [CRITERIA_TOOL],
    tool_choice: { type: 'tool', name: 'extract_search_criteria' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}

// Fixed, curated vocabulary so the signal plan stays structured/displayable/cost-bounded —
// 'custom' is the deliberate escape hatch for a genuinely lateral-thinking signal that doesn't
// fit any named category (e.g. "job postings that hint at the exact pain point our product solves").
const SIGNAL_CATEGORIES = [
  'hiring_activity',
  'funding_investment',
  'leadership_changes',
  'recent_news_pr',
  'tech_stack',
  'expansion_signals',
  'certifications_compliance',
  'social_proof',
  'competitor_moves',
  'pain_point_signals',
];

const SIGNAL_PLAN_TOOL = {
  name: 'plan_research_signals',
  description:
    'Choose which public signal categories are worth investigating for leads matching this specific ' +
    'product/target profile — not a generic checklist, but the 2-4 signals that actually matter for THIS product.',
  input_schema: {
    type: 'object',
    properties: {
      signals: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: [...SIGNAL_CATEGORIES, 'custom'] },
            custom_label: {
              type: 'string',
              description: 'Only set when category is "custom" — a short German label for this signal type.',
            },
            rationale: {
              type: 'string',
              description: 'German, 1 sentence: why this signal matters for THIS product/target audience specifically.',
            },
          },
          required: ['category', 'rationale'],
        },
      },
    },
    required: ['signals'],
  },
};

// Computed once per target profile and cached (target_profiles.signal_plan_json — see
// leadFinder.js Stage 1.5), not per search/per lead: this is what lets enrichLead/researchLeadDeep
// search for product-specific signals instead of the same hardcoded checklist for every customer.
async function planResearchSignals(targetProfile) {
  if (env.MOCK_MODE) {
    return mockProviders.mockPlanResearchSignals(targetProfile);
  }

  const prompt = `We sell: ${targetProfile.product_description}
To this kind of buyer: ${targetProfile.target_audience || '(see product description)'}
Industry: ${targetProfile.industry || '(not specified)'}
Sales goals: ${targetProfile.goals || '(not specified)'}

Which public signal categories about a potential lead company would actually be meaningful to check for THIS
specific product and target audience — not a generic list, think about what would genuinely indicate fit or
timing for this product. Choose 2-4.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 768,
    tools: [SIGNAL_PLAN_TOOL],
    tool_choice: { type: 'tool', name: 'plan_research_signals' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}

const SIGNAL_CATEGORY_LABELS = {
  hiring_activity: 'Hiring-Aktivität',
  funding_investment: 'Finanzierung/Investment',
  leadership_changes: 'Führungswechsel',
  recent_news_pr: 'Aktuelle News/Presse',
  tech_stack: 'Eingesetzte Technologien',
  expansion_signals: 'Expansion (Standorte/Märkte)',
  certifications_compliance: 'Zertifizierungen/Compliance',
  social_proof: 'Social Proof (Kundenstimmen/Reviews)',
  competitor_moves: 'Wettbewerber-Aktivität',
  pain_point_signals: 'Hinweise auf den gelösten Schmerzpunkt',
};

// Turns a cached signal plan into the prompt section enrichLead/researchLeadDeep splice into
// their web-search prompt, replacing the old one-size-fits-all "recent news, hiring, funding"
// instruction with exactly the signals this target profile's plan called out.
function buildSignalPromptSection(signalPlan) {
  const signals = signalPlan && Array.isArray(signalPlan.signals) ? signalPlan.signals : [];
  if (!signals.length) {
    return 'Search the web for brief, current, concrete context on this company (recent news, growth signals, hiring, funding).';
  }

  const lines = signals.map((s) => {
    const label = s.category === 'custom' ? s.custom_label || 'Individuelles Signal' : SIGNAL_CATEGORY_LABELS[s.category] || s.category;
    return `- ${label}: ${s.rationale}`;
  });

  return `Recherchiere gezielt nach folgenden, für dieses Produkt besonders aussagekräftigen Signalen:\n${lines.join('\n')}`;
}

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };

// Shared by enrichLead() and researchLeadDeep(): sends a prompt with the web_search
// tool (tool_choice auto), resumes through any pause_turn (server-tool loops can pause
// after many search rounds), and returns the final text plus every URL Claude actually
// fetched (walked from web_search_tool_result blocks) — grounded sources, not guesses.
async function runWebSearchToText(prompt, maxTokens) {
  let messages = [{ role: 'user', content: prompt }];
  let response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    tools: [WEB_SEARCH_TOOL],
    messages,
  });

  while (response.stop_reason === 'pause_turn') {
    messages = [...messages, { role: 'assistant', content: response.content }];
    response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      tools: [WEB_SEARCH_TOOL],
      messages,
    });
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const sourceUrls = [];
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item.url) sourceUrls.push(item.url);
      }
    }
  }

  return { text, sourceUrls: [...new Set(sourceUrls)] };
}

const ENRICHMENT_STRUCTURE_TOOL = {
  name: 'structure_lead_enrichment',
  description: 'Turn free-text lead research into two separate, structured texts plus a fit score.',
  input_schema: {
    type: 'object',
    properties: {
      fit_reasoning: {
        type: 'string',
        description: 'German, 2-3 sentences: WHY this lead matches the target profile (match criteria, company signals).',
      },
      value_proposition: {
        type: 'string',
        description:
          'German, 2-3 sentences: the concrete pitch for THIS specific lead — what value/benefit our product offers ' +
          'this particular company, tailored to its situation (not a generic product description).',
      },
      fit_score: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['fit_reasoning', 'value_proposition', 'fit_score'],
  },
};

// Two-call pattern (web-search prose -> forced-tool structuring), same architecture as
// researchLeadDeep(). Produces two SEPARATE texts per lead: fit reasoning (why it matches)
// and a value proposition (what we specifically offer this lead) — not one blended text.
// `signalPlan` is the target profile's cached planResearchSignals() output (or null before
// it's been computed) — it's what makes the web-search prompt product-specific instead of
// the same generic checklist for every customer.
async function enrichLead(lead, targetProfile, signalPlan) {
  if (env.MOCK_MODE) {
    return mockProviders.mockEnrichLead(lead, targetProfile);
  }

  const prompt = `We sell: ${targetProfile.product_description}
To this kind of buyer: ${targetProfile.target_audience || '(see product description)'}

Potential lead:
Company: ${lead.company_name}${lead.company_domain ? ` (${lead.company_domain})` : ''}
Industry: ${lead.company_industry || 'unknown'}

${buildSignalPromptSection(signalPlan)}
Then write two things, in German:
1. Why this lead fits our target profile (match criteria, company signals).
2. What concrete value/benefit our product offers THIS specific company — an individual pitch, not a generic
   description of the product.`;

  const { text } = await runWebSearchToText(prompt, 1536);
  const structured = await structureEnrichmentText(text);

  return {
    reasoning: structured.fit_reasoning || null,
    valueProposition: structured.value_proposition || null,
    score: structured.fit_score || 'medium',
  };
}

async function structureEnrichmentText(text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [ENRICHMENT_STRUCTURE_TOOL],
    tool_choice: { type: 'tool', name: 'structure_lead_enrichment' },
    messages: [{ role: 'user', content: `Structure this lead research into fields:\n\n${text}` }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}

const COMPANY_INFO_TOOL = {
  name: 'extract_company_info',
  description:
    "Extract structured company facts from text taken from a company's own public website pages " +
    '(imprint/about/press/careers). Only use facts actually stated in the text — never guess or infer.',
  input_schema: {
    type: 'object',
    properties: {
      company_name: { type: 'string' },
      industry: { type: 'string', description: 'Short industry/sector label, e.g. "SaaS", "Maschinenbau"' },
      company_size: {
        type: 'string',
        description: 'Employee count or size bracket if explicitly mentioned, e.g. "50-100 Mitarbeitende"',
      },
      generic_email: {
        type: 'string',
        description:
          "A general company mailbox mentioned in the text, e.g. info@company.com — never a named individual's address",
      },
    },
    required: [],
  },
};

// Structures text OUR OWN complianceScraper.js already fetched (respecting robots.txt,
// rate limits, and the source allowlist) into fields. No web_search tool is used here —
// this function never fetches anything itself, keeping the compliance boundary in our code.
async function extractCompanyInfoFromText(text, domain) {
  if (env.MOCK_MODE) {
    return mockProviders.mockScrapeCompany(domain);
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [COMPANY_INFO_TOOL],
    tool_choice: { type: 'tool', name: 'extract_company_info' },
    messages: [
      { role: 'user', content: `Text taken from ${domain}'s own website (imprint/about/press/careers pages):\n\n${text}` },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}

const RESEARCH_STRUCTURE_TOOL = {
  name: 'structure_research_report',
  description: 'Turn a free-text company research report into structured fields for a CRM.',
  input_schema: {
    type: 'object',
    properties: {
      news_summary: { type: 'string', description: 'Short summary (German) of recent news/press mentions' },
      company_kpis: {
        type: 'object',
        description: 'Rough public KPIs mentioned in the text',
        properties: {
          employees: { type: 'string' },
          revenueRange: { type: 'string' },
          growthSignals: { type: 'string' },
        },
      },
      company_stage: { type: 'string', description: 'e.g. "Startup", "Wachstumsphase", "Etabliertes Unternehmen"' },
      fit_category: { type: 'string', enum: ['low', 'medium', 'high'] },
      fit_reasoning: { type: 'string', description: 'German, 1-2 sentences: why this company fits (or not) right now' },
      value_proposition: {
        type: 'string',
        description:
          'German, 2-3 sentences: a deeper, research-informed pitch for this specific lead — refine/expand the base ' +
          'value proposition using the news/KPIs/stage found here, don’t just repeat generic product copy.',
      },
      sales_talking_points: {
        type: 'array',
        items: { type: 'string' },
        description: '2-3 concrete, specific conversation starters for a sales call, in German',
      },
    },
    required: ['fit_category', 'fit_reasoning'],
  },
};

async function structureResearchText(text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [RESEARCH_STRUCTURE_TOOL],
    tool_choice: { type: 'tool', name: 'structure_research_report' },
    messages: [{ role: 'user', content: `Structure this company research report into fields:\n\n${text}` }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  return toolUse.input;
}

// Two-call pattern (same architecture as extractCriteria + enrichLead, composed):
// 1) web-search research in prose, 2) structure that prose into report fields.
// Sources are the URLs Claude actually fetched during step 1, not asked-for in step 2.
// `signalPlan` — see enrichLead() above; the same cached per-target-profile plan feeds the
// "Unternehmensphase"/signal point below instead of a fixed hiring/funding checklist.
async function researchLeadDeep(lead, targetProfile, signalPlan) {
  if (env.MOCK_MODE) {
    return mockProviders.mockDeepResearch(lead, targetProfile);
  }

  const prompt = `We sell: ${targetProfile.product_description}
To this kind of buyer: ${targetProfile.target_audience || '(see product description)'}

Research this company in depth, for a sales team preparing an outreach call:
Company: ${lead.company_name}${lead.company_domain ? ` (${lead.company_domain})` : ''}
Industry: ${lead.company_industry || 'unknown'}
${lead.value_proposition ? `\nExisting base-level value proposition for this lead (from an earlier, lighter enrichment step): "${lead.value_proposition}"\n` : ''}
Search the web and write a thorough report, in German, covering:
1. Aktuelle Nachrichten/Pressemeldungen der letzten Monate.
2. Öffentlich verfügbare Kennzahlen (grobe Mitarbeiterzahl, Umsatzgrößenordnung falls öffentlich, Wachstumssignale).
3. Unternehmensphase (z.B. Startup, Wachstumsphase, etabliertes Unternehmen). ${buildSignalPromptSection(signalPlan)}
4. Eine klare Fit-Einschätzung (hohe/mittlere/geringe Passung) mit Begründung, warum das Unternehmen gerade jetzt in Frage kommt oder nicht.
5. ${lead.value_proposition ? 'Eine vertiefte/verfeinerte Version des Mehrwert-Pitches oben, angereichert mit den hier gefundenen Signalen.' : 'Einen individuellen Mehrwert-Pitch: welchen konkreten Nutzen unser Produkt genau diesem Unternehmen bietet.'}
6. 2-3 konkrete Gesprächsaufhänger für einen Sales-Call.

Write flowing prose with a clear paragraph per topic, not a form.`;

  const { text, sourceUrls } = await runWebSearchToText(prompt, 2048);
  const structured = await structureResearchText(text);

  return {
    newsSummary: structured.news_summary || null,
    companyKpis: structured.company_kpis || {},
    companyStage: structured.company_stage || null,
    fitCategory: structured.fit_category || null,
    fitReasoning: structured.fit_reasoning || null,
    valueProposition: structured.value_proposition || lead.value_proposition || null,
    salesTalkingPoints: structured.sales_talking_points || [],
    sources: sourceUrls.length ? sourceUrls : [],
  };
}

module.exports = { extractCriteria, planResearchSignals, enrichLead, extractCompanyInfoFromText, researchLeadDeep };
