# weekly_qualified_leads_dashboard

SaphoBio Weekly Qualified Leads dashboard, served at https://dashboards.saphobio.com/weekly-qualified-leads/ (behind IAP, like every Sapho dashboard).

## How it works

- `server.mjs` serves the page and runs `scripts/sync_hubspot.mjs` on start and every `REFRESH_HOURS` (6 in production). Open `/weekly-qualified-leads/refresh` to sync now.
- `scripts/sync_hubspot.mjs` reads contacts from the HubSpot API and writes `data/hubspot_leads.json`.
- `index.html` shows three-month reporting periods starting Aug 1, 2026. The newest period opens automatically.
- `config.json` holds the rules: which lifecycle stages count as qualified, the earliest date, and email domains to ignore.

## Deployment

Pushing to `main` runs `cloudbuild.yaml`: it builds `gcr.io/aequita/weekly-qualified-leads-dashboard` and restarts the Deployment on the `aequita-gke` cluster.

The rest lives in [sapho-infra](https://github.com/sapho-bio/sapho-infra):

- `kubernetes/weekly-qualified-leads-dashboard.yaml`: Deployment, Service and Kubernetes service account.
- `kubernetes/dashboards.yaml`: the `/weekly-qualified-leads` Ingress path.
- `terraform/aequita/weekly_qualified_leads_dashboard.tf`: runtime service account, Secret Manager secret and Cloud Build trigger.

In production the HubSpot token comes from the Secret Manager secret `weekly-qualified-leads-hubspot-token`. To rotate it:

```
echo -n "<TOKEN>" | gcloud secrets versions add weekly-qualified-leads-hubspot-token --project=aequita --data-file=-
kubectl -n dashboards rollout restart deployment/weekly-qualified-leads-dashboard
```

The token belongs to a HubSpot Private App with the scopes `crm.objects.contacts.read` and `crm.objects.owners.read`.

## Running locally

Copy `.env.example` to `.env`, paste the token, then `npm start` and open http://localhost:8080. Without the token the page still loads, showing only the hand-logged leads.
