-- MyLeads database schema.
-- Written in plain, portable SQL (TEXT ids/dates, INTEGER 0/1 booleans) so a later
-- move to PostgreSQL/Supabase is a driver swap, not a rewrite.
-- Tables for Phase 2-5 features (groups, permissions, notes, tasks) are created now
-- so the schema never needs a disruptive migration later, even though their UI
-- doesn't exist yet.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'active',
  license_count INTEGER NOT NULL DEFAULT 3,
  search_quota_monthly INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- organization_id is nullable: platform_admin users are not tied to a customer org.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'manager', 'member')),
  full_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS target_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  product_description TEXT NOT NULL,
  target_audience TEXT,
  region TEXT,
  industry TEXT,
  contact_role TEXT,
  goals TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurring_frequency TEXT,
  -- Cached output of claudeClient.planResearchSignals(): which public signal categories
  -- (hiring activity, funding, tech stack, ...) are worth checking for leads matching THIS
  -- product/target audience. Computed once on first search, reused after (see leadFinder.js).
  signal_plan_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY,
  target_profile_id TEXT NOT NULL REFERENCES target_profiles(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  criteria_json TEXT,
  leads_found_count INTEGER NOT NULL DEFAULT 0,
  companies_found_count INTEGER NOT NULL DEFAULT 0,
  contacts_found_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  search_run_id TEXT NOT NULL REFERENCES search_runs(id),
  target_profile_id TEXT NOT NULL REFERENCES target_profiles(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  company_name TEXT NOT NULL,
  company_domain TEXT,
  company_industry TEXT,
  company_size TEXT,
  -- Which system filled company_industry/company_size: 'apollo' or 'scraper' (NULL = not set yet).
  -- Lets the suppression/delete endpoint know which leads to clear when a scraped domain is deleted.
  industry_size_source TEXT,
  source TEXT NOT NULL DEFAULT 'apollo', -- which provider found this lead
  status TEXT NOT NULL DEFAULT 'new', -- new | contacted | qualified | proposal | won | lost
  score TEXT, -- low | medium | high
  ai_reasoning TEXT, -- fit reasoning: why this lead matches the target profile
  value_proposition TEXT, -- individual pitch: what our product offers THIS lead specifically
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  first_name TEXT,
  last_name TEXT,
  job_title TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  source_person_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per status change (not just the latest) — so "who changed what, when" stays
-- visible for every lead, the same way notes keep every entry's author, not just the last.
CREATE TABLE IF NOT EXISTS lead_status_history (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  assigned_user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (group_id, user_id)
);

-- One row grants one target_profile ("list/board") to either a user or a group.
-- is_default_for_group: new members of that group are auto-granted this list.
CREATE TABLE IF NOT EXISTS list_permissions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  target_profile_id TEXT NOT NULL REFERENCES target_profiles(id),
  user_id TEXT REFERENCES users(id),
  group_id TEXT REFERENCES groups(id),
  is_default_for_group INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 2: compliance-scraping cache, opt-out list, and deep-research reports.

-- One cached row per domain (public firmographic info only, never personal data).
CREATE TABLE IF NOT EXISTS scraped_company_data (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  company_name TEXT,
  industry TEXT,
  company_size TEXT,
  generic_email TEXT, -- e.g. info@domain — never a named individual's address
  source_urls TEXT NOT NULL, -- JSON array of the specific pages fetched
  robots_txt_checked INTEGER NOT NULL DEFAULT 1,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Domains that objected to being scraped/included. Checked before every scrape run.
CREATE TABLE IF NOT EXISTS suppression_list (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deep-research mini-report for one lead (Team/Enterprise plans — see plans.js deepResearchLeadLimit).
CREATE TABLE IF NOT EXISTS lead_reports (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  news_summary TEXT,
  company_kpis TEXT, -- JSON object
  company_stage TEXT,
  fit_category TEXT, -- low | medium | high
  fit_reasoning TEXT,
  value_proposition TEXT, -- deeper/refined pitch for this lead, informed by the research
  sales_talking_points TEXT, -- JSON array
  sources TEXT, -- JSON array of URLs actually used
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_target_profiles_org ON target_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_search_runs_profile ON search_runs(target_profile_id);
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_profile ON leads(target_profile_id);
CREATE INDEX IF NOT EXISTS idx_leads_search_run ON leads(search_run_id);
CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_status_history_lead ON lead_status_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_list_permissions_profile ON list_permissions(target_profile_id);
CREATE INDEX IF NOT EXISTS idx_scraped_company_domain ON scraped_company_data(domain);
CREATE INDEX IF NOT EXISTS idx_suppression_domain ON suppression_list(domain);
CREATE INDEX IF NOT EXISTS idx_lead_reports_lead ON lead_reports(lead_id);
