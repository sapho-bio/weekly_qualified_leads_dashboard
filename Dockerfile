# Image for dashboards.saphobio.com/weekly-qualified-leads (built by cloudbuild.yaml).
# No npm dependencies: plain Node serving index.html and the HubSpot snapshot it syncs.
FROM node:20-alpine
WORKDIR /app
COPY package.json config.json index.html server.mjs ./
COPY scripts ./scripts
# The sync writes data/hubspot_leads.json at runtime, so the app user owns data/.
RUN mkdir data && chown node:node data
USER node
ENV HOST=0.0.0.0 \
    PORT=8080 \
    URL_PREFIX=/weekly-qualified-leads
EXPOSE 8080
CMD ["node", "server.mjs"]
