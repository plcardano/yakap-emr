# YAKAP 2.0 Web App

Read `docs/DEVELOPMENT_PLAN.md` first. It holds the current phase, the checklist, the decision log and open items.

## Keep the plan current

Update `docs/DEVELOPMENT_PLAN.md` in the same piece of work whenever:

- a task is finished: tick its checkbox, and update the Progress table, **Current phase** and **Next action**
- a decision is made: add a dated row at the top of the Decision log
- an open item appears or is resolved: update the Open items table

Always update **Last updated**.

## Source priority

Data Dictionary, then Library Reference, then Implementation Guide, then Figma. The spec files are in `docs/spec/`. Figma is a prototype for layout and style only; do not build anything that has no endpoint or rule in the guide.

## Rules from the guide

- Certificates, secret keys, cipher keys and bearer tokens stay on the server. Never send them to the browser.
- Never log secrets, tokens, LIVENESS launch tokens, complete identity payloads or ID images. Mask PINs and birth dates in logs.
- Program against `code`, `errors[].issue` and data fields, never the text of `message`.
- Requests never contain `null`. Optional strings are sent as `""`; empty numbers and booleans are left out.
- Field sizes are bytes in UTF-8, not characters.
