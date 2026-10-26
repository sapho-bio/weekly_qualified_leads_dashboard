// Dashboard server: serves the page, refreshes HubSpot data on start and every few hours.
// Locally:  npm start   (then open http://localhost:8080)
// In GKE:   runs behind the shared dashboards Ingress at URL_PREFIX (see Dockerfile and the
//           sapho-infra manifest kubernetes/weekly-qualified-leads-dashboard.yaml).
import './scripts/env.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 6);
// The GKE Ingress does not strip the path prefix, so every route lives under it ('' locally).
const PREFIX = (process.env.URL_PREFIX || '').replace(/\/$/, '');
// Only these files are ever served, so .env and the rest of the folder stay private.
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/data/hubspot_leads.json': 'data/hubspot_leads.json' };
const TYPES = { html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8' };

// In GKE the token comes from Secret Manager (HUBSPOT_TOKEN_SECRET names the secret), read as
// the pod's Workload Identity service account through the metadata server. No SDK needed.
async function tokenFromSecretManager() {
  const secret = process.env.HUBSPOT_TOKEN_SECRET, project = process.env.GCP_PROJECT;
  if (!secret || !project || process.env.HUBSPOT_TOKEN) return;
  const meta = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!meta.ok) throw new Error('metadata token: HTTP ' + meta.status);
  const { access_token } = await meta.json();
  const r = await fetch(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${secret}/versions/latest:access`, { headers: { Authorization: 'Bearer ' + access_token } });
  if (!r.ok) throw new Error('Secret Manager ' + secret + ': HTTP ' + r.status);
  process.env.HUBSPOT_TOKEN = Buffer.from((await r.json()).payload.data, 'base64').toString('utf8').trim();
}

let syncing = false, lastSync = 'not yet run';
function sync() {
  if (syncing) return Promise.resolve();
  syncing = true;
  return new Promise(done => {
    const p = spawn(process.execPath, [resolve(root, 'scripts/sync_hubspot.mjs')], { stdio: 'inherit' });
    p.on('exit', code => { syncing = false; lastSync = (code === 0 ? 'ok ' : 'failed (code ' + code + ') ') + new Date().toLocaleString(); done(); });
  });
}

createServer(async (req, res) => {
  let url = new URL(req.url, 'http://localhost').pathname;
  if (PREFIX) {
    // The page fetches data/hubspot_leads.json relative to itself, so it needs the trailing slash.
    if (url === PREFIX) { res.writeHead(301, { Location: PREFIX + '/' }); return res.end(); }
    if (!url.startsWith(PREFIX + '/')) { res.writeHead(404); return res.end('Not found'); }
    url = url.slice(PREFIX.length);
  }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok\n'); }
  if (url === '/refresh') { await sync(); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('HubSpot sync: ' + lastSync + '\n'); }
  const rel = FILES[url];
  if (!rel) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': TYPES[rel.split('.').pop()], 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found yet. The HubSpot sync has not produced data/hubspot_leads.json.'); }
}).listen(PORT, HOST, async () => {
  console.log('Dashboard: http://localhost:' + PORT + PREFIX + '/');
  try { await tokenFromSecretManager(); } catch (e) { console.error('Could not read the HubSpot token: ' + e.message); }
  console.log(process.env.HUBSPOT_TOKEN ? 'HubSpot token found. Syncing now, then every ' + REFRESH_HOURS + ' hours.' : 'No HUBSPOT_TOKEN, so the HubSpot feed will stay off.');
  if (process.env.HUBSPOT_TOKEN) { sync(); setInterval(sync, REFRESH_HOURS * 3600 * 1000); }
});
