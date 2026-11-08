"use client";

import { LookupForm } from "../validator/lookup-form";
import { trackerAction } from "./actions";
import { TrackerRow } from "./tracker-row";

export function EmpanelmentSearch() {
  return (
    <LookupForm
      search={trackerAction}
      renderResult={(tracker, update) => <TrackerRow tracker={tracker} onUpdate={update} />}
    />
  );
}
