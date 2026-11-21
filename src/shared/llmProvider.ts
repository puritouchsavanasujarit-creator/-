import {
  GEMINI_MODEL_CHAIN,
  GEMINI_MODELS,
  geminiApiKeys,
  modelChainStartingWith,
  withApiKeyFallback,
  type GeminiSchema,
} from './geminiPrompts.ts';

// Everything the provider layer needs from the environment. Both backends
// (worker.ts on Workers, server.ts on Node) read the same names, so a key set
// in one place behaves identically in the other.
export interface LlmEnv {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  LLM_API_KEY?: string;
  LLM_API_KEY_2?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_MODEL_2?: string;
}

// Groq's OpenAI-compatible endpoint: free tier, no card, and json_schema output.
// Swap the base URL/model with LLM_BASE_URL + LLM_MODEL for any other provider
// (OpenRouter, Together, Cerebras, a self-hosted gateway, …).
const DEFAULT_OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_OPENAI_MODEL = 'openai/gpt-oss-120b';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// One request shape for every endpoint: the Gemini REST body the handlers
// already build. The OpenAI-compatible provider translates it, so callers do
// not care which provider answers.
export interface LlmProvider {
  kind: 'gemini' | 'openai-compatible';
  label: string;
  models: readonly string[];
  hintModels: readonly string[];
  mapsModels: readonly string[];
  generate(model: string, body: unknown): Promise<any>;
}

// Google grounding cannot be served by another provider. The message carries
// "503" on purpose so the existing degraded path (groundingFallback) treats it
// like an unavailable tool instead of a hard failure.
export class GroundingUnsupportedError extends Error {
  readonly status = 503;

  constructor(providerLabel: string, tool: 'googleSearch' | 'googleMaps') {
    super(
      `เครื่องมือ ${tool} ของ Google ใช้ไม่ได้กับผู้ให้บริการ ${providerLabel} (503 UNAVAILABLE)`
    );
    this.name = 'GroundingUnsupportedError';
  }
}

function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

// Gemini schemas use uppercase types; OpenAI-compatible structured output wants
// JSON Schema. Strict mode also requires every property to be listed as required
// and objects to forbid extra keys.
export function toJsonSchema(schema: GeminiSchema): Record<string, unknown> {
  const type = String(schema?.type ?? 'string').toLowerCase();
  if (type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, toJsonSchema(value)])
    );
    return {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (type === 'array') {
    return { type: 'array', items: toJsonSchema(schema.items ?? { type: 'string' }) };
  }
  return { type };
}

function toChatMessages(body: any): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (body?.systemInstruction) {
    messages.push({ role: 'system', content: partsText(body.systemInstruction.parts) });
  }
  const contents = body?.contents;
  if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents });
  } else if (Array.isArray(contents)) {
    for (const item of contents) {
      messages.push({
        role: item?.role === 'model' ? 'assistant' : 'user',
        content: partsText(item?.parts),
      });
    }
  }
  return messages;
}

// Runtimes throw on a missing key before any network call; keep that message
// recognizable so the UI can say which secret to set.
function missingKeyError(name: string): Error {
  return new Error(`ไม่พบ ${name} ในระบบ กรุณาตรวจสอบการตั้งค่า Secrets`);
}

function withStatus(error: Error, status: number): Error {
  (error as Error & { status?: number }).status = status;
  return error;
}

async function geminiGenerate(env: LlmEnv, model: string, body: any): Promise<any> {
  const keys = geminiApiKeys(env.GEMINI_API_KEY, env.GEMINI_API_KEY_2);
  if (keys.length === 0) throw missingKeyError('GEMINI_API_KEY');
  // An exhausted key says nothing about the model: retry the same request on the
  // backup key before letting the model count as failed.
  return withApiKeyFallback(keys, async (key) => {
    const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const message = data?.error?.message || `Gemini API error ${response.status}`;
      const status = data?.error?.status ? ` ${data.error.status}` : '';
      throw withStatus(
        new Error(
          `${message}${status}${response.status === 429 ? ' RESOURCE_EXHAUSTED' : ''}`
        ),
        response.status
      );
    }
    return data;
  });
}

async function openAiCompatibleGenerate(
  env: LlmEnv,
  baseUrl: string,
  model: string,
  body: any
): Promise<any> {
  const keys = [env.LLM_API_KEY, env.LLM_API_KEY_2]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key));
  if (keys.length === 0) throw missingKeyError('LLM_API_KEY');

  const payload: Record<string, unknown> = { model, messages: toChatMessages(body) };
  const config = body?.generationConfig ?? {};
  if (config.responseSchema) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: toJsonSchema(config.responseSchema),
      },
    };
  } else if (config.responseMimeType === 'application/json') {
    payload.response_format = { type: 'json_object' };
  }
  if (typeof config.maxOutputTokens === 'number') payload.max_tokens = config.maxOutputTokens;

  return withApiKeyFallback(keys, async (key) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || `error ${response.status}`;
      throw withStatus(
        new Error(
          `${detail} (${response.status})${response.status === 429 ? ' RESOURCE_EXHAUSTED' : ''}`
        ),
        response.status
      );
    }
    const raw = data?.choices?.[0]?.message?.content;
    const text = typeof raw === 'string' ? raw : partsText(raw);
    // Same shape Gemini returns, so readGeneratedText and the search/maps
    // extractors keep working unchanged.
    return { candidates: [{ content: { parts: [{ text }] } }] };
  });
}

function providerLabel(env: LlmEnv): string {
  if (!env.LLM_API_KEY?.trim()) return 'Google Gemini';
  const baseUrl = (env.LLM_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  return `OpenAI-compatible (${hostOf(baseUrl)})`;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.replace(/^api\./, '');
  } catch {
    return baseUrl;
  }
}

export function selectLlmProvider(env: LlmEnv): LlmProvider {
  if (!env.LLM_API_KEY?.trim()) {
    return {
      kind: 'gemini',
      label: providerLabel(env),
      models: GEMINI_MODEL_CHAIN,
      hintModels: modelChainStartingWith(GEMINI_MODELS.hint),
      mapsModels: modelChainStartingWith(GEMINI_MODELS.maps),
      generate: (model, body) => geminiGenerate(env, model, body),
    };
  }

  const baseUrl = (env.LLM_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const label = providerLabel(env);
  const models = Array.from(
    new Set(
      [env.LLM_MODEL?.trim() || DEFAULT_OPENAI_MODEL, env.LLM_MODEL_2?.trim()].filter(
        (model): model is string => Boolean(model)
      )
    )
  );
  return {
    kind: 'openai-compatible',
    label,
    models,
    hintModels: models,
    mapsModels: models,
    generate: async (model, body) => {
      const tools = (body as any)?.tools;
      if (Array.isArray(tools) && tools.length > 0) {
        const tool = tools.some((item: any) => item?.googleMaps)
          ? ('googleMaps' as const)
          : ('googleSearch' as const);
        throw new GroundingUnsupportedError(label, tool);
      }
      return openAiCompatibleGenerate(env, baseUrl, model, body);
    },
  };
}

// Both providers answer in the Gemini candidates shape, so one reader covers all
// endpoints.
export function readGeneratedText(data: any): string {
  return partsText(data?.candidates?.[0]?.content?.parts);
}
