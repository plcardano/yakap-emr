# YAKAP 2.0 Web App

Web app for the YAKAP 2.0 Primary Care API. The plan, status and decisions are in [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Run locally

Requires Node 22 or newer and Docker Desktop.

1. Copy `.env.example` to `.env.local` and fill in the empty values.
2. Install and prepare the database:

   ```bash
   npm ci
   npm run db:up
   npm run db:migrate
   npm run db:seed
   ```

3. Start the app at http://localhost:3000:

   ```bash
   npm run dev
   ```

Log in with the seed values from `.env.local`. In development, the shared components are shown at `/dev/components`.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
