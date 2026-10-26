// Local dashboard server: serves the page, refreshes HubSpot data on start and every few hours.
// Run with: npm start   (then open http://localhost:8080)
import './scripts/env.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 6);
// Only these files are ever served, so .env and the rest of the folder stay private.
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/data/hubspot_leads.json': 'data/hubspot_leads.json' };
const TYPES = { html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8' };

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
  const url = new URL(req.url, 'http://localhost').pathname;
  if (url === '/refresh') { await sync(); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('HubSpot sync: ' + lastSync + '\n'); }
  const rel = FILES[url];
  if (!rel) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': TYPES[rel.split('.').pop()], 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found yet. The HubSpot sync has not produced data/hubspot_leads.json.'); }
}).listen(PORT, '127.0.0.1', () => {
  console.log('Dashboard: http://localhost:' + PORT);
  console.log(process.env.HUBSPOT_TOKEN ? 'HubSpot token found. Syncing now, then every ' + REFRESH_HOURS + ' hours.' : 'No HUBSPOT_TOKEN in .env, so the HubSpot feed will stay off.');
  if (process.env.HUBSPOT_TOKEN) { sync(); setInterval(sync, REFRESH_HOURS * 3600 * 1000); }
});
