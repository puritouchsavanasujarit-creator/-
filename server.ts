import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CHAT_TURN_SCHEMA,
  EVALUATION_SCHEMA,
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
  parseGeminiJson,
  CHAT_MODEL_TIMEOUT_MS,
  DEGRADED_MODEL_TIMEOUT_MS,
  MENTOR_MODEL_TIMEOUT_MS,
  MODEL_TIMEOUT_MS,
  QUICK_MODEL_TIMEOUT_MS,
  withModelFallback,
} from './src/shared/geminiPrompts.ts';
import type {
  ChatMessageInput,
  ChatPerspective,
  MentorHistoryItem,
} from './src/shared/geminiPrompts.ts';
import { readGeneratedText, selectLlmProvider, type LlmEnv } from './src/shared/llmProvider.ts';
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

// The dev server reads the same provider configuration as the deployed worker.
const llmEnv: LlmEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_API_KEY_2: process.env.GEMINI_API_KEY_2,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_API_KEY_2: process.env.LLM_API_KEY_2,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_MODEL_2: process.env.LLM_MODEL_2,
};

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      llmProvider: selectLlmProvider(llmEnv).label,
      llmApiKeyConfigured: Boolean(process.env.LLM_API_KEY),
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiApiKey2Configured: Boolean(process.env.GEMINI_API_KEY_2),
      exaApiKeyConfigured: isExaConfigured(),
    });
  });

  app.post('/api/chat/turn', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { scenarioId, messages, currentStage, perspective } = req.body as {
        scenarioId: string;
        messages: ChatMessageInput[];
        currentStage?: number;
        perspective?: ChatPerspective;
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

      const traineeRole = perspective === 'buyer' ? 'customer' : 'admin';
      const lastTraineeMessage = [...messages].reverse().find((m) => m.role === traineeRole);
      if (!lastTraineeMessage) {
        res.status(400).json({
          error:
            perspective === 'buyer'
              ? 'ไม่พบข้อความของฝ่ายซื้อ'
              : 'ไม่พบข้อความตอบกลับของแอดมิน',
        });
        return;
      }

      const provider = selectLlmProvider(llmEnv);
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
        `[chat/turn] provider=${provider.kind} model_ms=${
          Date.now() - modelStartedAt
        } total_ms=${Date.now() - startedAt}`
      );

      res.json(parseGeminiJson(readGeneratedText(data)));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/chat/hint', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { scenarioId, messages, currentStage, perspective } = req.body as {
        scenarioId: string;
        messages: ChatMessageInput[];
        currentStage?: number;
        perspective?: ChatPerspective;
      };

      const scenario = findScenario(scenarioId);
      if (!scenario) {
        res.status(400).json({ error: 'ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ' });
        return;
      }

      const provider = selectLlmProvider(llmEnv);
      const modelStartedAt = Date.now();
      const data = await withModelFallback(
        provider.hintModels,
        (model) =>
          provider.generate(model, {
            contents: [
              {
                role: 'user',
                parts: [{ text: buildHintPrompt(scenario, messages, currentStage, perspective) }],
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

      res.json(parseGeminiJson(readGeneratedText(data)));
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

      const provider = selectLlmProvider(llmEnv);
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
        `[chat/evaluate] model_ms=${Date.now() - modelStartedAt} total_ms=${
          Date.now() - startedAt
        }`
      );

      res.json(parseGeminiJson(readGeneratedText(data)));
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

      const scenario = scenarioId ? findScenario(scenarioId) : undefined;
      const contents = [
        ...buildMentorHistory(history),
        { role: 'user' as const, parts: [{ text: message.trim() }] },
      ];

      const provider = selectLlmProvider(llmEnv);
      const body = {
        contents,
        systemInstruction: { parts: [{ text: buildMentorSystemInstruction(scenario) }] },
        generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVELS.mentor } },
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
      res.json({ reply: readGeneratedText(data) });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Live search: Google Search grounding on Gemini; on another provider the
  // answer comes from model knowledge with Exa reference links when configured.
  app.post('/api/tools/search', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { query } = req.body as { query: string };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
        return;
      }

      const provider = selectLlmProvider(llmEnv);
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

        res.json({
          answerMarkdown: readGeneratedText(data),
          sources: extractWebSources(data?.candidates),
          grounded: true,
        });
        return;
      } catch (groundingError) {
        // Grounding quota is exhausted (or the provider has no Google Search):
        // answer without live sources and attach backup links from Exa when it is
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
          searchWebSources(query.trim()),
        ]);

        // Where the fallback time goes, so a slow phase is visible in the logs.
        console.log(
          `[search] grounding=${fallback.groundingStatus} grounded_ms=${
            fallbackStartedAt - groundedStartedAt
          } fallback_ms=${Date.now() - fallbackStartedAt} total_ms=${Date.now() - startedAt}`
        );

        res.json({
          answerMarkdown: readGeneratedText(data),
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

  // Delivery locations: Google Maps grounding on Gemini; elsewhere the answer is
  // model knowledge with no live place data.
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

      const provider = selectLlmProvider(llmEnv);
      const body = {
        contents: [{ role: 'user', parts: [{ text: buildMapsPrompt(query.trim()) }] }],
      };

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

        res.json({
          answerMarkdown: readGeneratedText(data),
          places: extractMapPlaces(data?.candidates),
          grounded: true,
        });
        return;
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

        res.json({ answerMarkdown: readGeneratedText(data), places: [], ...fallback });
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
