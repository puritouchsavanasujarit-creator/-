import {
  CHAT_TURN_SCHEMA,
  EVALUATION_SCHEMA,
  GEMINI_MODEL_CHAIN,
  GEMINI_MODELS,
  HINT_SCHEMA,
  CHAT_MODEL_TIMEOUT_MS,
  DEGRADED_MODEL_TIMEOUT_MS,
  MENTOR_MODEL_TIMEOUT_MS,
  geminiApiKeys,
  withApiKeyFallback,
  MODEL_TIMEOUT_MS,
  THINKING_LEVELS,
  buildChatTurnPrompt,
  buildEvaluationPrompt,
  buildHintPrompt,
  buildMapsPrompt,
  buildMapsToolConfig,
  buildMentorHistory,
  EXA_FALLBACK_NOTICE,
  buildMentorSystemInstruction,
  buildSearchSystemInstruction,
  extractMapPlaces,
  extractWebSources,
  findScenario,
  formatGeminiError,
  groundingFallback,
  modelChainStartingWith,
  parseGeminiJson,
  QUICK_MODEL_TIMEOUT_MS,
  withModelFallback,
} from './src/shared/geminiPrompts.ts';
import type { ChatMessageInput, MentorHistoryItem } from './src/shared/geminiPrompts.ts';
import { searchWeb, searchWebSources } from './src/shared/exaSearch.ts';
import { TRAINING_SCENARIOS } from './src/data/playbookData.ts';
import { BUILD_ID } from './src/shared/buildStamp.ts';

interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  EXA_API_KEY?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function generate(env: Env, model: string, body: unknown): Promise<any> {
  const keys = geminiApiKeys(env.GEMINI_API_KEY, env.GEMINI_API_KEY_2);
  if (keys.length === 0) {
    throw new Error('ไม่พบ GEMINI_API_KEY ในระบบ กรุณาตรวจสอบการตั้งค่า Secrets');
  }
  // An exhausted key says nothing about the model: retry the same request on the
  // backup key before letting the model count as failed.
  return withApiKeyFallback(keys, async (key) => {
    const response = await fetch(`${API_BASE}/${model}:generateContent`, {
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
      const error = new Error(
        `${message}${status}${response.status === 429 ? ' RESOURCE_EXHAUSTED' : ''}`
      );
      // The rotation check reads this, so a 429 stays recognisable off the wire.
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return data;
  });
}

function readText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

async function handleChatTurn(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { scenarioId, messages, currentStage } = (await request.json()) as {
      scenarioId: string;
      messages: ChatMessageInput[];
      currentStage?: number;
    };

    const scenario = findScenario(scenarioId);
    if (!scenario) return json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' }, 400);
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'กรุณาส่งข้อความบทสนทนา' }, 400);
    }
    if (!messages.some((m) => m.role === 'admin')) {
      return json({ error: 'ไม่พบข้อความตอบกลับของแอดมิน' }, 400);
    }

    const body = {
      contents: [{ role: 'user', parts: [{ text: buildChatTurnPrompt(scenario, messages, currentStage) }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.chat },
        responseMimeType: 'application/json',
        responseSchema: CHAT_TURN_SCHEMA,
      },
    };
    const modelStartedAt = Date.now();
    const data = await withModelFallback(
      GEMINI_MODEL_CHAIN,
      (model) => generate(env, model, body),
      CHAT_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'chat/turn'
    );
    console.log(
      `[chat/turn] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
    );

    return json(parseGeminiJson(readText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleChatHint(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { scenarioId, messages, currentStage } = (await request.json()) as {
      scenarioId: string;
      messages: ChatMessageInput[];
      currentStage?: number;
    };

    const scenario = findScenario(scenarioId);
    if (!scenario) return json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' }, 400);

    const modelStartedAt = Date.now();
    const data = await withModelFallback(modelChainStartingWith(GEMINI_MODELS.hint), (model) =>
      generate(env, model, {
        contents: [{ role: 'user', parts: [{ text: buildHintPrompt(scenario, messages, currentStage) }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: THINKING_LEVELS.hint },
          responseMimeType: 'application/json',
          responseSchema: HINT_SCHEMA,
        },
      }),
      QUICK_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'chat/hint'
    );
    console.log(
      `[chat/hint] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
    );

    return json(parseGeminiJson(readText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleEvaluate(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { scenarioId, messages } = (await request.json()) as {
      scenarioId: string;
      messages: ChatMessageInput[];
    };

    const scenario = findScenario(scenarioId);
    if (!scenario) return json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' }, 400);

    const body = {
      contents: [{ role: 'user', parts: [{ text: buildEvaluationPrompt(scenario, messages) }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.evaluation },
        responseMimeType: 'application/json',
        responseSchema: EVALUATION_SCHEMA,
      },
    };
    const modelStartedAt = Date.now();
    const data = await withModelFallback(
      GEMINI_MODEL_CHAIN,
      (model) => generate(env, model, body),
      QUICK_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'chat/evaluate'
    );
    console.log(
      `[chat/evaluate] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
    );

    return json(parseGeminiJson(readText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleMentorChat(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { history, message, scenarioId } = (await request.json()) as {
      history?: MentorHistoryItem[];
      message: string;
      scenarioId?: string;
    };

    if (!message || !message.trim()) {
      return json({ error: 'กรุณากรอกคำถามถึงโค้ช AI' }, 400);
    }

    const scenario = scenarioId ? findScenario(scenarioId) : undefined;
    const contents = [
      ...buildMentorHistory(history),
      { role: 'user' as const, parts: [{ text: message.trim() }] },
    ];

    const body = {
      contents,
      systemInstruction: { parts: [{ text: buildMentorSystemInstruction(scenario) }] },
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.mentor },
      },
    };
    const modelStartedAt = Date.now();
    const data = await withModelFallback(
      GEMINI_MODEL_CHAIN,
      (model) => generate(env, model, body),
      MENTOR_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'mentor/chat'
    );
    console.log(
      `[mentor/chat] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
    );

    return json({ reply: readText(data) });
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleToolsSearch(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { query } = (await request.json()) as { query: string };
    if (!query || !query.trim()) {
      return json({ error: 'กรุณาระบุคำค้นหา' }, 400);
    }

    const body = {
      contents: [{ role: 'user', parts: [{ text: query.trim() }] }],
      systemInstruction: { parts: [{ text: buildSearchSystemInstruction() }] },
      generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVELS.search } },
    };

    const groundedStartedAt = Date.now();
    try {
      const data = await withModelFallback(
        GEMINI_MODEL_CHAIN,
        (model) => generate(env, model, { ...body, tools: [{ googleSearch: {} }] }),
        QUICK_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'search'
      );
      console.log(
        `[search] grounding=200 grounded_ms=${
          Date.now() - groundedStartedAt
        } total_ms=${Date.now() - startedAt}`
      );

      return json({
        answerMarkdown: readText(data),
        sources: extractWebSources(data?.candidates),
        grounded: true,
      });
    } catch (groundingError) {
      // Grounding quota is exhausted: answer from model knowledge and attach
      // backup reference links from Exa when it is configured.
      const fallback = groundingFallback('search', groundingError);
      const fallbackStartedAt = Date.now();
      const [data, sources] = await Promise.all([
        withModelFallback(
          GEMINI_MODEL_CHAIN,
          (model) => generate(env, model, body),
          DEGRADED_MODEL_TIMEOUT_MS,
          MODEL_TIMEOUT_MS,
          'search'
        ),
        searchWebSources(query.trim(), env.EXA_API_KEY),
      ]);

      // Where the fallback time goes, so a slow phase is visible in the logs.
      console.log(
        `[search] grounding=${fallback.groundingStatus} grounded_ms=${
          fallbackStartedAt - groundedStartedAt
        } fallback_ms=${Date.now() - fallbackStartedAt} total_ms=${Date.now() - startedAt}`
      );

      return json({
        answerMarkdown: readText(data),
        sources,
        ...fallback,
        ...(sources.length > 0 ? { notice: EXA_FALLBACK_NOTICE } : {}),
      });
    }
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleToolsWebSearch(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { query, numResults } = (await request.json()) as {
      query: string;
      numResults?: number;
    };
    if (!query || !query.trim()) {
      return json({ error: 'กรุณาระบุคำค้นหา' }, 400);
    }

    const result = await searchWeb(query, numResults, env.EXA_API_KEY);
    console.log(`[web-search] total_ms=${Date.now() - startedAt}`);
    return json(result);
  } catch (error) {
    console.log(`[web-search] failed total_ms=${Date.now() - startedAt} error=${String(error)}`);
    return json(
      { error: error instanceof Error ? error.message : 'ไม่สามารถค้นหาเว็บด้วย Exa ได้' },
      500
    );
  }
}

async function handleToolsMaps(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { query, latLng } = (await request.json()) as {
      query: string;
      latLng?: { latitude: number; longitude: number };
    };
    if (!query || !query.trim()) {
      return json({ error: 'กรุณาระบุชื่อสถานที่ โรงพยาบาล หรือจุดจัดส่ง' }, 400);
    }

    const body = { contents: [{ role: 'user', parts: [{ text: buildMapsPrompt(query.trim()) }] }] };
    const chain = modelChainStartingWith(GEMINI_MODELS.maps);

    const groundedStartedAt = Date.now();
    try {
      const data = await withModelFallback(chain, (model) =>
        generate(env, model, {
          ...body,
          tools: [{ googleMaps: {} }],
          ...buildMapsToolConfig(latLng),
        }),
        QUICK_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'maps'
      );
      console.log(
        `[maps] grounding=200 grounded_ms=${
          Date.now() - groundedStartedAt
        } total_ms=${Date.now() - startedAt}`
      );

      return json({
        answerMarkdown: readText(data),
        places: extractMapPlaces(data?.candidates),
        grounded: true,
      });
    } catch (groundingError) {
      // Maps quota is exhausted: answer without live place data.
      const fallback = groundingFallback('maps', groundingError);
      const fallbackStartedAt = Date.now();
      const data = await withModelFallback(
        chain,
        (model) => generate(env, model, body),
        DEGRADED_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'maps'
      );
      console.log(
        `[maps] grounding=${fallback.groundingStatus} grounded_ms=${
          fallbackStartedAt - groundedStartedAt
        } fallback_ms=${Date.now() - fallbackStartedAt} total_ms=${Date.now() - startedAt}`
      );

      return json({ answerMarkdown: readText(data), places: [], ...fallback });
    }
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        buildId: BUILD_ID,
        scenarioIds: TRAINING_SCENARIOS.map((scenario) => scenario.id),
        geminiApiKeyConfigured: Boolean(env.GEMINI_API_KEY),
        geminiApiKey2Configured: Boolean(env.GEMINI_API_KEY_2),
        exaApiKeyConfigured: Boolean(env.EXA_API_KEY),
      });
    }

    if (request.method === 'POST') {
      switch (url.pathname) {
        case '/api/chat/turn':
          return handleChatTurn(request, env);
        case '/api/chat/hint':
          return handleChatHint(request, env);
        case '/api/chat/evaluate':
          return handleEvaluate(request, env);
        case '/api/mentor/chat':
          return handleMentorChat(request, env);
        case '/api/tools/search':
          return handleToolsSearch(request, env);
        case '/api/tools/web-search':
          return handleToolsWebSearch(request, env);
        case '/api/tools/maps':
          return handleToolsMaps(request, env);
        default:
          break;
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'ไม่พบ API ที่ระบุ' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
