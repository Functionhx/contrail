import { isValidRate, SUPPORTED_CURRENCY_CODES } from "./currency";

// Open-source ECB-derived feed. No API key required, generally reachable
// (CloudFront-fronted). Failure is graceful — callers fall back to the
// cached or bundled-default rates so an offline / blocked network never
// breaks the UI.
export const EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/USD";

export const EXCHANGE_RATE_TTL_MS = 24 * 60 * 60 * 1000;
export const EXCHANGE_RATE_FETCH_TIMEOUT_MS = 5000;

export interface FetchedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

export function shouldRefetch(
  fetchedAt: number | null | undefined,
  ttlMs: number = EXCHANGE_RATE_TTL_MS,
  now: number = Date.now(),
): boolean {
  if (!fetchedAt || !Number.isFinite(fetchedAt)) return true;
  return now - fetchedAt > ttlMs;
}

interface FetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  url?: string;
  codes?: readonly string[];
}

// Contrail: 页面只显示美元，且不向第三方发请求（CSP 也禁止）。上游在这里请求
// open.er-api.com 拉汇率；改为直接失败，CurrencyProvider 会回退到内置默认值。
export async function fetchUsdRates(_opts: FetchOptions = {}): Promise<FetchedRates> {
  throw new Error("Exchange rates are not fetched in Contrail");
}
