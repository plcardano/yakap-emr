import { describe, expect, it, vi } from "vitest";
import { PcapiClient } from "./client";
import { decryptEnvelope, encryptEnvelope } from "./envelope";
import { PcapiError, PcapiNetworkError, PcapiResponseError } from "./errors";

const CIPHER = "unit-test-cipher";
const CALL = { accreNo: "H12345678", method: "POST", path: "/api/v1/x", body: { a: 1 } } as const;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status });
const tokenResponse = (token = "t1", expires = 3600) =>
  json(200, {
    status: "success",
    code: 200,
    message: "ok",
    data: { access_token: token, token_type: "Bearer", expires_in: expires },
  });
const ok = (data: object = { done: true }) =>
  json(200, {
    status: "success",
    code: 200,
    message: "ok",
    request_id: "req-1",
    data: encryptEnvelope(JSON.stringify(data), CIPHER),
  });
const failure = (status: number, issue: string) =>
  json(status, {
    status: "error",
    code: status,
    message: "failed",
    request_id: "req-2",
    errors: [{ field: "x", issue }],
  });

function setup(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("No more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => undefined);
  const client = new PcapiClient({
    baseUrl: "http://pcapi.test/primary-care",
    softwareCertId: "SC-1",
    secretKey: "secret",
    cipherKeyFor: async () => CIPHER,
    fetch: fetchMock as unknown as typeof fetch,
    sleep,
  });
  const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][];
  return { client, fetchMock, sleep, calls };
}

describe("PcapiClient", () => {
  it("sends an encrypted body with the bearer token and decrypts the data", async () => {
    const { client, calls } = setup(tokenResponse(), ok());
    const result = await client.callJson({ ...CALL, retry: true });

    expect(result).toMatchObject({ data: { done: true }, requestId: "req-1" });
    const [url, init] = calls()[1];
    expect(url).toBe("http://pcapi.test/primary-care/api/v1/x");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t1");
    const sent = decryptEnvelope(JSON.parse(init.body as string), CIPHER).toString();
    expect(sent).toBe('{"a":1}');
  });

  it("sends the token request in plain JSON", async () => {
    const { client, calls } = setup(tokenResponse(), ok());
    await client.callJson({ ...CALL, retry: true });
    expect(JSON.parse(calls()[0][1].body as string)).toEqual({
      software_cert_id: "SC-1",
      accre_no: "H12345678",
      secret_key: "secret",
    });
  });

  it("reuses a token within its lifetime", async () => {
    const { client, fetchMock } = setup(tokenResponse(), ok(), ok());
    await client.callJson({ ...CALL, retry: true });
    await client.callJson({ ...CALL, retry: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requests one token for simultaneous calls", async () => {
    const { client, fetchMock } = setup(tokenResponse(), ok(), ok());
    await Promise.all([
      client.callJson({ ...CALL, retry: true }),
      client.callJson({ ...CALL, retry: true }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requests a new token when the current one is near expiry", async () => {
    const { client, calls } = setup(tokenResponse("old", 30), ok(), tokenResponse("new"), ok());
    await client.callJson({ ...CALL, retry: true });
    await client.callJson({ ...CALL, retry: true });
    expect((calls()[3][1].headers as Record<string, string>).Authorization).toBe("Bearer new");
  });

  it("keeps tokens separate per facility", async () => {
    const { client, calls } = setup(tokenResponse("a"), ok(), tokenResponse("b"), ok());
    await client.callJson({ ...CALL, retry: true });
    await client.callJson({ ...CALL, accreNo: "H99999999", retry: true });
    expect(JSON.parse(calls()[2][1].body as string).accre_no).toBe("H99999999");
  });

  it("re-authenticates once on 401", async () => {
    const { client, calls } = setup(
      tokenResponse("revoked"),
      failure(401, "unauthorized"),
      tokenResponse("fresh"),
      ok(),
    );
    await client.callJson({ ...CALL, retry: false });
    expect((calls()[3][1].headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });

  it("gives up after a second 401", async () => {
    const { client } = setup(
      tokenResponse(),
      failure(401, "unauthorized"),
      tokenResponse(),
      failure(401, "unauthorized"),
    );
    await expect(client.callJson({ ...CALL, retry: true })).rejects.toBeInstanceOf(PcapiError);
  });

  it.each([400, 403, 404, 409, 422, 429])("does not retry a %i", async (status) => {
    const { client, fetchMock, sleep } = setup(tokenResponse(), failure(status, "some_issue"));
    const error = await client.callJson({ ...CALL, retry: true }).catch((e) => e);
    expect(error).toBeInstanceOf(PcapiError);
    expect(error.hasIssue("some_issue")).toBe(true);
    expect(error.requestId).toBe("req-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry 500 internal_error", async () => {
    const { client, fetchMock } = setup(tokenResponse(), failure(500, "internal_error"));
    await expect(client.callJson({ ...CALL, retry: true })).rejects.toBeInstanceOf(PcapiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 503 with growing delays", async () => {
    const { client, sleep } = setup(
      tokenResponse(),
      failure(503, "service_unavailable"),
      failure(503, "service_unavailable"),
      ok(),
    );
    await client.callJson({ ...CALL, retry: true });
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it("retries network failures", async () => {
    const { client } = setup(tokenResponse(), new TypeError("connection reset"), ok());
    await expect(client.callJson({ ...CALL, retry: true })).resolves.toBeDefined();
  });

  it("stops when retries run out", async () => {
    const { client, fetchMock } = setup(
      tokenResponse(),
      ...Array.from({ length: 4 }, () => new TypeError("down")),
    );
    await expect(client.callJson({ ...CALL, retry: true })).rejects.toBeInstanceOf(
      PcapiNetworkError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("never retries a call marked retry: false", async () => {
    const { client, fetchMock } = setup(tokenResponse(), new TypeError("timeout"));
    await expect(client.callJson({ ...CALL, retry: false })).rejects.toBeInstanceOf(
      PcapiNetworkError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discards a response whose hash does not match", async () => {
    const data = { ...encryptEnvelope("{}", CIPHER), hash: "0".repeat(64) };
    const { client } = setup(
      tokenResponse(),
      json(200, { status: "success", code: 200, message: "ok", request_id: "req-9", data }),
    );
    const error = await client.callJson({ ...CALL, retry: true }).catch((e) => e);
    expect(error).toBeInstanceOf(PcapiResponseError);
    expect(error).toMatchObject({ issue: "hash_mismatch", requestId: "req-9" });
  });

  it("returns PDF content as bytes", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%%EOF");
    const { client } = setup(
      tokenResponse(),
      json(200, {
        status: "success",
        code: 200,
        message: "ok",
        data: encryptEnvelope(pdf, CIPHER, { mimeType: "application/pdf" }),
      }),
    );
    const result = await client.callBytes({ ...CALL, retry: true });
    expect(result.data.equals(pdf)).toBe(true);
  });
});
