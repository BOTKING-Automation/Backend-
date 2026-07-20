# Pushing to GitHub

```bash
cd kingbot-backend
git init
git add .
git commit -m "Initial commit - KingBot backend"
git branch -M main
git remote add origin https://github.com/<your-username>/kingbot-backend.git
git push -u origin main
```

**Before you push:** `.env` is already in `.gitignore` — never commit real credentials.
Only `.env.example` (with placeholder values) should go up.

## Hosting - deploys automatically from this repo

### Option A: Render (recommended - one file does it all)
This repo includes `render.yaml`, a Render **Blueprint** that deploys the API,
the strategy engine worker, and a managed PostgreSQL database together:

1. Push this repo to GitHub (steps above).
2. In Render: **New > Blueprint**, connect the repo. Render reads `render.yaml`
   automatically and provisions all three services.
3. After the first deploy, open the `kingbot-api` service and fill in the
   env vars marked "sync: false" in the dashboard (SMTP, Africa's Talking,
   MetaApi token, Anthropic key, M-Pesa number, `CLIENT_URL`). `JWT_SECRET`
   and `ENCRYPTION_KEY` are auto-generated for you; the worker automatically
   inherits the same `ENCRYPTION_KEY`.
4. Run the schema once via Render's shell for `kingbot-api`:
   `psql $DATABASE_URL -f src/db/schema.sql && node src/db/seed.js`

### Option B: Railway
`railway.json` configures the API service. Railway doesn't auto-read Procfiles,
so for the worker: create a **second service** from the same repo, and in its
settings set the start command to `npm run engine` (see `Procfile` for
reference). Give both services the same `DATABASE_URL` and `ENCRYPTION_KEY`.

### Option C: Fly.io
Works too, just needs two `fly.toml` app definitions (one per process) - ask
and I'll generate those if you go this route.
