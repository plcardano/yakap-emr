# YAKAP 2.0 Web App: Development Plan

This is the living plan for the project. Update it whenever work is finished or a decision is made (see `CLAUDE.md`).

**Last updated:** 2026-11-08
**Current phase:** Phase 7 (Clinic records), not started
**Next action:** Build the Masterlist lookup and batch download

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
| Forms and validation | A data-driven form and rule engine generated from the Data Dictionary; Zod for login |
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
| 2 | PCAPI core | Done (tested against the mock only) |
| 3 | Verification | Done (tested against the mock only) |
| 4 | Selection and FPE | Done (tested against the mock only) |
| 5 | Empanelment | Done (tested against the mock only) |
| 6 | Clinical uploads | Done (tested against the mock only) |
| 7 | Clinic records | Up next |
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

### Phase 2: PCAPI core (done)

**Done when:** the Annex C test vector and mock server tests pass.

- [x] Server-only PCAPI client
- [x] Token handling per facility, renewed before the one-hour expiry, re-authenticated on 401
- [x] AES-256-CBC envelope with null-byte padding and hash check (Annex C), for JSON and PDF
- [x] Response envelope parsing, error mapping by `code` and `errors[].issue`, never by `message`
- [x] Retry only on network failures and 502, 503, 504. Never for `internal_error`, PCU, Selection or Empanelment
- [x] Request serializer: optional strings as `""`, empty numbers and booleans left out, never `null`, non-applicable groups left out
- [x] Atomic 23-character record numbers per facility, prefix and day (T, E, P, S, D, L, M, R)
- [x] Code generation: a rule engine driven by the 673 validation rules, and library tables from the 72 library worksheets. 142 of the 171 conditional fields are checked automatically; the other 29 are form-level work in Phases 3 to 6 (see `manual` in `src/generated/pcapi-rules.json`)
- [x] Byte-length size checks (UTF-8, so "ñ" counts as two)
- [x] Import step for PSGC, ICD-10 and Konsulta Drug codes, with a placeholder set
- [x] Mock PCAPI built from the guide, using real encryption and every documented error

### Phase 3: Verification (done)

**Done when:** all three verification modes work against the mock, then staging.

- [x] Consent capture and record, before any patient-data call
- [x] Primary Care Validator: lookup by PIN or name and birth date, both assigned and not-assigned results, optional fields treated as omitted
- [x] PhilHealth Check: start, same-tab LIVENESS redirect, return check (status, authorization ID, state, path, expiry), verify
- [x] Result handling by `data.status` and `result_code`; store `trans_no`
- [x] OTP validation (Service 07)
- [x] Valid ID: type selection and JPEG upload, at most 2 MB before encoding

### Phase 4: Selection and FPE (done)

**Done when:** an FPE reaches `accepted`.

- [x] Selection with all outcomes from guide 4.4
- [x] FPE wizard across 143 fields, with show/hide rules from the Dictionary
- [x] Server-side drafts
- [x] Upload queue and worker polling at 2, 4, 8 seconds, capped at 60
- [x] Field errors mapped back to the right wizard step, for both 400 responses and rejected uploads
- [x] Correct and resubmit a rejected record with the same number

### Phase 5: Empanelment (done)

**Done when:** an MCA is recorded and the duplicate and missing-FPE cases are handled.

- [x] Status tracker per beneficiary (Figma Iteration 3 layout)
- [x] Empanelment enabled only with an active Selection and an `accepted` FPE
- [x] Same-day verification checks
- [x] Result screen showing `yes_reference_no` and Validator status

### Phase 6: Clinical uploads (done)

**Done when:** all five forms are accepted, with parent and child ordering handled.

Figma has no screens for these; they extend the Figma style.

- [x] Consultation (272 fields), including OB-Gyn, Pediatric, Adolescent, Full HEADSSS and BP Monitoring forms
- [x] Diagnostic Request
- [x] Diagnostic Results (137 fields), using the Diagnostic Result Applicability sheet
- [x] Drugs and Medicines
- [x] Referral Request

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
| 2026-11-08 | Medicine `quantity` and `total_amount_price` are computed when the entries can be read (leading number x doses per day x days); PRN and unreadable entries are typed by staff | Guide 4.6.5 says the EMR computes them, but quantity and duration are free text |
| 2026-11-08 | `drug_code`, `generic_code`, `strength_code` and `form_code` are required unless `other_medicine` is filled | The Dictionary marks them Yes, but guide 4.6.5 sends them as "" for a medicine not in the library |
| 2026-11-08 | One shared wizard, draft and submit service serves all six upload forms, each described by a form definition | Keeps the rules for every form in one pattern |
| 2026-11-08 | Child records start from their accepted parent on the Clinical uploads page, and the consultation's plan flags decide which are offered | Guide 4.6.3 to 4.6.6 |
| 2026-11-08 | The Empanelment tracker has four steps, adding Selection to Figma's three, and name search shows one record | The guide requires an active Selection, and returns `multiple_matches` instead of a list |
| 2026-11-08 | Medical, immunization and family history always need an entry; a patient with no history picks "None" (`999` for disease, `01` for immunization) | Guide 4.6.1 Payload structure marks these groups Required, and the Library Reference defines the None codes |
| 2026-11-08 | Keep the current month-end age calculation and adjust later if the API differs | Project owner is not yet sure how the API computes it |
| 2026-11-08 | Patient age counts days from the last whole month, clamped to that month's length (01/31 to 03/01 is 1 month, 1 day) | The guide requires the backend's value but does not define month-end cases. Confirm against the API |
| 2026-11-08 | The FPE and later forms are rendered from the Dictionary rules, labels and libraries, with plain React state instead of React Hook Form | 143 to 272 fields per form, nested repeating groups and cross-field rules are simpler from one data source, and Phase 6 reuses it |
| 2026-11-08 | FPE fields from the Masterlist are read-only; age and BMI are computed | The guide says Masterlist values copy directly, and the backend rejects a wrong age or BMI |
| 2026-11-08 | One `case_no` per patient per facility, stored in `patient_cases`; E and P numbers are saved with the draft before upload | Guide 4.6.1 reuses `case_no`, and a lost response must not create a second number |
| 2026-11-08 | Upload status is polled by a separate worker (`npm run worker`) | Polling must continue with no browser open |
| 2026-11-08 | Valid ID images are saved encrypted at capture and sent later with Selection, FPE or Empanelment | The guide has no endpoint to check a Valid ID on its own |
| 2026-11-08 | One "Patient verification" page holds PhilHealth Check, Verification code and Valid ID | They are the three modes of `patient_verification_mode` in guide 3.10, and later services read the same evidence |
| 2026-11-08 | The Validator shows Consultation as a stage, although the Figma status card removed it | The guide returns it, and the guide outranks Figma |
| 2026-11-08 | A consent record is written before every PCAPI call that handles patient data, and the screen requires a consent tick each time | Guide 3.5 and 3.6: send `consent: true` only after consent is recorded |
| 2026-11-08 | The app enforces the conditional fields that the guide's FPE and Consultation samples omit | Project owner: follow the guide, and guide 1.4 says the Data Dictionary prevails |
| 2026-11-08 | Selection and Empanelment are not retried automatically | A repeat after a lost response would return 409 and look like a failure |
| 2026-11-08 | The mock PCAPI is a separate Node server on port 4010, using the real encryption and Dictionary checks | The app talks to it exactly as it will to the real API |
| 2026-11-08 | Cipher keys are stored per facility, encrypted at rest; certificate ID and secret stay in server environment variables | The guide issues one certificate per provider and one cipher key per facility |
| 2026-11-08 | Validation is one rule engine driven by the generated Dictionary rules, not generated Zod schemas | Conditional rules need cross-field logic, errors must use the guide's JSON paths, and the same engine serves the server and the forms. Zod stays for non-specification forms such as login |
| 2026-11-08 | Keep the strict check when the guide's samples disagree with the Dictionary | The guide says the Dictionary prevails (1.4) |
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

### Guide samples that break the Data Dictionary

These request samples set a flag to `Y` but leave out the field the Dictionary then requires. A strict API would reject them. The list is enforced in `tests/fixtures/samples.ts`.

| Sample | Missing conditional fields |
|---|---|
| 4.6.1 FPE | `sochist.vape_current_years`, `sochist.vape_former_years`, `gynehist.menopause_age`, `gynehist.gynecological_disease`, `gynehist.gyn_sexually_transmitted_disease` |
| 4.6.2 Consultation | `sochist.vape_current_years`, `sochist.vape_former_years`, `sochist.substance_current_user_spec`, `sexhist.sti_spec`, `sf_obgyne_menshist.menopause_age`, `sf_obgyne_menshist.gynecological_disease` |

## 7. Open items

| Item | Needed by | Owner |
|---|---|---|
| Compare the patient age calculation for month-end dates with the API once it is reachable, and adjust if needed | Phase 8 | Development |
| Push to a GitHub remote so CI can run | When convenient | Project owner |
| Admin screen to manage staff accounts (only the seed script creates accounts today) | Before Phase 8 | Development |
| Real PSGC, ICD-10 and Konsulta Drug data | Phase 4 (placeholders until then) | Project owner |
| Reachable PCAPI staging host | Phase 8 at the latest | Project owner |
| PhilHealth software certificate and cipher keys for staging | Phase 8 at the latest; stored only in a local environment file | Project owner |

## 8. When the real API is available

Everything so far has been tested only against the mock in `mock/pcapi/`, which was built from the guide. Work through this list the first time the app can reach PCAPI, and add to it whenever a mock-only assumption is made.

### Connect

- [ ] Set `PCAPI_BASE_URL` (including `/primary-care`), `PCAPI_SOFTWARE_CERT_ID` and `PCAPI_SECRET_KEY` in the server environment
- [ ] Store each facility's real accreditation number and cipher key (`facilities.cipher_key_encrypted`; today only `npm run db:seed` writes these)
- [ ] Confirm TLS works from the server; if PCAPI uses a private certificate authority, set `NODE_EXTRA_CA_CERTS`
- [ ] Get a token, then confirm one encrypted call and its response decrypt with the real cipher key
- [ ] Confirm token expiry and revocation recover without staff noticing

### Confirm or adjust

| # | What the app assumes today | Where it lives | If the API differs |
|---|---|---|---|
| 1 | Age at month-end counts from the last whole month, clamped: 01/31 to 03/01 is 1 month, 1 day | `src/lib/fpe/derived.ts` | Change `ageOn`; the API rejects a mismatch |
| 2 | BMI uses height, or length when height is empty, rounded to 2 decimals | `src/lib/fpe/derived.ts`, `src/lib/fpe/form.ts` | Change `computeBmi` or which measure is used |
| 3 | Conditional fields the guide's own FPE and Consultation samples leave out are enforced | Rule engine; section 6 lists them | Relax the rule, or correct the guide samples |
| 4 | A conditional value whose rule does not apply is sent as `""` or left out, even if the guide's samples send a value | `serialize` in `src/lib/pcapi-spec/engine.ts` | Keep the value when sending |
| 5 | `request_id` is always a UUID | `uuid` columns in `src/server/db/schema.ts` | Change the columns to text, or inserts will fail |
| 6 | `expires_at`, `received_at` and `processed_at` are Philippine time with no offset | `src/lib/liveness-return.ts`, `src/server/uploads/poller.ts` | Adjust the parsing |
| 7 | The real LIVENESS SDK defines `window.eKYC()` with `redirect(...)`, and returns in the same tab with the fragment in the guide | `pcu-check.tsx`; the mock's SDK is a stand-in | Adjust the browser flow. Also test the camera, HTTPS, and whether return URLs must be registered |
| 8 | `liveness_authorization_id` fits in 100 characters | `patient_verifications` | Widen the column |
| 9 | Sending the Valid ID image on every request that day is accepted, though only the first requires it | `src/server/verification/evidence.ts` | Send it only on the first request and track that |
| 10 | Field paths in `errors[].field` match the JSON paths and can be mapped to wizard steps | `stepIndexForField` in `src/lib/fpe/form.ts` | Map the real paths |
| 11 | No issue codes exist beyond the guide's tables | `src/lib/pcapi-messages.ts` | Add wording; unknown codes show a generic message |
| 12 | A child upload waits while its parent is queued, and is rejected with its parent | Mock `processQueue` | Adjust the ordering or status handling |
| 13 | Only network failures and 502, 503, 504 are retried, with a 30-second timeout | `src/server/pcapi/client.ts` | Tune the timeout and retries |
| 14 | The worker keeps polling an upload that keeps failing, every 60 seconds | `src/server/uploads/poller.ts` | Decide when to stop, for example on `upload_not_found` |
| 15 | Masterlist values copy straight into the FPE and are read-only | `createFpeDraft` in `src/server/fpe/service.ts` | Make fields editable where the API allows corrections |
| 16 | An assigned beneficiary is detected by the identity fields being present | `validator-result.tsx`, `tracker-row.tsx` | Adjust the check |
| 17 | Multi-select codes are sent comma-separated with no spaces | `CheckboxList` in `spec-form.tsx` | Adjust the format |
| 18 | Medicine quantity reads the leading number of the free-text intake and duration, with doses per day inferred from the frequency code | `computeQuantity` in `src/lib/upload-forms/children.ts` | Change the calculation |
| 19 | `sochist.substance_former_user_spec` and `sf_headsss.headsss_urgent_referral_flag` are not enforced locally, because their rules name a form question with no field to check | Consultation definition | Add the rule once the API's behavior is known |
| 20 | `diagnostic_services_flag` values Y and R both allow a Diagnostic Request | `listUploads` in `src/server/uploads/service.ts` | Limit the Request to Y if R means results only |
| 21 | Referral `patient_age` repeats the age computed from the Masterlist birth date | `createChildDraft` in `src/server/uploads/clinical.ts` | Use the API's value |

### Replace mock and placeholder data

- [ ] Import the real PSGC, ICD-10 and Konsulta Drug codes with `npm run codes:import`, and deactivate the `[Placeholder]` rows
- [ ] Validate submitted PSGC, ICD-10 and drug codes against the imported lists; they are not checked locally today
- [ ] Stop running `npm run mock`, and remove the mock defaults from each server's environment
- [ ] Remove the test facility and accounts created by `npm run db:seed` from any shared environment

### Test against the API

- [ ] Run the whole journey: verification, Selection, FPE, Empanelment, Consultation and its child records, Masterlist, Availment Slip
- [ ] Run the failure paths listed in Phase 8
- [ ] Compare the mock with the API's real behavior, and fix the mock wherever it differs so tests stay meaningful
