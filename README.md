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
   npm run codes:import
   ```

3. Start the mock PCAPI in one terminal and the app, at http://localhost:3000, in another:

   ```bash
   npm run mock
   ```

   ```bash
   npm run dev
   ```

Uploads need the status worker in a third terminal:

   ```bash
   npm run worker
   ```

`mock/pcapi/config.ts` lists the mock's test PINs and scenarios.

## Regenerating from the specification

After a new Data Dictionary or Library Reference, replace the files in `docs/spec/`, update the paths in `scripts/generate-spec.ts`, then run:

```bash
npm run spec:generate
```

## External code lists

PSGC, ICD-10 and Konsulta Drug codes load from a CSV with the columns `library,code,description,parent_code`. With no file, the placeholder set in `data/` is loaded.

```bash
npm run codes:import -- path/to/codes.csv
```

Log in with the seed values from `.env.local`. In development, the shared components are shown at `/dev/components`.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
