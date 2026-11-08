# YAKAP 2.0 Web App: Development Plan

This is the living plan for the project. Update it whenever work is finished or a decision is made (see `CLAUDE.md`).

**Last updated:** 2026-11-08
**Current phase:** Phase 2 (PCAPI core), not started
**Next action:** Build the Annex C encryption layer and verify it against the guide's test vector

## 1. What we are building

A web app for clinic staff that runs the YAKAP 2.0 beneficiary journey through the Primary Care API (PCAPI):
verify the patient, select the clinic, submit the FPE, record the empanelment, upload clinical records, and download clinic records.

The Figma file is a prototype only. The UI is built from the Implementation Guide and its references.

### Source priority

When sources disagree, the higher one wins:

1. **Data Dictionary** rev20261026: fields, types, sizes, required status, validation rules
2. **Library Reference** rev20261026: coded values (send only codes with LIBRARY STATUS 1)
3. **Implementation Guide** rev20261026: endpoints, flows, business rules
4. **Figma prototype**: layout and visual style only

Spec files are in `docs/spec/`. Figma: https://www.figma.com/design/JKxp7GHI8EjRFyWQJhdaht/ui-ux-yakap

## 2. Tech stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router) with TypeScript, self-hosted on Node, not serverless |
| Forms and validation | React Hook Form and Zod, generated from the Data Dictionary where possible |
| UI | Tailwind CSS, components built from the Figma component list |
| Database | PostgreSQL (Docker for development) |
| Background worker | Separate Node process that polls Upload Status |
| Testing | Vitest, Playwright, and a mock PCAPI server built from the guide |

Why Next.js and not React alone: the guide forbids exposing certificates, cipher keys or tokens to the browser (Sections 3.2, 3.6), so a backend is required. Next.js keeps the UI and that backend in one project.

## 3. Progress

| Phase | Name | Status |
|---|---|---|
| 0 | Alignment | Done |
| 1 | Foundation | Done (CI has not run yet; no Git remote) |
| 2 | PCAPI core | Up next |
| 3 | Verification | Not started |
| 4 | Selection and FPE | Not started |
| 5 | Empanelment | Not started |
| 6 | Clinical uploads | Not started |
| 7 | Clinic records | Not started |
| 8 | Certification and go-live | Not started |

## 4. Phases

### Phase 0: Alignment (done)

- [x] Review the guide, Data Dictionary, Library Reference and Figma
- [x] Choose the tech stack
- [x] Agree scope and source priority
- [x] Create the project folder and Git repository
- [x] Save this plan and the spec files in the repository

### Phase 1: Foundation (done)

**Done when:** the app runs locally, a user can log in, and Home shows the patient search layout.

- [x] Next.js app with TypeScript, Tailwind, linting and tests
- [x] CI workflow (written; runs once the repository has a GitHub remote)
- [x] PostgreSQL in Docker
- [x] Tables: facilities, users, consent records, drafts, submissions, daily record-number counters, audit log
- [x] Shared components: app header, side nav, button, status chip, form fields, Yes/No, auto field, error summary, wizard stepper, status row and action box, modal
- [x] Staff login: accounts tied to one facility, admin role
- [x] Audit logging that masks PINs, birth dates and secrets (guide 3.5)
- [x] Home screen layout

### Phase 2: PCAPI core

**Done when:** the Annex C test vector and mock server tests pass.

- [ ] Server-only PCAPI client
- [ ] Token handling per facility, renewed before the one-hour expiry, re-authenticated on 401
- [ ] AES-256-CBC envelope with null-byte padding and hash check (Annex C), for JSON and PDF
- [ ] Response envelope parsing, error mapping by `code` and `errors[].issue`, never by `message`
- [ ] Retry only on 5xx and network failures, except PCU verification and `internal_error` (never retried automatically)
- [ ] Request serializer: optional strings as `""`, empty numbers and booleans left out, never `null`, non-applicable groups left out
- [ ] Atomic 23-character record numbers per facility, prefix and day (T, E, P, S, D, L, M, R)
- [ ] Code generation: Zod schemas from the 673 validation rules, library tables from the 72 library worksheets
- [ ] Byte-length size checks (UTF-8, so "ñ" counts as two)
- [ ] Import step for PSGC, ICD-10 and Konsulta Drug codes, with a placeholder set
- [ ] Mock PCAPI built from the guide, using real encryption and every documented error

### Phase 3: Verification

**Done when:** all three verification modes work against the mock, then staging.

- [ ] Consent capture and record, before any patient-data call
- [ ] Primary Care Validator: lookup by PIN or name and birth date, both assigned and not-assigned results, optional fields treated as omitted
- [ ] PhilHealth Check: start, same-tab LIVENESS redirect, return check (status, authorization ID, state, path, expiry), verify
- [ ] Result handling by `data.status` and `result_code`; store `trans_no`
- [ ] OTP validation (Service 07)
- [ ] Valid ID: type selection and JPEG upload, at most 2 MB before encoding

### Phase 4: Selection and FPE

**Done when:** an FPE reaches `accepted`.

- [ ] Selection with all outcomes from guide 4.4
- [ ] FPE wizard across 143 fields, with show/hide rules from the Dictionary
- [ ] Server-side drafts
- [ ] Upload queue and worker polling at 2, 4, 8 seconds, capped at 60
- [ ] Field errors mapped back to the right wizard step, for both 400 responses and rejected uploads
- [ ] Correct and resubmit a rejected record with the same number

### Phase 5: Empanelment

**Done when:** an MCA is recorded and the duplicate and missing-FPE cases are handled.

- [ ] Status tracker per beneficiary (Figma Iteration 3 layout)
- [ ] Empanelment enabled only with an active Selection and an `accepted` FPE
- [ ] Same-day verification checks
- [ ] Result screen showing `yes_reference_no` and Validator status

### Phase 6: Clinical uploads

**Done when:** all five forms are accepted, with parent and child ordering handled.

Figma has no screens for these; they extend the Figma style.

- [ ] Consultation (272 fields), including OB-Gyn, Pediatric, Adolescent, Full HEADSSS and BP Monitoring forms
- [ ] Diagnostic Request
- [ ] Diagnostic Results (137 fields), using the Diagnostic Result Applicability sheet
- [ ] Drugs and Medicines
- [ ] Referral Request

### Phase 7: Clinic records

**Done when:** staff can download, print, and fix rejected uploads.

- [ ] Masterlist individual lookup
- [ ] Masterlist batch download, range of at most 7 days
- [ ] Availment Slip PDF: decrypt as bytes, check hash, view and print
- [ ] Upload monitoring screen with rejected records

### Phase 8: Certification and go-live

**Done when:** PhilHealth certifies the software and production is live.

- [ ] Switch from the mock to the real PCAPI
- [ ] Guide 3.6 security and production readiness checklist
- [ ] Failure paths: expired token, missing consent, validation errors, duplicates, rejected uploads, decryption errors
- [ ] Accessibility review
- [ ] Rotate test credentials
- [ ] Choose hosting and deploy
- [ ] PhilHealth certification

## 5. Decision log

Newest first. Add a row for every decision.

| Date | Decision | Reason |
|---|---|---|
| 2026-11-08 | Use npm 11 for fresh installs (`npx npm@11 install`); `npm ci` works on npm 10 | npm 10.9.2 crashes when resolving the patched Vitest version |
| 2026-11-08 | Vitest 4.1.12 instead of 5.x | Vitest 5 does not support Node 23, the development machine's version; 4.1.12 has the security fix |
| 2026-11-08 | Accept the remaining moderate `npm audit` findings for now | They are in development-only tools (drizzle-kit, ESLint config) and have no non-breaking fix; production dependencies report 0 |
| 2026-11-08 | Login uses accreditation number, user name and password; five failures lock the account for 15 minutes | Accounts are per facility, and user names are unique only within a facility |
| 2026-11-08 | Sessions are random tokens stored hashed in the database, in an httpOnly cookie, for 8 hours; passwords use scrypt | Allows server-side logout and needs no extra native dependency |
| 2026-11-08 | Drizzle ORM with postgres.js | Plain SQL-like schema and migrations, works in the app and the worker |
| 2026-11-08 | Next.js Cache Components are off | Every screen is per-user patient data, so nothing should be cached |
| 2026-11-08 | Docker PostgreSQL is published on host port 5433 | A local PostgreSQL already uses 5432 on the development machine |
| 2026-11-08 | Keep this plan updated after every accomplishment and decision | Work can resume at any time from the repository |
| 2026-11-08 | The outdated local `primary-care-api` copy is not used as a reference | It no longer matches the guide |
| 2026-11-08 | Mock PCAPI built from the guide until the real API is reachable | The API is not available on the development machine; the guide is also the basis of the API |
| 2026-11-08 | No deadline, so the plan has no durations | Confirmed by the project owner |
| 2026-11-08 | PSGC, ICD-10 and Konsulta Drug codes come in through an import step, with placeholders until then | A source exists but is not on the development machine; the guide has no endpoint for them |
| 2026-11-08 | PostgreSQL in Docker for development; hosting decided in Phase 8 | Hosting must run Node as a long-running server for the worker |
| 2026-11-08 | Keep submitted forms encrypted, and save drafts on the server. No patient chart or history features | The guide has no read-back endpoint, and rejected records must be corrected and resent |
| 2026-11-08 | App-managed staff accounts, each tied to one facility, with an admin role; multi-facility from the start | The guide has no staff login, and Empanelment needs `created_by` |
| 2026-11-08 | Screens missing from Figma extend the Figma style | Avoids blocking Phases 6 and 7 |
| 2026-11-08 | Empanelment uses the Figma Iteration 3 layout | Confirmed by the project owner |
| 2026-11-08 | Build only what the guide defines. View YES, Print YES and Decline are not built | They belong to the legacy API |
| 2026-11-08 | "HCI Portal" branding is ignored | Prototype only |
| 2026-11-08 | Next.js with TypeScript | The guide requires a protected backend |

## 6. Where the Figma prototype differs from the guide

The guide wins in every case.

| Figma | Guide | What we build |
|---|---|---|
| PhilHealth Check opens a new tab with a "Liveness in progress" screen | Same-tab redirect and return (4.1) | Same-tab flow, no waiting screen |
| Notes say the API accepts a YES before the FPE | Needs an accepted FPE: 422 `no_accepted_fpe` (4.3) | Empanelment waits for `accepted` |
| Notes say other services use YYYY-MM-DD | MM/DD/YYYY in every request (3.7) | MM/DD/YYYY |
| FPE has 141 fields | Dictionary has 143 | 143 |
| FPE labeled Service 05 | FPE is Service 06; Service 05 is the Masterlist | Guide numbering |
| View YES, Print YES, Decline | Not in the guide | Not built |

The guide's own Section 4.6 table lists Consultation with 270 fields; the Dictionary and Annex A list 272. The Dictionary prevails.

## 7. Open items

| Item | Needed by | Owner |
|---|---|---|
| Push to a GitHub remote so CI can run | When convenient | Project owner |
| Admin screen to manage staff accounts (only the seed script creates accounts today) | Before Phase 8 | Development |
| Real PSGC, ICD-10 and Konsulta Drug data | Phase 4 (placeholders until then) | Project owner |
| Reachable PCAPI staging host | Phase 8 at the latest | Project owner |
| PhilHealth software certificate and cipher keys for staging | Phase 8 at the latest; stored only in a local environment file | Project owner |
