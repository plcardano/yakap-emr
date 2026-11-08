import type { UploadForm, ValidationIssue } from "@/lib/pcapi-spec/types";

export type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type WizardStepDefinition = { id: string; title: string; groups: string[] };

/** An optional section of a form that staff switch on, such as a Specific Form. */
export type FormToggle = {
  id: string;
  label: string;
  groups: string[];
  isAvailable?: (values: Values) => boolean;
};

export type DerivedField = { label: string; value: string; source: string };

export type FormDefinition = {
  form: UploadForm;
  title: string;
  steps: WizardStepDefinition[];
  groupTitles: Record<string, string>;
  /** Filled by the server or computed, so never shown as an input. */
  hidden: Set<string>;
  /** Shown but not editable, with where the value came from. */
  readOnly: Map<string, string>;
  /** Groups the guide always requires; arrays need at least one entry. */
  requiredObjects: string[];
  requiredArrays: string[];
  /** Where the form records how the patient was verified. */
  verification?: { group: string; stepId: string };
  /** The JSON path of the patient's PIN. */
  patientPin?: (values: Values) => string;
  /** Recalculates values after every edit. */
  derive?: (values: Values) => Values;
  /** Removes what does not apply and adds computed values before validation. */
  prepare: (input: Values) => void;
  /** Rules the Data Dictionary states in words. */
  extraIssues?: (input: Values, body: Values) => ValidationIssue[];
  alsoRequired?: (values: Values) => Set<string>;
  isStepApplicable?: (step: WizardStepDefinition, values: Values) => boolean;
  visibleGroups?: (groups: string[], values: Values) => string[];
  showNested?: (path: (string | number)[], row: Values) => boolean;
  fixedRows?: Set<string>;
  toggles?: FormToggle[];
  derivedFields?: (stepId: string, values: Values) => DerivedField[];
  describePatient: (values: Values) => string;
};
