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
  buildMentorHistory,
  buildMentorSystemInstruction,
  buildSearchSystemInstruction,
  extractMapPlaces,
  extractWebSources,
  findScenario,
  formatGeminiError,
  groundingFailureStatus,
  modelChainStartingWith,
  parseGeminiJson,
  withModelFallback,
} from './src/shared/geminiPrompts.ts';
import type {
  ChatMessageInput,
  MentorHistoryItem,
  ThinkingName,
} from './src/shared/geminiPrompts.ts';
import { isExaConfigured, searchWeb } from './src/server/exaSearch.ts';

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

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('ไม่พบ GEMINI_API_KEY ในระบบ กรุณาตรวจสอบการตั้งค่า Secrets');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      exaApiKeyConfigured: isExaConfigured(),
    });
  });

  app.post('/api/chat/turn', async (req: Request, res: Response) => {
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
          })
      );

      res.json(parseGeminiJson(response.text));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/chat/hint', async (req: Request, res: Response) => {
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
          })
      );

      res.json(parseGeminiJson(response.text));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/chat/evaluate', async (req: Request, res: Response) => {
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
          })
      );

      res.json(parseGeminiJson(response.text));
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Multi-turn Mentor Chatbot (maintains conversation history + systemInstruction)
  app.post('/api/mentor/chat', async (req: Request, res: Response) => {
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
      });
      res.json({ reply: response.text ?? '' });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Google Search Grounding for live fruit seasonality, etiquette, hospital delivery info
  app.post('/api/tools/search', async (req: Request, res: Response) => {
    try {
      const { query } = req.body as { query: string };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
        return;
      }

      const ai = getAiClient();
      try {
        const response = await withModelFallback(GEMINI_MODEL_CHAIN, (model) =>
          ai.models.generateContent({
            model,
            contents: query.trim(),
            config: {
              systemInstruction: buildSearchSystemInstruction(),
              tools: [{ googleSearch: {} }],
            },
          })
        );

        res.json({
          answerMarkdown: response.text ?? '',
          sources: extractWebSources(response.candidates),
          grounded: true,
        });
        return;
      } catch (groundingError) {
        const groundingStatus = groundingFailureStatus(groundingError);
        if (groundingStatus === null) throw groundingError;

        // Grounding quota is exhausted: answer without live sources instead.
        const response = await withModelFallback(GEMINI_MODEL_CHAIN, (model) =>
          ai.models.generateContent({
            model,
            contents: query.trim(),
            config: { systemInstruction: buildSearchSystemInstruction() },
          })
        );

        res.json({
          answerMarkdown: response.text ?? '',
          sources: [],
          grounded: false,
          notice:
            'ตอนนี้ระบบค้นหาเว็บแบบเรียลไทม์ใช้งานไม่ได้ชั่วคราว (โควตาการค้นหาเว็บเต็ม) คำตอบด้านล่างจึงมาจากความรู้ของโมเดลโดยไม่มีแหล่งอ้างอิง',
          groundingStatus,
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
    try {
      const { query, numResults } = req.body as { query: string; numResults?: number };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
        return;
      }

      res.json(await searchWeb(query, numResults));
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'ไม่สามารถค้นหาเว็บด้วย Exa ได้' });
    }
  });

  // Google Maps Grounding for checking delivery locations, hospitals, and routes
  app.post('/api/tools/maps', async (req: Request, res: Response) => {
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
      const response = await withModelFallback(
        modelChainStartingWith(GEMINI_MODELS.maps),
        (model) =>
          ai.models.generateContent({
            model,
            contents: buildMapsPrompt(query.trim()),
            config: {
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
            },
          })
      );

      res.json({
        answerMarkdown: response.text ?? '',
        places: extractMapPlaces(response.candidates),
      });
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
