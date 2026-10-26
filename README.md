# weekly_qualified_leads_dashboard

SaphoBio Weekly Qualified Leads dashboard. Live HubSpot leads are pulled every Monday and the page is republished on GitHub Pages.

## How it works

- `scripts/sync_hubspot.mjs` reads contacts from the HubSpot API and writes `data/hubspot_leads.json`.
- `.github/workflows/refresh-and-publish.yml` runs that script every Monday (and on every push, and on demand), then publishes the site.
- `index.html` shows three-month reporting periods starting Aug 1, 2026. The newest period opens automatically.
- `config.json` holds the rules: which lifecycle stages count as qualified, the earliest date, and email domains to ignore.

## One-time setup

1. In HubSpot, create a Private App with the scopes `crm.objects.contacts.read` and `crm.objects.owners.read`. Copy its access token.
2. In this repo, go to Settings > Secrets and variables > Actions and add a secret named `HUBSPOT_TOKEN` with that token.
3. Go to Settings > Pages and set Source to "GitHub Actions".
4. Open the Actions tab, pick "Refresh HubSpot leads and publish" and press Run workflow.

Without the token the page still publishes, showing only the hand-logged leads.
