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

const EXA_API_URL = 'https://api.exa.ai/search';
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 10;

function getExaApiKey(): string | undefined {
  const key = process.env.EXA_API_KEY?.trim();
  return key ? key : undefined;
}

export function isExaConfigured(): boolean {
  return Boolean(getExaApiKey());
}

export async function searchWeb(
  query: string,
  numResults: number = DEFAULT_NUM_RESULTS
): Promise<ExaSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('กรุณาระบุคำค้นหา');
  }

  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error('ไม่พบ EXA_API_KEY ในระบบ กรุณาตั้งค่า environment variable');
  }

  const count = Number.isFinite(numResults)
    ? Math.min(MAX_NUM_RESULTS, Math.max(1, Math.floor(numResults)))
    : DEFAULT_NUM_RESULTS;

  const response = await fetch(EXA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query: trimmedQuery,
      numResults: count,
      type: 'auto',
      contents: {
        highlights: {
          maxCharacters: 600,
        },
      },
    }),
  });

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
