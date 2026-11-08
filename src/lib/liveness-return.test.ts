import { describe, expect, it } from "vitest";
import {
  checkLivenessReturn,
  draftExpiry,
  isLivenessReturn,
  newLivenessState,
  type LivenessDraft,
} from "./liveness-return";

const NOW = 1_000_000;
const URL = "http://localhost:3000/verification";
const draft: LivenessDraft = {
  authorizationId: "auth-1",
  state: "abc",
  returnUrl: URL,
  expiresAt: NOW + 1000,
};
const hash = (status = "COMPLETED", id = "auth-1", state = "abc") =>
  `#pcu_liveness_status=${status}&pcu_liveness_authorization_id=${id}&pcu_liveness_state=${state}`;

describe("checkLivenessReturn", () => {
  it("accepts a matching return", () => {
    expect(checkLivenessReturn(hash(), draft, URL, NOW)).toBe("auth-1");
  });

  it.each([
    ["no saved attempt", hash(), null, URL, NOW],
    ["a cancelled capture", hash("CANCELLED"), draft, URL, NOW],
    ["a different authorization", hash("COMPLETED", "auth-2"), draft, URL, NOW],
    ["a different state", hash("COMPLETED", "auth-1", "zzz"), draft, URL, NOW],
    ["a different page", hash(), draft, "http://localhost:3000/other", NOW],
    ["an expired attempt", hash(), draft, URL, NOW + 1001],
  ])("refuses %s", (_name, fragment, saved, url, now) => {
    expect(checkLivenessReturn(fragment, saved, url, now)).toBeNull();
  });
});

describe("liveness helpers", () => {
  it("makes a 64-character lowercase hex state", () => {
    expect(newLivenessState()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads expires_at as Philippine time and caps it at five minutes", () => {
    const now = Date.parse("2026-10-25T02:00:00Z");
    expect(draftExpiry("2026-10-25T10:01:00", now)).toBe(Date.parse("2026-10-25T02:01:00Z"));
    expect(draftExpiry("2026-10-25T11:00:00", now)).toBe(now + 300_000);
  });

  it("recognizes a return fragment", () => {
    expect(isLivenessReturn(hash())).toBe(true);
    expect(isLivenessReturn("#other=1")).toBe(false);
  });
});
