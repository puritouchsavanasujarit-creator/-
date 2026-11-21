import {
  CHAT_TURN_SCHEMA,
  EVALUATION_SCHEMA,
  HINT_SCHEMA,
  CHAT_MODEL_TIMEOUT_MS,
  DEGRADED_MODEL_TIMEOUT_MS,
  MENTOR_MODEL_TIMEOUT_MS,
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
  parseGeminiJson,
  QUICK_MODEL_TIMEOUT_MS,
  withModelFallback,
} from './src/shared/geminiPrompts.ts';
import type {
  ChatMessageInput,
  ChatPerspective,
  MentorHistoryItem,
} from './src/shared/geminiPrompts.ts';
import { readGeneratedText, selectLlmProvider } from './src/shared/llmProvider.ts';
import { searchWeb, searchWebSources } from './src/shared/exaSearch.ts';
import { TRAINING_SCENARIOS } from './src/data/playbookData.ts';
import { BUILD_ID } from './src/shared/buildStamp.ts';

interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_2?: string;
  LLM_API_KEY?: string;
  LLM_API_KEY_2?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_MODEL_2?: string;
  EXA_API_KEY?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleChatTurn(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { scenarioId, messages, currentStage, perspective } = (await request.json()) as {
      scenarioId: string;
      messages: ChatMessageInput[];
      currentStage?: number;
      perspective?: ChatPerspective;
    };

    const scenario = findScenario(scenarioId);
    if (!scenario) return json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' }, 400);
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'กรุณาส่งข้อความบทสนทนา' }, 400);
    }
    const traineeRole = perspective === 'buyer' ? 'customer' : 'admin';
    if (!messages.some((m) => m.role === traineeRole)) {
      return json(
        {
          error:
            perspective === 'buyer'
              ? 'ไม่พบข้อความของฝ่ายซื้อ'
              : 'ไม่พบข้อความตอบกลับของแอดมิน',
        },
        400
      );
    }

    const provider = selectLlmProvider(env);
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: buildChatTurnPrompt(scenario, messages, currentStage, perspective) }],
        },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.chat },
        responseMimeType: 'application/json',
        responseSchema: CHAT_TURN_SCHEMA,
      },
    };
    const modelStartedAt = Date.now();
    const data = await withModelFallback(
      provider.models,
      (model) => provider.generate(model, body),
      CHAT_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'chat/turn'
    );
    console.log(
      `[chat/turn] provider=${provider.kind} model_ms=${Date.now() - modelStartedAt} total_ms=${
        Date.now() - startedAt
      }`
    );

    return json(parseGeminiJson(readGeneratedText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleChatHint(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { scenarioId, messages, currentStage, perspective } = (await request.json()) as {
      scenarioId: string;
      messages: ChatMessageInput[];
      currentStage?: number;
      perspective?: ChatPerspective;
    };

    const scenario = findScenario(scenarioId);
    if (!scenario) return json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' }, 400);

    const provider = selectLlmProvider(env);
    const modelStartedAt = Date.now();
    const data = await withModelFallback(
      provider.hintModels,
      (model) =>
        provider.generate(model, {
          contents: [
            {
              role: 'user',
              parts: [
                { text: buildHintPrompt(scenario, messages, currentStage, perspective) },
              ],
            },
          ],
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

    return json(parseGeminiJson(readGeneratedText(data)));
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

    const provider = selectLlmProvider(env);
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
      provider.models,
      (model) => provider.generate(model, body),
      QUICK_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'chat/evaluate'
    );
    console.log(
      `[chat/evaluate] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
    );

    return json(parseGeminiJson(readGeneratedText(data)));
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

    const provider = selectLlmProvider(env);
    const body = {
      contents,
      systemInstruction: { parts: [{ text: buildMentorSystemInstruction(scenario) }] },
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.mentor },
      },
    };
    const modelStartedAt = Date.now();
    const data = await withModelFallback(
      provider.models,
      (model) => provider.generate(model, body),
      MENTOR_MODEL_TIMEOUT_MS,
      MODEL_TIMEOUT_MS,
      'mentor/chat'
    );
    console.log(
      `[mentor/chat] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
    );

    return json({ reply: readGeneratedText(data) });
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

    const provider = selectLlmProvider(env);
    const body = {
      contents: [{ role: 'user', parts: [{ text: query.trim() }] }],
      systemInstruction: { parts: [{ text: buildSearchSystemInstruction() }] },
      generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVELS.search } },
    };

    const groundedStartedAt = Date.now();
    try {
      const data = await withModelFallback(
        provider.models,
        (model) => provider.generate(model, { ...body, tools: [{ googleSearch: {} }] }),
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
        answerMarkdown: readGeneratedText(data),
        sources: extractWebSources(data?.candidates),
        grounded: true,
      });
    } catch (groundingError) {
      // Grounding quota is exhausted (or the provider has no Google Search):
      // answer from model knowledge and attach backup links from Exa when it is
      // configured.
      const fallback = groundingFallback('search', groundingError);
      const fallbackStartedAt = Date.now();
      const [data, sources] = await Promise.all([
        withModelFallback(
          provider.models,
          (model) => provider.generate(model, body),
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
        answerMarkdown: readGeneratedText(data),
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

    const provider = selectLlmProvider(env);
    const body = { contents: [{ role: 'user', parts: [{ text: buildMapsPrompt(query.trim()) }] }] };

    const groundedStartedAt = Date.now();
    try {
      const data = await withModelFallback(
        provider.mapsModels,
        (model) =>
          provider.generate(model, {
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
        answerMarkdown: readGeneratedText(data),
        places: extractMapPlaces(data?.candidates),
        grounded: true,
      });
    } catch (groundingError) {
      // Maps quota is exhausted (or unavailable on this provider): answer
      // without live place data.
      const fallback = groundingFallback('maps', groundingError);
      const fallbackStartedAt = Date.now();
      const data = await withModelFallback(
        provider.mapsModels,
        (model) => provider.generate(model, body),
        DEGRADED_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'maps'
      );
      console.log(
        `[maps] grounding=${fallback.groundingStatus} grounded_ms=${
          fallbackStartedAt - groundedStartedAt
        } fallback_ms=${Date.now() - fallbackStartedAt} total_ms=${Date.now() - startedAt}`
      );

      return json({ answerMarkdown: readGeneratedText(data), places: [], ...fallback });
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
        llmProvider: selectLlmProvider(env).label,
        llmApiKeyConfigured: Boolean(env.LLM_API_KEY),
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
