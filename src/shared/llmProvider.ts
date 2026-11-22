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
  // Opt-in only: reasoning_effort is absent from requests unless this is set
  // (see reasoningEffortOption below).
  LLM_REASONING_EFFORT?: string;
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

// The same knobs under Gemini's camelCase name and the OpenAI-compatible one.
const SAMPLING_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['temperature', 'temperature'],
  ['topP', 'top_p'],
  ['topK', 'top_k'],
  ['candidateCount', 'n'],
  ['seed', 'seed'],
  ['presencePenalty', 'presence_penalty'],
  ['frequencyPenalty', 'frequency_penalty'],
];

// Optional knobs are not accepted by every OpenAI-compatible endpoint. A 400 that
// names one of them is about that knob, so it is dropped and the call retried
// once instead of failing the whole turn.
const OPTIONAL_PARAMS = [
  'reasoning_effort',
  'top_k',
  'n',
  'seed',
  'presence_penalty',
  'frequency_penalty',
  'stop',
];

type ReasoningEffort = 'low' | 'medium' | 'high';

// Gemini's thinking levels have no direct OpenAI equivalent; the closest knob is
// reasoning_effort. MINIMAL maps to low because Groq and others reject 'minimal'.
function reasoningEffort(level: unknown): ReasoningEffort | undefined {
  switch (String(level ?? '').toUpperCase()) {
    case 'MINIMAL':
    case 'LOW':
      return 'low';
    case 'MEDIUM':
      return 'medium';
    case 'HIGH':
      return 'high';
    default:
      return undefined;
  }
}

// reasoning_effort is opt-in, never derived automatically: not every
// OpenAI-compatible endpoint accepts it, and when an endpoint does accept it the
// supported levels are model-specific, so sending it by default turns a legal
// request into a 400 on those providers. LLM_REASONING_EFFORT selects the
// behaviour:
//   low | medium | high → send exactly that level
//   auto                → translate the request's thinkingConfig level
//   unset / off         → omit the field entirely (default)
function reasoningEffortOption(
  option: string | undefined,
  config: any
): ReasoningEffort | undefined {
  const value = String(option ?? '').trim().toLowerCase();
  if (value === 'auto') return reasoningEffort(config?.thinkingConfig?.thinkingLevel);
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

// Gemini request body → OpenAI-compatible chat/completions payload. Every field
// the handlers put in generationConfig has a counterpart here, so a caller can
// keep building one body shape regardless of the provider.
function toOpenAiPayload(
  model: string,
  body: any,
  effortOption?: string
): Record<string, unknown> {
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
  for (const [gemini, openai] of SAMPLING_FIELDS) {
    const value = config[gemini];
    if (typeof value === 'number') payload[openai] = value;
  }
  if (Array.isArray(config.stopSequences)) {
    const stop = config.stopSequences.filter((item: unknown) => typeof item === 'string');
    if (stop.length > 0) payload.stop = stop;
  }
  const effort = reasoningEffortOption(effortOption, config);
  if (effort) payload.reasoning_effort = effort;
  return payload;
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

  const payload = toOpenAiPayload(model, body, env.LLM_REASONING_EFFORT);

  return withApiKeyFallback(keys, async (key) => {
    const send = (current: Record<string, unknown>) =>
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(current),
      });

    let response = await send(payload);
    let data = (await response.json().catch(() => ({}))) as any;
    if (response.status === 400) {
      const detail = String(data?.error?.message || data?.message || '');
      const rejected = OPTIONAL_PARAMS.find(
        (param) => param in payload && new RegExp(`\\b${param}\\b`, 'i').test(detail)
      );
      if (rejected) {
        console.warn(`[llm] ${baseUrl} ไม่รับ ${rejected} — ลองใหม่โดยไม่ส่งค่านี้`);
        const retryPayload = { ...payload };
        delete retryPayload[rejected];
        response = await send(retryPayload);
        data = (await response.json().catch(() => ({}))) as any;
      }
    }
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
