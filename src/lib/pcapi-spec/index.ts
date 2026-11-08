import labelsJson from "@/generated/pcapi-labels.json";
import librariesJson from "@/generated/pcapi-libraries.json";
import rulesJson from "@/generated/pcapi-rules.json";
import * as engine from "./engine";
import type { FieldLabel, FieldRule, LibraryCode, SpecId } from "./types";

export type * from "./types";

const rules = rulesJson as Record<SpecId, FieldRule[]>;
export const libraries = librariesJson as Record<string, LibraryCode[]>;

const trees = new Map<SpecId, ReturnType<typeof engine.buildTree>>();

function tree(id: SpecId) {
  let root = trees.get(id);
  if (!root) {
    root = engine.buildTree(rules[id]);
    trees.set(id, root);
  }
  return root;
}

type Body = Record<string, unknown>;

export function rulesFor(id: SpecId) {
  return rules[id];
}

export function serializeRequest(id: SpecId, input: Body) {
  return engine.serialize(tree(id), input);
}

export function validateRequest(id: SpecId, body: Body, options?: { accreNo?: string }) {
  return engine.validate(tree(id), body, libraries, options);
}

export function unknownRequestFields(id: SpecId, body: Body) {
  return engine.unknownFields(tree(id), body);
}

export function labelsFor(id: SpecId) {
  return (labelsJson as unknown as Record<string, Record<string, FieldLabel>>)[id];
}

/** Only the libraries a form uses, so the page stays small. */
export function librariesFor(id: SpecId) {
  const names = new Set(rules[id].flatMap((rule) => rule.library ?? []));
  return Object.fromEntries([...names].map((name) => [name, libraries[name]]));
}
