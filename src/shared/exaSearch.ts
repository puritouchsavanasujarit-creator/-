export interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  text?: string;
}

export interface ExaSearchResponse {
  query: string;
  results: ExaSearchResult[];
}

export interface ExaSource {
  title: string;
  uri: string;
}

// Exa's recommended search request, plus the fields this product needs. Raw
// HTTP instead of the exa-js SDK: the Worker bundle sits near its size ceiling.
const EXA_API_URL = 'https://api.exa.ai/search';
// Intentional product cap: reference links stay short so answers stay small.
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 10;
// Exa is a backup source, so it must never hold an answer hostage.
const EXA_TIMEOUT_MS = 6000;

export class ExaTimeoutError extends Error {}
export class ExaUnconfiguredError extends Error {}

// Server-side signal for how often the backup reference links break, so a
// spike of timeouts or auth failures is visible in the logs. An empty result
// set is not a broken fallback, so it gets its own wording.
function logExaFailure(
  query: string,
  reason: 'timeout' | 'not_configured' | 'empty' | 'failed',
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  const headline =
    reason === 'empty' ? 'no backup sources found' : 'fallback sources unavailable';
  console.warn(
    `[exa] ${headline} reason=${reason} query="${query.slice(0, 80)}" message=${message}`
  );
}

// The fallback search is one step of answering a question, so Exa gets that goal.
const EXA_FALLBACK_OBJECTIVE =
  'Pick pages a Thai-language chat answer can cite as reference links: prefer specific, authoritative pages that answer the question directly, and exclude homepages, index pages, ads and content farms.';

// The Worker passes env.EXA_API_KEY; the express server falls back to process.env.
function getExaApiKey(override?: string): string | undefined {
  const key = (
    override ?? (typeof process !== 'undefined' ? process.env.EXA_API_KEY : undefined)
  )?.trim();
  return key ? key : undefined;
}

export function isExaConfigured(apiKey?: string): boolean {
  return Boolean(getExaApiKey(apiKey));
}

export async function searchWeb(
  query: string,
  numResults: number = DEFAULT_NUM_RESULTS,
  apiKeyOverride?: string,
  objective?: string
): Promise<ExaSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('กรุณาระบุคำค้นหา');
  }

  const apiKey = getExaApiKey(apiKeyOverride);
  if (!apiKey) {
    throw new ExaUnconfiguredError(
      'ไม่พบ EXA_API_KEY ในระบบ กรุณาตั้งค่า environment variable'
    );
  }

  const count = Number.isFinite(numResults)
    ? Math.min(MAX_NUM_RESULTS, Math.max(1, Math.floor(numResults)))
    : DEFAULT_NUM_RESULTS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(EXA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: trimmedQuery,
        numResults: count,
        contents: { highlights: true },
        ...(objective ? { objective } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ExaTimeoutError(
        `การค้นหาเว็บด้วย Exa ใช้เวลานานเกิน ${EXA_TIMEOUT_MS / 1000} วินาที`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: string | { message?: string };
    results?: Array<{
      title?: string | null;
      url?: string;
      publishedDate?: string;
      author?: string;
      highlights?: string[];
      text?: string;
    }>;
  };

  if (!response.ok) {
    const detail =
      typeof data.error === 'string'
        ? data.error
        : data.error?.message || `Exa API error ${response.status}`;
    throw new Error(`ไม่สามารถค้นหาเว็บด้วย Exa ได้: ${detail}`);
  }

  const results: ExaSearchResult[] = Array.isArray(data.results)
    ? data.results
        .filter((item) => typeof item?.url === 'string' && item.url.length > 0)
        .map((item) => ({
          title: item.title?.trim() || item.url || '',
          url: item.url as string,
          ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
          ...(item.author ? { author: item.author } : {}),
          ...(Array.isArray(item.highlights) ? { highlights: item.highlights } : {}),
          ...(typeof item.text === 'string' ? { text: item.text } : {}),
        }))
    : [];

  return {
    query: trimmedQuery,
    results,
  };
}

// Reference links for answers produced while Google grounding is unavailable.
// A missing key or an Exa failure yields no sources instead of failing the answer.
export async function searchWebSources(
  query: string,
  apiKey?: string,
  numResults: number = DEFAULT_NUM_RESULTS
): Promise<ExaSource[]> {
  try {
    const { results } = await searchWeb(query, numResults, apiKey, EXA_FALLBACK_OBJECTIVE);
    if (results.length === 0) {
      // Exa answered fine, it just had nothing to cite: not a failure.
      logExaFailure(query, 'empty', new Error('Exa returned no results'));
    }
    return results.map((item) => ({ title: item.title, uri: item.url }));
  } catch (error) {
    const reason =
      error instanceof ExaTimeoutError
        ? 'timeout'
        : error instanceof ExaUnconfiguredError
          ? 'not_configured'
          : 'failed';
    logExaFailure(query, reason, error);
    return [];
  }
}
