import { describe, expect, it, vi } from "vitest";
import { guideSample, validSample } from "../../../tests/fixtures/samples";
import type { PcapiClient } from "./client";
import { pcapiServices } from "./services";

function setup() {
  const callJson = vi.fn(async () => ({ data: {}, status: 200, message: "", requestId: "r" }));
  const callBytes = vi.fn(async () => ({
    data: Buffer.alloc(0),
    status: 200,
    message: "",
    requestId: "r",
  }));
  const api = pcapiServices({ callJson, callBytes } as unknown as PcapiClient, "H12345678");
  const retryOf = () => (callJson.mock.calls.at(-1) as unknown as [{ retry: boolean }])[0].retry;
  return { api, callJson, callBytes, retryOf };
}

const pcu = { first_name: "A", last_name: "B", birth_date: "01/31/1990" };

describe("retry policy (guide 3.4, 4.1, 4.3, 4.4, 4.6)", () => {
  it("never retries calls that cannot be safely repeated", async () => {
    const { api, retryOf } = setup();
    await api.pcuStart(pcu);
    expect(retryOf()).toBe(false);
    await api.pcuVerify("id");
    expect(retryOf()).toBe(false);
    await api.selection(guideSample("selection"));
    expect(retryOf()).toBe(false);
    await api.empanelment(guideSample("empanelment"));
    expect(retryOf()).toBe(false);
  });

  it("retries reads and uploads, where a repeat is harmless", async () => {
    const { api, retryOf } = setup();
    await api.validator(guideSample("validator"));
    expect(retryOf()).toBe(true);
    await api.upload("fpe", validSample("fpe"));
    expect(retryOf()).toBe(true);
    await api.uploadStatus("UH123456782026102500001");
    expect(retryOf()).toBe(true);
  });
});

describe("requests sent", () => {
  it("does not send a consent field to PCU", async () => {
    const { api, callJson } = setup();
    await api.pcuStart(pcu);
    const { body } = (callJson.mock.calls[0] as unknown as [{ body: object }])[0];
    expect(body).not.toHaveProperty("consent");
  });

  it("never contains null", async () => {
    const { api, callJson } = setup();
    await api.selection({ ...guideSample("selection"), valid_id_type: null });
    const { body } = (callJson.mock.calls[0] as unknown as [{ body: object }])[0];
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("encodes the upload number in the path", async () => {
    const { api, callJson } = setup();
    await api.uploadStatus("U/1");
    expect((callJson.mock.calls[0] as unknown as [{ path: string }])[0].path).toBe(
      "/api/v1/yakap-data-upload/status/U%2F1",
    );
  });
});
