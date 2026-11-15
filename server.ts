import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  TRAINING_SCENARIOS,
  PRODUCT_SETS,
  INDIVIDUAL_FRUITS,
  SALES_STAGES,
} from './src/data/playbookData.ts';
import type { TrainingScenario } from './src/data/playbookData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

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

function buildKnowledgeContext(): string {
  const productSummary = PRODUCT_SETS.map(
    (p) =>
      `- ${p.code} "${p.name}": ${p.price} บาท | ${p.boxColor} | เหมาะกับ: ${p.occasions.join(', ')} | ผลไม้: ${p.fruits.join(', ')}${
        p.seasonalNote ? ` | หมายเหตุ: ${p.seasonalNote}` : ''
      }`
  ).join('\n');

  const fruitSummary = INDIVIDUAL_FRUITS.map(
    (f) => `- ${f.name} (${f.unit}): ${f.price} บาท (${f.origin})`
  ).join('\n');

  return `
ข้อมูลคู่มือร้าน Premium Fruit Delivery (สำหรับใช้ประเมินความถูกต้อง):
1. กฎเหล็กการแชท: ทุกขั้นตอนของการคุยกับลูกค้า ต้อง "ทิ้งคำถามไว้ให้ลูกค้าตอบเสมอ" เพื่อรักษาบทสนทนา (ห้ามปล่อยให้บทสนทนาตาย)
2. Flow การขาย 6 ขั้นตอน:
   1) ลูกค้าทัก (New Lead): ทักทายทันที
   2) สอบถามโอกาส/งบประมาณ (Engaged): ถามโอกาสที่ใช้, งบประมาณ, สถานที่, ช่วงเวลาจัดส่ง
   3) เสนอแบบ (Quoted): ส่งรูปประมาณ 8-12 รูป ราคาบวกลบไม่เกิน 200 บาท พร้อมแนะนำเซต
   4) เช็คผลไม้ตามฤดูกาล: ตรวจผลไม้หมดฤดู (เช่น เชอร์รี่หมดฤดู ให้แจ้งลูกค้าและขอเปลี่ยนเป็นบลูเบอร์รี 125 กรัม 210 บาท หรือผลไม้อื่นทดแทน)
   5) Upsell:
      - Upgrade องุ่นเป็น Shine Muscat 300g พร้อมแจ้งส่วนต่าง
      - Add On Shine Muscat 300g
      - โปรแลกซื้อรังนกแท้สูตรหวานน้อย +200 บาท (เหมาะกับเยี่ยมผู้ป่วย/เพิ่มความพิเศษ)
      - ขนมไหว้พระจันทร์เสริมสิริมงคล +320 บาท (เหมาะกับเซตแสดงความยินดี/เทศกาล)
      - หากลูกค้าปฏิเสธ: ตอบ "ยินดีค่ะ" และสรุปยอดตามราคาเซตเดิมอย่างสุภาพ
   6) ปิดการขาย (Closing & OP): ยืนยันข้อมูลผู้สั่ง/ผู้รับ, สถานที่/วันเวลา, โบว์/ปรับเซต, ข้อความการ์ด, ใบเสร็จ/E-Tax; กรณีโรงพยาบาลต้องขอเบอร์ญาติผู้ป่วย; ห้ามเว้นวรรค/ห้ามใส่อีโมจิใน URL Payment; แนะนำเก็บตู้เย็น 1-5 องศาเซลเซียส ไม่วางห้องแอร์เกิน 3-4 ชม.
3. ค่าจัดส่ง:
   - 1-10 กม.: 59 บาท (ส่งฟรีเมื่อยอด 1,500 บาทขึ้นไป), แมส 20-30 นาที, รับภายใน 1-1.5 ชม.
   - 11-25 กม.: 159 บาท (ส่งฟรีเมื่อยอด 4,000 บาทขึ้นไป), 10-20 กม. แมส 40 นาที (รับภายใน 2 ชม.), 20-25 กม. แมส 40-50 นาที (รับภายใน 2.5 ชม.)
   - เกิน 25 กม.: 159 + 10 บาท/กม. ส่วนเกิน (เช่น 30 กม. = 209 บาท), รับภายใน 3 ชม. (แล้วแต่พิจารณา)
   - เคสเร่งด่วนน้อยกว่า 2 ชม. หรือชุดส่งด่วน 1-1.5 ชม.: ต้องประสานงานทีม OP ประเมินความพร้อมก่อนรับปากลูกค้าเสมอ!
   - ต่างจังหวัด รถห้องเย็น Inter Express: 450 บาท/ชิ้น, นับถอยหลัง 3 วัน, ตัดรอบก่อน 12.00 น., งดวิ่งวันเสาร์
4. การทำงานตามกะ:
   - Shift 1 (08:00-17:00): ลงตารางรับ ORDER สาขา BKK และประสานทีม Admin
   - Shift 2 (17:00-20:00): ลงตาราง + สั่งจัดเข้ากลุ่มไลน์สาขา BKK (Head office) รอบเช้า 1-10 กม. ส่ง 8.30-9.00, 11-20 กม. ส่ง 9.00-10.00
   - Shift 3 (20:00-22:00): แคปหน้าจอแชท + ลงวันเวลาในกลุ่ม Admin สาขา BKK
5. สีกล่องเยี่ยมไข้: กล่องสีเขียว
6. รายการสินค้าหลัก:
${productSummary}
ผลไม้ปลีก:
${fruitSummary}
`;
}

interface ChatMessageInput {
  role: 'customer' | 'admin';
  text: string;
}

function findScenario(scenarioId: string): TrainingScenario | undefined {
  return TRAINING_SCENARIOS.find((s) => s.id === scenarioId);
}

function formatTranscript(messages: ChatMessageInput[]): string {
  return messages
    .map((m, idx) => `[${idx + 1}] ${m.role === 'customer' ? 'ลูกค้า' : 'แอดมิน (ผู้ฝึก)'}: ${m.text}`)
    .join('\n');
}

function formatGeminiError(error: unknown): { status: number; message: string } {
  const errMsg = error instanceof Error ? error.message : String(error);
  if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('403')) {
    return {
      status: 403,
      message: 'API Key ไม่ถูกต้องหรือยังไม่ได้ตั้งค่า กรุณาตรวจสอบในเมนู Settings > Secrets',
    };
  }
  if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
    return {
      status: 429,
      message: 'ขณะนี้มีการใช้งานเกินโควตาชั่วคราว กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
    };
  }
  return {
    status: 500,
    message: errMsg || 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ AI Coach',
  };
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
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
      const knowledge = buildKnowledgeContext();
      const transcript = formatTranscript(messages);

      const prompt = `
คุณทำหน้าที่ 2 บทบาทพร้อมกันในรูปแบบ JSON:
บทบาทที่ 1: สวมบทบาทเป็น "ลูกค้า" ตาม Persona ด้านล่าง เพื่อโต้ตอบแชทกับพนักงานแอดมิน (ผู้ฝึก) อย่างสมจริง
บทบาทที่ 2: เป็น "โค้ชฝึกงานบริการ (Live Coach)" ที่ประเมินข้อความล่าสุดของแอดมินเทียบกับคู่มือร้านและทักษะการสื่อสารงานบริการ

ข้อมูลสถานการณ์:
ชื่อเคส: ${scenario.title}
ช่องทาง: ${scenario.channel} | ช่วงเวลา: ${scenario.shiftTime}
ระยะทางจัดส่ง: ${scenario.distanceKm} กม. | งบประมาณลูกค้า: ~${scenario.budgetHint} บาท
Persona ลูกค้า:
${scenario.customerPersonaPrompt}

เช็คลิสต์สำคัญของเคสนี้:
${scenario.keyCheckpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${knowledge}

ขั้นตอนปัจจุบันก่อนหน้านี้: ขั้นที่ ${currentStage || 1} จาก 6 (${SALES_STAGES.map((s) => `${s.step}.${s.label}`).join(' -> ')})

ประวัติแชททั้งหมด:
${transcript}

คำแนะนำในการสร้าง JSON ตอบกลับ:
- customerReply: คำตอบของลูกค้าในรอบถัดไปเป็นภาษาไทยธรรมชาติ (1-3 ประโยค) หากแอดมินลืมทิ้งคำถามไว้ท้ายประโยค ให้ลูกค้าตอบสั้นลงหรือลังเลเล็กน้อยเพื่อสะท้อนความเสี่ยงบทสนทนาตาย หากแอดมินให้ราคา/ค่าส่งผิดจากคู่มือ ให้ลูกค้าทักท้วงอย่างสมจริง หากแอดมินสรุปยอดและปิดการขายครบถ้วนแล้ว ให้ลูกค้ายืนยันการโอนเงิน/ขอบคุณ
- customerMood: สภาพอารมณ์ลูกค้า 1 คำ เช่น "สนใจ", "เร่งรีบ", "ลังเล", "พึงพอใจ", "สงสัย"
- stageDetected: หมายเลขขั้นตอนปัจจุบัน (1 ถึง 6) ตาม Flow การขาย
- isDealClosed: true เมื่อลูกค้าตกลงยืนยันสั่งซื้อและส่งมอบข้อมูลครบถ้วนแล้ว มิฉะนั้น false
- endedWithQuestion: true ถ้าข้อความล่าสุดของแอดมินมีคำถามทิ้งท้ายเพื่อรักษาบทสนทนา, false ถ้าไม่มีคำถามทิ้งท้าย
- toneScore: คะแนนความสุภาพ น้ำเสียง และความเอาใจใส่ของข้อความล่าสุด (1 ถึง 5)
- sopAccuracyNote: สรุปสั้นๆ 1 ประโยคว่าข้อความล่าสุดทำถูกต้องหรือพลาดจุดใดตามคู่มือ (เช่น ค่าส่ง, OP, เบอร์ญาติ, ผลไม้หมดฤดู, URL, Upsell)
- coachingTip: คำแนะนำเชิงสร้างสรรค์สั้นๆ 1-2 ประโยคเพื่อพัฒนาข้อความนี้ให้ดีขึ้นในรอบถัดไป
- betterExample: ตัวอย่างประโยคที่แอดมินควรตอบในจังหวะนี้เพื่อให้สมบูรณ์แบบตามคู่มือ (กระชับ สุภาพ และจบด้วยคำถามเสมอ)
`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              customerReply: { type: Type.STRING },
              customerMood: { type: Type.STRING },
              stageDetected: { type: Type.INTEGER },
              isDealClosed: { type: Type.BOOLEAN },
              endedWithQuestion: { type: Type.BOOLEAN },
              toneScore: { type: Type.INTEGER },
              sopAccuracyNote: { type: Type.STRING },
              coachingTip: { type: Type.STRING },
              betterExample: { type: Type.STRING },
            },
            required: [
              'customerReply',
              'customerMood',
              'stageDetected',
              'isDealClosed',
              'endedWithQuestion',
              'toneScore',
              'sopAccuracyNote',
              'coachingTip',
              'betterExample',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
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
      const knowledge = buildKnowledgeContext();
      const transcript = formatTranscript(messages);

      const prompt = `
คุณเป็นหัวหน้าทีมฝึกอบรม Admin Sale ของร้าน Premium Fruit Delivery
ผู้ฝึกกำลังฝึกตอบแชทในเคส "${scenario.title}" (ขั้นตอนปัจจุบัน: ${currentStage || 1}/6)
จากประวัติแชทล่าสุด กรุณาให้คำแนะนำสั้นๆ ว่าจังหวะนี้ควรเช็คข้อมูลอะไร พูดประเด็นไหนตามคู่มือ และให้ร่างคำตอบแนะนำที่สุภาพ ชัดเจน และทิ้งคำถามไว้ท้ายประโยคเสมอ

${knowledge}

เช็คลิสต์ของเคสนี้:
${scenario.keyCheckpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

บทสนทนาปัจจุบัน:
${transcript}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              focusPoint: { type: Type.STRING },
              suggestedReply: { type: Type.STRING },
            },
            required: ['focusPoint', 'suggestedReply'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
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
      const knowledge = buildKnowledgeContext();
      const transcript = formatTranscript(messages);

      const prompt = `
คุณคือผู้ประเมินอาวุโสฝ่ายพัฒนาทักษะการสื่อสารงานบริการและการขาย (QA & Service Coach)
จงประเมินผลการฝึกตอบแชททั้งหมดของผู้ฝึกในเคส "${scenario.title}" โดยเทียบกับคู่มือร้านและหลักการสื่อสารงานบริการอย่างละเอียดและยุติธรรม

${knowledge}

เป้าหมาย/เช็คลิสต์ของเคสนี้:
${scenario.keyCheckpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

บันทึกการสนทนา:
${transcript}

กรุณาให้คะแนน (0-100) และวิเคราะห์ตามโครงสร้าง JSON ดังนี้:
- overallScore: คะแนนรวม (0-100)
- gradeLabel: ระดับผลงาน เช่น "ดีเยี่ยม (พร้อมรับแชทจริง)", "ผ่านเกณฑ์มาตรฐาน", "ควรฝึกเพิ่มเติม"
- dimensions: อาร์เรย์ 5 มิติ ได้แก่:
  1. "การเปิดใจและรักษาบทสนทนา (ตั้งคำถามปิดท้าย)"
  2. "การค้นหาความต้องการและแนะนำสินค้าตรงงบ"
  3. "ความถูกต้องของกฎ SOP และค่าจัดส่ง"
  4. "ทักษะการ Upsell และรับมือข้อโต้แย้ง"
  5. "น้ำเสียงงานบริการและความครบถ้วนก่อนปิดการขาย"
  โดยแต่ละมิติมี name, score (0-100), comment (1-2 ประโยค)
- checkpointResults: ตรวจเช็คลิสต์ของเคสนี้ทีละข้อ (label, passed: boolean, note: string)
- strengths: จุดเด่นที่ทำได้ดี 2-3 ข้อ
- improvements: จุดที่ควรปรับปรุงพร้อมแนวทางแก้ไขจริง 2-3 ข้อ
- summaryVerdict: สรุปภาพรวมและคำแนะนำสำหรับพนักงาน 2-3 ประโยค
`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallScore: { type: Type.INTEGER },
              gradeLabel: { type: Type.STRING },
              dimensions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    score: { type: Type.INTEGER },
                    comment: { type: Type.STRING },
                  },
                  required: ['name', 'score', 'comment'],
                },
              },
              checkpointResults: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    passed: { type: Type.BOOLEAN },
                    note: { type: Type.STRING },
                  },
                  required: ['label', 'passed', 'note'],
                },
              },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              improvements: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              summaryVerdict: { type: Type.STRING },
            },
            required: [
              'overallScore',
              'gradeLabel',
              'dimensions',
              'checkpointResults',
              'strengths',
              'improvements',
              'summaryVerdict',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Multi-turn Mentor Chatbot (maintains conversation history + systemInstruction)
  app.post('/api/mentor/chat', async (req: Request, res: Response) => {
    try {
      const { history, message, scenarioId } = req.body as {
        history?: Array<{ role: 'user' | 'model'; text: string }>;
        message: string;
        scenarioId?: string;
      };

      if (!message || !message.trim()) {
        res.status(400).json({ error: 'กรุณากรอกคำถามถึงโค้ช AI' });
        return;
      }

      const ai = getAiClient();
      const knowledge = buildKnowledgeContext();
      const scenario = scenarioId ? findScenario(scenarioId) : undefined;

      const systemInstruction = `คุณคือ "พี่โค้ชงานบริการ (Senior Service & Chat Sales Mentor)" ประจำศูนย์ฝึกอบรม Admin Sale ของร้าน Premium Fruit Delivery
หน้าที่ของคุณคือช่วยให้พนักงานตอบแชทลูกค้าได้อย่างมืออาชีพ อบอุ่น รักษาบทสนทนาได้ต่อเนื่อง และแม่นยำตามคู่มือร้านทุกประการ
${scenario ? `ขณะนี้ผู้ฝึกกำลังดูเคส: "${scenario.title}" (${scenario.subtitle})` : ''}
หลักการตอบ:
- ตอบเป็นภาษาไทยที่เข้าใจง่าย กระชับ เป็นกันเองแบบรุ่นพี่สอนงาน
- อ้างอิงตัวเลข ราคา ค่าจัดส่ง เกณฑ์ส่งฟรี และขั้นตอน SOP จากคู่มืออย่างถูกต้อง
- หากผู้ฝึกขอดูตัวอย่างประโยค ให้เขียนสคริปต์พร้อมใช้ที่ "ทิ้งคำถามไว้ท้ายประโยคเสมอ"
${knowledge}`;

      const formattedHistory = (Array.isArray(history) ? history : []).slice(-20).map((item) => ({
        role: item.role,
        parts: [{ text: item.text }],
      }));

      const chat = ai.chats.create({
        model: 'gemini-4-hydrogen',
        history: formattedHistory,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const response = await chat.sendMessage({ message: message.trim() });
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
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: query.trim(),
        config: {
          systemInstruction:
            'คุณคือผู้ช่วยสืบค้นข้อมูลสดสำหรับพนักงานตอบแชทงานบริการร้านผลไม้พรีเมียม ตอบเป็นภาษาไทยอย่างกระชับ ชัดเจน และเป็นประโยชน์ในการนำไปตอบคำถามลูกค้า (เช่น ฤดูกาลผลไม้ วิธีเก็บรักษา คุณประโยชน์ของผลไม้ หรือข้อมูลติดต่อโรงพยาบาล/สถานที่ในไทย)',
          tools: [{ googleSearch: {} }],
        },
      });

      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources: Array<{ title: string; uri: string }> = [];
      for (const chunk of rawChunks) {
        if (chunk.web?.uri) {
          sources.push({
            title: chunk.web.title || chunk.web.uri,
            uri: chunk.web.uri,
          });
        }
      }

      res.json({
        answerMarkdown: response.text ?? '',
        sources,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      res.status(formatted.status).json({ error: formatted.message });
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
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `ช่วยตรวจสอบข้อมูลสถานที่จัดส่ง ตำแหน่งที่ตั้ง จุดสังเกต หรือแนวทางการเดินทางในกรุงเทพฯ/ประเทศไทยสำหรับ: ${query.trim()} (ตอบเป็นภาษาไทยกระชับเพื่อใช้ประกอบการนัดหมายแมสเซนเจอร์ส่งกระเช้าผลไม้)`,
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
      });

      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const places: Array<{ title: string; uri: string; snippets: string[] }> = [];
      for (const chunk of rawChunks) {
        if (chunk.maps?.uri) {
          const snippets =
            chunk.maps.placeAnswerSources?.reviewSnippets
              ?.map((s) => s.title || s.review)
              .filter((t): t is string => Boolean(t)) ?? [];
          places.push({
            title: chunk.maps.title || chunk.maps.uri,
            uri: chunk.maps.uri,
            snippets,
          });
        }
      }

      res.json({
        answerMarkdown: response.text ?? '',
        places,
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

createApp();
