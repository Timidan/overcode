export type ProviderName = "github" | "gitlab" | "watsonx" | "ibm-iam";

export interface ProviderRateLimit {
  provider: ProviderName;
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  resource?: string;
  checkedAt: number;
}

export class ProviderRequestError extends Error {
  provider: ProviderName;
  status?: number;
  rateLimit?: ProviderRateLimit;

  constructor(
    provider: ProviderName,
    message: string,
    options: { status?: number; rateLimit?: ProviderRateLimit } = {},
  ) {
    super(message);
    this.provider = provider;
    this.status = options.status;
    this.rateLimit = options.rateLimit;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_PAGES = 10;
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const rateLimits = new Map<ProviderName, ProviderRateLimit>();

export function getProviderRateLimitSnapshots(): Partial<Record<ProviderName, ProviderRateLimit>> {
  return Object.fromEntries(rateLimits.entries());
}

export async function requestJson<T>(
  provider: ProviderName,
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const response = await requestRaw(provider, url, init, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function requestVoid(
  provider: ProviderName,
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<void> {
  await requestRaw(provider, url, init, options);
}

export async function requestPaginated<T>(
  provider: ProviderName,
  url: string,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    retries?: number;
    maxPages?: number;
    extractItems?: (value: unknown) => T[];
  } = {},
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = url;
  let pages = 0;
  while (nextUrl && pages < (options.maxPages ?? DEFAULT_MAX_PAGES)) {
    const response = await requestRaw(provider, nextUrl, init, options);
    const value = await response.json();
    items.push(...extractPageItems<T>(value, options.extractItems));
    nextUrl = nextLink(response.headers.get("link"));
    pages += 1;
  }
  return items;
}

async function requestRaw(
  provider: ProviderName,
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      const rateLimit = readRateLimit(provider, response.headers);
      if (rateLimit) rateLimits.set(provider, rateLimit);
      if (response.ok) return response;

      if (TRANSIENT_STATUSES.has(response.status) && attempt < retries) {
        await discardBody(response);
        await sleep(retryDelayMs(attempt, response.headers));
        continue;
      }

      await discardBody(response);
      throw new ProviderRequestError(
        provider,
        `${provider} request failed (${response.status})`,
        { status: response.status, rateLimit },
      );
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderRequestError) throw error;
      if (attempt < retries) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new ProviderRequestError(provider, `${provider} request timed out`);
  }
  throw new ProviderRequestError(provider, `${provider} request failed`);
}

function extractPageItems<T>(
  value: unknown,
  extractItems?: (value: unknown) => T[],
): T[] {
  if (extractItems) return extractItems(value);
  return Array.isArray(value) ? (value as T[]) : [];
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Response body is only discarded so the connection can be reused.
  }
}

function readRateLimit(
  provider: ProviderName,
  headers: Headers,
): ProviderRateLimit | undefined {
  if (provider === "github") {
    return {
      provider,
      limit: numberHeader(headers, "x-ratelimit-limit"),
      remaining: numberHeader(headers, "x-ratelimit-remaining"),
      resetAt: epochSecondsHeader(headers, "x-ratelimit-reset"),
      resource: headers.get("x-ratelimit-resource") ?? undefined,
      checkedAt: Date.now(),
    };
  }
  if (provider === "gitlab") {
    return {
      provider,
      limit: numberHeader(headers, "ratelimit-limit"),
      remaining: numberHeader(headers, "ratelimit-remaining"),
      resetAt: epochSecondsHeader(headers, "ratelimit-reset"),
      checkedAt: Date.now(),
    };
  }
  return undefined;
}

function numberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function epochSecondsHeader(headers: Headers, name: string): number | null {
  const parsed = numberHeader(headers, name);
  return parsed === null ? null : parsed * 1000;
}

function nextLink(value: string | null): string | null {
  if (!value) return null;
  const match = value
    .split(",")
    .map((part) => part.trim().match(/^<([^>]+)>;\s*rel="next"$/))
    .find((part) => part?.[1]);
  return match?.[1] ?? null;
}

function retryDelayMs(attempt: number, headers?: Headers): number {
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  }
  return Math.min(500 * 2 ** attempt, 4_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
