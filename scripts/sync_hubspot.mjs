// Pulls qualified and inbound leads from HubSpot and writes data/hubspot_leads.json.
// Usage: HUBSPOT_TOKEN=... node scripts/sync_hubspot.mjs
//        node scripts/sync_hubspot.mjs --fixture path/to/search_results.json   (offline test, no token)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8'));
const OUT = resolve(root, 'data', 'hubspot_leads.json');
const API = 'https://api.hubapi.com';

const PROPS = [
  'firstname', 'lastname', 'company', 'jobtitle', 'email', 'lifecyclestage', 'createdate', 'lastmodifieddate',
  'hs_v2_date_entered_current_stage', 'qualified_lead_since', 'hs_analytics_source', 'inbound_source_detail',
  'hs_object_source_label', 'what_testing_are_you_interested_in', 'recent_conversion_event_name',
  'hs_lead_status', 'contact_type', 'hubspot_owner_id', 'message'
];
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);
const COLD_SOURCES = new Set(['IMPORT', 'INTEGRATION', 'CRM_UI', 'CRM_UI_BULK_ACTION', 'EXTENSION', 'BATCH_UPDATE', 'DATA_ENRICHMENT', 'EMAIL_INTEGRATION']);

function sourceKey(p) {
  const detail = p.inbound_source_detail;
  const a = p.hs_analytics_source;
  if (detail === 'Conference') return 'event';
  if (detail === 'Referral') return 'referral';
  if (detail === 'LinkedIn Ad' || detail === 'LinkedIn Organic' || detail === 'Other') return 'other';
  if (detail === 'Website - Contact Form' || detail === 'Website - Service Inquiry') return a === 'PAID_SEARCH' ? 'ad' : 'organic';
  switch (a) {
    case 'PAID_SEARCH': return 'ad';
    case 'ORGANIC_SEARCH': case 'DIRECT_TRAFFIC': case 'AI_REFERRALS': return 'organic';
    case 'REFERRALS': return 'referral';
    case 'PAID_SOCIAL': case 'SOCIAL_MEDIA': case 'EMAIL_MARKETING': case 'OTHER_CAMPAIGNS': return 'other';
    case 'OFFLINE': return COLD_SOURCES.has(p.hs_object_source_label) ? 'outreach' : 'other';
    default: return 'other';
  }
}

function dateOf(v) { return v ? new Date(isNaN(v) ? v : Number(v)).toISOString().slice(0, 10) : null; }

function toLead(rec, owners = {}) {
  const p = rec.properties || {};
  const email = (p.email || '').toLowerCase();
  const domain = email.split('@')[1] || '';
  if (domain && config.ignoreEmailDomains.includes(domain)) return null;
  if (config.ignoreLifecycleStages.includes(p.lifecyclestage)) return null;
  if (p.contact_type === 'Do Not Contact' || p.hs_lead_status === 'UNQUALIFIED') return null;

  const hs = config.qualifiedStages[p.lifecyclestage]; // qual | quote | client | undefined
  const fromForm = p.hs_object_source_label === 'FORM' || !!p.inbound_source_detail;
  const flagged = config.useQualifiedLeadSinceProperty && p.qualified_lead_since;
  let tier = null, date = null;
  if (hs || flagged) { tier = 'q'; date = dateOf(p.qualified_lead_since) && flagged ? dateOf(p.qualified_lead_since) : dateOf(p.hs_v2_date_entered_current_stage) || dateOf(p.lastmodifieddate); }
  else if (config.includeInboundLeadStage && fromForm && p.lifecyclestage === 'discovery') { tier = 'i'; date = dateOf(p.createdate); }
  if (!tier || !date || date < config.since) return null;

  const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim() || 'Name not recorded';
  const company = p.company || (domain && !FREE_MAIL.has(domain) ? domain : 'Not recorded');
  const need = p.what_testing_are_you_interested_in || (p.message ? String(p.message).slice(0, 140) : 'Not stated in HubSpot');
  const stageKey = hs || 'lead';
  return {
    id: String(rec.id || p.hs_object_id),
    n: name, na: name === 'Name not recorded', r: p.jobtitle || '', c: company, need, d: date,
    s: sourceKey(p), t: tier, hs: stageKey,
    hso: owners[p.hubspot_owner_id] || '',
    hsu: `https://app.hubspot.com/contacts/${config.hubspotPortalId}/record/0-1/${rec.id || p.hs_object_id}`,
    ev: 'HubSpot' + (p.recent_conversion_event_name ? ', form: ' + p.recent_conversion_event_name : '') + (p.hs_analytics_source ? ', original source: ' + p.hs_analytics_source : '')
  };
}

async function hs(path, body, token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`HubSpot ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error('HubSpot kept failing on ' + path);
}

async function fetchAll(token) {
  const sinceMs = String(Date.parse(config.since + 'T00:00:00Z'));
  const stageIds = Object.keys(config.qualifiedStages);
  const groups = [
    { filters: [{ propertyName: 'lifecyclestage', operator: 'IN', values: stageIds }, { propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceMs }] },
    { filters: [{ propertyName: 'hs_object_source_label', operator: 'EQ', value: 'FORM' }, { propertyName: 'createdate', operator: 'GTE', value: sinceMs }] },
    { filters: [{ propertyName: 'inbound_source_detail', operator: 'HAS_PROPERTY' }, { propertyName: 'createdate', operator: 'GTE', value: sinceMs }] }
  ];
  if (config.useQualifiedLeadSinceProperty) groups.push({ filters: [{ propertyName: 'qualified_lead_since', operator: 'GTE', value: sinceMs }] });
  const out = new Map();
  let after;
  do {
    const page = await hs('/crm/v3/objects/contacts/search', { filterGroups: groups, properties: PROPS, limit: 100, after, sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }] }, token);
    for (const r of page.results || []) out.set(r.id, r);
    after = page.paging?.next?.after;
    await new Promise(r => setTimeout(r, 300));
  } while (after);
  return [...out.values()];
}

async function fetchOwners(token) {
  try {
    const res = await hs('/crm/v3/owners?limit=500', null, token);
    return Object.fromEntries((res.results || []).map(o => [String(o.id), [o.firstName, o.lastName].filter(Boolean).join(' ')]));
  } catch (e) { console.warn('Owner names skipped:', e.message.slice(0, 120)); return {}; }
}

const fixtureAt = process.argv.indexOf('--fixture');
let records, owners = {};
if (fixtureAt > 0) {
  records = JSON.parse(await readFile(process.argv[fixtureAt + 1], 'utf8')).results;
} else {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) { console.error('HUBSPOT_TOKEN is not set. Add it as a repository secret named HUBSPOT_TOKEN.'); process.exit(2); }
  records = await fetchAll(token);
  owners = await fetchOwners(token);
}
const leads = records.map(r => toLead(r, owners)).filter(Boolean).sort((a, b) => b.d.localeCompare(a.d));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), since: config.since, scanned: records.length, count: leads.length, leads }, null, 1));
console.log(`Scanned ${records.length} contacts, kept ${leads.length}. Wrote ${OUT}`);
