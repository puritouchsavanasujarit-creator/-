import {
  CHAT_TURN_SCHEMA,
  EVALUATION_SCHEMA,
  GEMINI_MODEL_CHAIN,
  GEMINI_MODELS,
  HINT_SCHEMA,
  THINKING_LEVELS,
  buildChatTurnPrompt,
  buildEvaluationPrompt,
  buildHintPrompt,
  buildMapsPrompt,
  buildMentorHistory,
  buildMentorSystemInstruction,
  buildSearchSystemInstruction,
  extractMapPlaces,
  extractWebSources,
  findScenario,
  formatGeminiError,
  parseGeminiJson,
  withModelFallback,
} from './src/shared/geminiPrompts.ts';
import type { ChatMessageInput, MentorHistoryItem } from './src/shared/geminiPrompts.ts';

interface Env {
  GEMINI_API_KEY?: string;
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
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('ไม่พบ GEMINI_API_KEY ในระบบ กรุณาตรวจสอบการตั้งค่า Secrets');
  }
  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const message = data?.error?.message || `Gemini API error ${response.status}`;
    const status = data?.error?.status ? ` ${data.error.status}` : '';
    throw new Error(`${message}${status}${response.status === 429 ? ' RESOURCE_EXHAUSTED' : ''}`);
  }
  return data;
}

function readText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

async function handleChatTurn(request: Request, env: Env): Promise<Response> {
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
    const data = await withModelFallback(GEMINI_MODEL_CHAIN, (model) =>
      generate(env, model, body)
    );

    return json(parseGeminiJson(readText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleChatHint(request: Request, env: Env): Promise<Response> {
  try {
    const { scenarioId, messages, currentStage } = (await request.json()) as {
      scenarioId: string;
      messages: ChatMessageInput[];
      currentStage?: number;
    };

    const scenario = findScenario(scenarioId);
    if (!scenario) return json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' }, 400);

    const data = await generate(env, GEMINI_MODELS.hint, {
      contents: [{ role: 'user', parts: [{ text: buildHintPrompt(scenario, messages, currentStage) }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.hint },
        responseMimeType: 'application/json',
        responseSchema: HINT_SCHEMA,
      },
    });

    return json(parseGeminiJson(readText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleEvaluate(request: Request, env: Env): Promise<Response> {
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
    const data = await withModelFallback(GEMINI_MODEL_CHAIN, (model) =>
      generate(env, model, body)
    );

    return json(parseGeminiJson(readText(data)));
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleMentorChat(request: Request, env: Env): Promise<Response> {
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
    const data = await withModelFallback(GEMINI_MODEL_CHAIN, (model) =>
      generate(env, model, body)
    );

    return json({ reply: readText(data) });
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleToolsSearch(request: Request, env: Env): Promise<Response> {
  try {
    const { query } = (await request.json()) as { query: string };
    if (!query || !query.trim()) {
      return json({ error: 'กรุณาระบุคำค้นหา' }, 400);
    }

    const body = {
      contents: [{ role: 'user', parts: [{ text: query.trim() }] }],
      systemInstruction: { parts: [{ text: buildSearchSystemInstruction() }] },
      tools: [{ googleSearch: {} }],
    };
    const data = await withModelFallback(GEMINI_MODEL_CHAIN, (model) =>
      generate(env, model, body)
    );

    return json({
      answerMarkdown: readText(data),
      sources: extractWebSources(data?.candidates),
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

async function handleToolsMaps(request: Request, env: Env): Promise<Response> {
  try {
    const { query, latLng } = (await request.json()) as {
      query: string;
      latLng?: { latitude: number; longitude: number };
    };
    if (!query || !query.trim()) {
      return json({ error: 'กรุณาระบุชื่อสถานที่ โรงพยาบาล หรือจุดจัดส่ง' }, 400);
    }

    const data = await generate(env, GEMINI_MODELS.maps, {
      contents: [{ role: 'user', parts: [{ text: buildMapsPrompt(query.trim()) }] }],
      tools: [{ googleMaps: {} }],
      ...(latLng
        ? {
            toolConfig: {
              retrievalConfig: {
                latLng: {
                  latitude: latLng.latitude,
                  longitude: latLng.longitude,
                },
              },
            },
          }
        : {}),
    });

    return json({
      answerMarkdown: readText(data),
      places: extractMapPlaces(data?.candidates),
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    return json({ error: formatted.message }, formatted.status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, geminiApiKeyConfigured: Boolean(env.GEMINI_API_KEY) });
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
