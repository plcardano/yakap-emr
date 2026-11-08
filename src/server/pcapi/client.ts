import { decryptEnvelope, encryptEnvelope, EnvelopeError } from "./envelope";
import {
  PcapiError,
  PcapiNetworkError,
  PcapiResponseError,
  type ApiIssue,
} from "./errors";

export type PcapiConfig = {
  /** Environment base URL, including /primary-care. */
  baseUrl: string;
  softwareCertId: string;
  secretKey: string;
  cipherKeyFor: (accreNo: string) => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type Envelope = {
  status: "success" | "error";
  code: number;
  message: string;
  timestamp: string;
  request_id?: string;
  data?: unknown;
  errors?: ApiIssue[];
};

type Token = { value: string; expiresAt: number };

export type PcapiResult<T> = {
  data: T;
  status: number;
  message: string;
  requestId: string | undefined;
};

type CallOptions = {
  accreNo: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Allow retries on network failures and 502, 503 and 504. */
  retry: boolean;
};

// Renew early so a token cannot expire in the middle of a request.
const TOKEN_MARGIN_MS = 60_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export class PcapiClient {
  private readonly tokens = new Map<string, Token>();
  private readonly pendingTokens = new Map<string, Promise<string>>();
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: PcapiConfig) {
    this.fetch = config.fetch ?? fetch;
    this.sleep =
      config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  private url(path: string) {
    return `${this.config.baseUrl}${path}`;
  }

  private async send(path: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.fetch(this.url(path), {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new PcapiNetworkError(`Could not reach PCAPI at ${path}`, { cause });
    }

    let envelope: Envelope;
    try {
      envelope = (await response.json()) as Envelope;
    } catch (cause) {
      throw new PcapiNetworkError(`PCAPI returned an unreadable response at ${path}`, {
        cause,
      });
    }
    return { response, envelope };
  }

  private async requestToken(accreNo: string) {
    const { response, envelope } = await this.send("/api/v1/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        software_cert_id: this.config.softwareCertId,
        accre_no: accreNo,
        secret_key: this.config.secretKey,
      }),
    });
    if (!response.ok) {
      throw new PcapiError(
        response.status,
        envelope.errors ?? [],
        envelope.request_id,
        envelope.message,
      );
    }
    const { access_token, expires_in } = envelope.data as {
      access_token: string;
      expires_in: number;
    };
    this.tokens.set(accreNo, {
      value: access_token,
      expiresAt: Date.now() + expires_in * 1000 - TOKEN_MARGIN_MS,
    });
    return access_token;
  }

  private token(accreNo: string) {
    const cached = this.tokens.get(accreNo);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

    let pending = this.pendingTokens.get(accreNo);
    if (!pending) {
      pending = this.requestToken(accreNo).finally(() =>
        this.pendingTokens.delete(accreNo),
      );
      this.pendingTokens.set(accreNo, pending);
    }
    return pending;
  }

  private async attempt(options: CallOptions, cipherKey: string) {
    const token = await this.token(options.accreNo);
    return this.send(options.path, {
      method: options.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined && { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(encryptEnvelope(JSON.stringify(options.body), cipherKey)),
    });
  }

  private async attemptWithFreshToken(options: CallOptions, cipherKey: string) {
    const first = await this.attempt(options, cipherKey);
    if (first.response.status !== 401) return first;
    this.tokens.delete(options.accreNo);
    return this.attempt(options, cipherKey);
  }

  private async withRetries(options: CallOptions, cipherKey: string) {
    const retries = options.retry ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      const delay = 2 ** attempt * 500;
      try {
        const result = await this.attemptWithFreshToken(options, cipherKey);
        if (!RETRYABLE_STATUS.has(result.response.status) || attempt >= retries) {
          return result;
        }
      } catch (error) {
        if (!(error instanceof PcapiNetworkError) || attempt >= retries) throw error;
      }
      await this.sleep(delay);
    }
  }

  private async decrypted(options: CallOptions) {
    const cipherKey = await this.config.cipherKeyFor(options.accreNo);
    const { response, envelope } = await this.withRetries(options, cipherKey);

    if (!response.ok) {
      throw new PcapiError(
        response.status,
        envelope.errors ?? [],
        envelope.request_id,
        envelope.message,
      );
    }

    try {
      return { envelope, status: response.status, bytes: decryptEnvelope(envelope.data, cipherKey) };
    } catch (error) {
      if (error instanceof EnvelopeError) {
        throw new PcapiResponseError(error.issue, envelope.request_id);
      }
      throw error;
    }
  }

  async callJson<T>(options: CallOptions): Promise<PcapiResult<T>> {
    const { envelope, status, bytes } = await this.decrypted(options);
    return {
      data: JSON.parse(bytes.toString("utf8")) as T,
      status,
      message: envelope.message,
      requestId: envelope.request_id,
    };
  }

  async callBytes(options: CallOptions): Promise<PcapiResult<Buffer>> {
    const { envelope, status, bytes } = await this.decrypted(options);
    return { data: bytes, status, message: envelope.message, requestId: envelope.request_id };
  }
}
