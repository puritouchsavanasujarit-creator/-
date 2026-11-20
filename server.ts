import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
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
  CHAT_MODEL_TIMEOUT_MS,
  DEGRADED_MODEL_TIMEOUT_MS,
  geminiApiKeys,
  withApiKeyFallback,
  MENTOR_MODEL_TIMEOUT_MS,
  MODEL_TIMEOUT_MS,
  QUICK_MODEL_TIMEOUT_MS,
  withModelFallback,
} from './src/shared/geminiPrompts.ts';
import type {
  ChatMessageInput,
  MentorHistoryItem,
  ThinkingName,
} from './src/shared/geminiPrompts.ts';
import { isExaConfigured, searchWeb, searchWebSources } from './src/shared/exaSearch.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const eqPrefix = `${flag}=`;
  const eqArg = process.argv.find((arg) => arg.startsWith(eqPrefix));
  return eqArg ? eqArg.slice(eqPrefix.length) : undefined;
}

const cliPort = Number(getArgValue('--port'));
const envPort =
  process.env.PORT && process.env.PORT !== process.env.NGINX_PORT
    ? Number(process.env.PORT)
    : Number(process.env.DEFAULT_APP_PORT) || 3000;
const PORT = Number.isFinite(cliPort) && cliPort > 0 ? cliPort : envPort || 3000;
const HOST = getArgValue('--host') || '0.0.0.0';

const THINKING_TO_SDK: Record<ThinkingName, ThinkingLevel> = {
  LOW: ThinkingLevel.LOW,
  MEDIUM: ThinkingLevel.MEDIUM,
  MINIMAL: ThinkingLevel.MINIMAL,
};

function getAiClients(): GoogleGenAI[] {
  const keys = geminiApiKeys(process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2);
  if (keys.length === 0) {
    throw new Error('ไม่พบ GEMINI_API_KEY ในระบบ กรุณาตรวจสอบการตั้งค่า Secrets');
  }
  return keys.map(
    (apiKey) =>
      new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
  );
}

// The same client surface the handlers already use, except an exhausted key
// falls through to the backup key before the call is allowed to fail.
function getAiClient(): GoogleGenAI {
  const clients = getAiClients();
  if (clients.length === 1) return clients[0];
  return {
    models: {
      generateContent: (params: any) =>
        withApiKeyFallback(clients.length, (index) =>
          clients[index].models.generateContent(params)
        ),
    },
    chats: {
      create: (params: any) => ({
        sendMessage: (message: any) =>
          withApiKeyFallback(clients.length, (index) =>
            clients[index].chats.create(params).sendMessage(message)
          ),
      }),
    },
  } as unknown as GoogleGenAI;
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiApiKey2Configured: Boolean(process.env.GEMINI_API_KEY_2),
      exaApiKeyConfigured: isExaConfigured(),
    });
  });

  app.post('/api/chat/turn', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { scenarioId, messages, currentStage } = req.body as {
        scenarioId: string;
        messages: ChatMessageInput[];
        currentStage?: number;
      };

      const scenario = findScenario(scenarioId);
      if (!scenario) {
        res.status(400).json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' });
        return;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'กรุณาส่งข้อความบทสนทนา' });
        return;
      }

      const lastAdminMessage = [...messages].reverse().find((m) => m.role === 'admin');
      if (!lastAdminMessage) {
        res.status(400).json({ error: 'ไม่พบข้อความตอบกลับของแอดมิน' });
        return;
      }

      const ai = getAiClient();
      const contents = buildChatTurnPrompt(scenario, messages, currentStage);
      const modelStartedAt = Date.now();
      const response = await withModelFallback(
        GEMINI_MODEL_CHAIN,
        (model) =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              thinkingConfig: { thinkingLevel: THINKING_TO_SDK[THINKING_LEVELS.chat] },
              responseMimeType: 'application/json',
              responseSchema: CHAT_TURN_SCHEMA as any,
            },
          }),
        CHAT_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'chat/turn'
      );
      console.log(
        `[chat/turn] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
      );

      res.json(parseGeminiJson(response.text));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/chat/hint', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { scenarioId, messages, currentStage } = req.body as {
        scenarioId: string;
        messages: ChatMessageInput[];
        currentStage?: number;
      };

      const scenario = findScenario(scenarioId);
      if (!scenario) {
        res.status(400).json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' });
        return;
      }

      const ai = getAiClient();
      const modelStartedAt = Date.now();
      const response = await withModelFallback(
        modelChainStartingWith(GEMINI_MODELS.hint),
        (model) =>
          ai.models.generateContent({
            model,
            contents: buildHintPrompt(scenario, messages, currentStage),
            config: {
              thinkingConfig: { thinkingLevel: THINKING_TO_SDK[THINKING_LEVELS.hint] },
              responseMimeType: 'application/json',
              responseSchema: HINT_SCHEMA as any,
            },
          }),
        QUICK_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'chat/hint'
      );
      console.log(
        `[chat/hint] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
      );

      res.json(parseGeminiJson(response.text));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/chat/evaluate', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { scenarioId, messages } = req.body as {
        scenarioId: string;
        messages: ChatMessageInput[];
      };

      const scenario = findScenario(scenarioId);
      if (!scenario) {
        res.status(400).json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' });
        return;
      }

      const ai = getAiClient();
      const contents = buildEvaluationPrompt(scenario, messages);
      const modelStartedAt = Date.now();
      const response = await withModelFallback(
        GEMINI_MODEL_CHAIN,
        (model) =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              thinkingConfig: { thinkingLevel: THINKING_TO_SDK[THINKING_LEVELS.evaluation] },
              responseMimeType: 'application/json',
              responseSchema: EVALUATION_SCHEMA as any,
            },
          }),
        QUICK_MODEL_TIMEOUT_MS,
        MODEL_TIMEOUT_MS,
        'chat/evaluate'
      );
      console.log(
        `[chat/evaluate] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
      );

      res.json(parseGeminiJson(response.text));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Multi-turn Mentor Chatbot (maintains conversation history + systemInstruction)
  app.post('/api/mentor/chat', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { history, message, scenarioId } = req.body as {
        history?: MentorHistoryItem[];
        message: string;
        scenarioId?: string;
      };

      if (!message || !message.trim()) {
        res.status(400).json({ error: 'กรุณากรอกคำถามถึงโค้ช AI' });
        return;
      }

      const ai = getAiClient();
      const scenario = scenarioId ? findScenario(scenarioId) : undefined;

      const formattedHistory = buildMentorHistory(history);

      const modelStartedAt = Date.now();
      const response = await withModelFallback(GEMINI_MODEL_CHAIN, (model) => {
        const chat = ai.chats.create({
          model,
          history: formattedHistory,
          config: {
            systemInstruction: buildMentorSystemInstruction(scenario),
            thinkingConfig: { thinkingLevel: THINKING_TO_SDK[THINKING_LEVELS.mentor] },
          },
        });
        return chat.sendMessage({ message: message.trim() });
      }, MENTOR_MODEL_TIMEOUT_MS, MODEL_TIMEOUT_MS, 'mentor/chat');
      console.log(
        `[mentor/chat] model_ms=${Date.now() - modelStartedAt} total_ms=${Date.now() - startedAt}`
      );
      res.json({ reply: response.text ?? '' });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Google Search Grounding for live fruit seasonality, etiquette, hospital delivery info
  app.post('/api/tools/search', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { query } = req.body as { query: string };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
        return;
      }

      const ai = getAiClient();
      const groundedStartedAt = Date.now();
      try {
        const response = await withModelFallback(
          GEMINI_MODEL_CHAIN,
          (model) =>
            ai.models.generateContent({
              model,
              contents: query.trim(),
              config: {
                systemInstruction: buildSearchSystemInstruction(),
                thinkingConfig: { thinkingLevel: THINKING_TO_SDK[THINKING_LEVELS.search] },
                tools: [{ googleSearch: {} }],
              },
            }),
          QUICK_MODEL_TIMEOUT_MS,
          MODEL_TIMEOUT_MS,
          'search'
        );
        console.log(
          `[search] grounding=200 grounded_ms=${
            Date.now() - groundedStartedAt
          } total_ms=${Date.now() - startedAt}`
        );

        res.json({
          answerMarkdown: response.text ?? '',
          sources: extractWebSources(response.candidates),
          grounded: true,
        });
        return;
      } catch (groundingError) {
        // Grounding quota is exhausted: answer without live sources and attach
        // backup reference links from Exa when it is configured.
        const fallback = groundingFallback('search', groundingError);
        const fallbackStartedAt = Date.now();
        const [response, sources] = await Promise.all([
          withModelFallback(
            GEMINI_MODEL_CHAIN,
            (model) =>
              ai.models.generateContent({
                model,
                contents: query.trim(),
                config: {
                  systemInstruction: buildSearchSystemInstruction(),
                  thinkingConfig: { thinkingLevel: THINKING_TO_SDK[THINKING_LEVELS.search] },
                },
              }),
            DEGRADED_MODEL_TIMEOUT_MS,
            MODEL_TIMEOUT_MS,
            'search'
          ),
          searchWebSources(query.trim()),
        ]);

        // Where the fallback time goes, so a slow phase is visible in the logs.
        console.log(
          `[search] grounding=${fallback.groundingStatus} grounded_ms=${
            fallbackStartedAt - groundedStartedAt
          } fallback_ms=${Date.now() - fallbackStartedAt} total_ms=${Date.now() - startedAt}`
        );

        res.json({
          answerMarkdown: response.text ?? '',
          sources,
          ...fallback,
          ...(sources.length > 0 ? { notice: EXA_FALLBACK_NOTICE } : {}),
        });
        return;
      }
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Exa web search: returns ranked web pages with highlights for the app/agent
  app.post('/api/tools/web-search', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { query, numResults } = req.body as { query: string; numResults?: number };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
        return;
      }

      const result = await searchWeb(query, numResults);
      console.log(`[web-search] total_ms=${Date.now() - startedAt}`);
      res.json(result);
    } catch (error) {
      console.log(`[web-search] failed total_ms=${Date.now() - startedAt} error=${String(error)}`);
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'ไม่สามารถค้นหาเว็บด้วย Exa ได้' });
    }
  });

  // Google Maps Grounding for checking delivery locations, hospitals, and routes
  app.post('/api/tools/maps', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { query, latLng } = req.body as {
        query: string;
        latLng?: { latitude: number; longitude: number };
      };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'กรุณาระบุชื่อสถานที่ โรงพยาบาล หรือจุดจัดส่ง' });
        return;
      }

      const ai = getAiClient();
      const chain = modelChainStartingWith(GEMINI_MODELS.maps);
      const contents = buildMapsPrompt(query.trim());

      const groundedStartedAt = Date.now();
      try {
        const response = await withModelFallback(chain, (model) =>
          ai.models.generateContent({
            model,
            contents,
            config: { tools: [{ googleMaps: {} }], ...buildMapsToolConfig(latLng) },
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

        res.json({
          answerMarkdown: response.text ?? '',
          places: extractMapPlaces(response.candidates),
          grounded: true,
        });
        return;
      } catch (groundingError) {
        // Maps quota is exhausted: answer without live place data.
        const fallback = groundingFallback('maps', groundingError);
        const fallbackStartedAt = Date.now();
        const response = await withModelFallback(
          chain,
          (model) => ai.models.generateContent({ model, contents }),
          DEGRADED_MODEL_TIMEOUT_MS,
          MODEL_TIMEOUT_MS,
          'maps'
        );
        console.log(
          `[maps] grounding=${fallback.groundingStatus} grounded_ms=${
            fallbackStartedAt - groundedStartedAt
          } fallback_ms=${Date.now() - fallbackStartedAt} total_ms=${Date.now() - startedAt}`
        );

        res.json({ answerMarkdown: response.text ?? '', places: [], ...fallback });
        return;
      }
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });

  server.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

createApp().catch((err) => {
  console.error('Unhandled error during server startup:', err);
  process.exit(1);
});
