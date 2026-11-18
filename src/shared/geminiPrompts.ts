import {
  TRAINING_SCENARIOS,
  PRODUCT_SETS,
  INDIVIDUAL_FRUITS,
  SALES_STAGES,
} from '../data/playbookData.ts';
import type { TrainingScenario } from '../data/playbookData.ts';

export interface ChatMessageInput {
  role: 'customer' | 'admin';
  text: string;
}

export interface MentorHistoryItem {
  role: 'user' | 'model';
  text: string;
}

export type ThinkingName = 'LOW' | 'MEDIUM' | 'MINIMAL';

export interface GeminiSchema {
  type: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
}

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

// Tried in order: the primary, then a model with separate quota that still serves.
export const GEMINI_MODEL_CHAIN = [PRIMARY_MODEL, FALLBACK_MODEL] as const;

export const GEMINI_MODELS = {
  hint: FALLBACK_MODEL,
  maps: PRIMARY_MODEL,
} as const;

// Endpoints that prefer one model still need backups: start with their preferred
// model, then every other model of the shared chain.
export function modelChainStartingWith(preferred: string): readonly string[] {
  return [preferred, ...GEMINI_MODEL_CHAIN.filter((model) => model !== preferred)];
}

export const THINKING_LEVELS = {
  chat: 'LOW',
  hint: 'MINIMAL',
  evaluation: 'MEDIUM',
  mentor: 'LOW',
} as const;

const MENTOR_HISTORY_LIMIT = 20;

const RETRIES_PER_MODEL = 1;
const RETRY_DELAY_MS = 600;

// A slow model is as unavailable as a throttled one: after this long the request
// moves to the next model instead of waiting for the primary to answer.
export const MODEL_TIMEOUT_MS = 12_000;

export class ModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`MODEL_TIMEOUT after ${timeoutMs}ms`);
    this.name = 'ModelTimeoutError';
  }
}

type FailureAction = 'fallback' | 'retry' | 'throw';

// 429/503 cannot serve this model now, so switch models at once. Overload spikes
// are often brief, so they get one retry first. Anything else is a real error.
function classifyFailure(error: unknown): FailureAction {
  if (error instanceof ModelTimeoutError) return 'fallback';
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('429') || message.includes('resource_exhausted') || message.includes('503')) {
    return 'fallback';
  }
  if (message.includes('unavailable') || message.includes('high demand') || message.includes('overloaded')) {
    return 'retry';
  }
  return 'throw';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ModelTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function withModelFallback<T>(
  models: readonly string[],
  generate: (model: string) => Promise<T>,
  timeoutMs: number = MODEL_TIMEOUT_MS
): Promise<T> {
  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt <= RETRIES_PER_MODEL; attempt += 1) {
      try {
        return await withTimeout(generate(model), timeoutMs);
      } catch (error) {
        lastError = error;
        const action = classifyFailure(error);
        if (action === 'throw') throw error;
        if (action === 'fallback') break;
        if (attempt < RETRIES_PER_MODEL) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
  }
  throw lastError;
}

export interface MentorHistoryMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
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

export function findScenario(scenarioId: string): TrainingScenario | undefined {
  return TRAINING_SCENARIOS.find((s) => s.id === scenarioId);
}

export function formatTranscript(messages: ChatMessageInput[]): string {
  return messages
    .map((m, idx) => `[${idx + 1}] ${m.role === 'customer' ? 'ลูกค้า' : 'แอดมิน (ผู้ฝึก)'}: ${m.text}`)
    .join('\n');
}

// Grounding (Search/Maps) has its own quota, separate from normal generation.
// Only quota/availability failures may switch to a non-grounded retry; any other
// error must surface unchanged instead of being masked by a second call.
export function groundingFailureStatus(error: unknown): 429 | 503 | null {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('429') || message.includes('resource_exhausted')) return 429;
  if (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('high demand')
  ) {
    return 503;
  }
  return null;
}

export function formatGeminiError(error: unknown): { status: number; message: string } {
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

export function buildChatTurnPrompt(
  scenario: TrainingScenario,
  messages: ChatMessageInput[],
  currentStage?: number
): string {
  const knowledge = buildKnowledgeContext();
  const transcript = formatTranscript(messages);

  return `
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
}

export function buildHintPrompt(
  scenario: TrainingScenario,
  messages: ChatMessageInput[],
  currentStage?: number
): string {
  const knowledge = buildKnowledgeContext();
  const transcript = formatTranscript(messages);

  return `
คุณเป็นหัวหน้าทีมฝึกอบรม Admin Sale ของร้าน Premium Fruit Delivery
ผู้ฝึกกำลังฝึกตอบแชทในเคส "${scenario.title}" (ขั้นตอนปัจจุบัน: ${currentStage || 1}/6)
จากประวัติแชทล่าสุด กรุณาให้คำแนะนำสั้นๆ ว่าจังหวะนี้ควรเช็คข้อมูลอะไร พูดประเด็นไหนตามคู่มือ และให้ร่างคำตอบแนะนำที่สุภาพ ชัดเจน และทิ้งคำถามไว้ท้ายประโยคเสมอ

${knowledge}

เช็คลิสต์ของเคสนี้:
${scenario.keyCheckpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

บทสนทนาปัจจุบัน:
${transcript}
`;
}

export function buildEvaluationPrompt(
  scenario: TrainingScenario,
  messages: ChatMessageInput[]
): string {
  const knowledge = buildKnowledgeContext();
  const transcript = formatTranscript(messages);

  return `
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
}

export function buildMentorSystemInstruction(scenario?: TrainingScenario): string {
  const knowledge = buildKnowledgeContext();
  return `คุณคือ "พี่โค้ชงานบริการ (Senior Service & Chat Sales Mentor)" ประจำศูนย์ฝึกอบรม Admin Sale ของร้าน Premium Fruit Delivery
หน้าที่ของคุณคือช่วยให้พนักงานตอบแชทลูกค้าได้อย่างมืออาชีพ อบอุ่น รักษาบทสนทนาได้ต่อเนื่อง และแม่นยำตามคู่มือร้านทุกประการ
${scenario ? `ขณะนี้ผู้ฝึกกำลังดูเคส: "${scenario.title}" (${scenario.subtitle})` : ''}
หลักการตอบ:
- ตอบเป็นภาษาไทยที่เข้าใจง่าย กระชับ เป็นกันเองแบบรุ่นพี่สอนงาน
- อ้างอิงตัวเลข ราคา ค่าจัดส่ง เกณฑ์ส่งฟรี และขั้นตอน SOP จากคู่มืออย่างถูกต้อง
- หากผู้ฝึกขอดูตัวอย่างประโยค ให้เขียนสคริปต์พร้อมใช้ที่ "ทิ้งคำถามไว้ท้ายประโยคเสมอ"
${knowledge}`;
}

export function buildMentorHistory(history?: MentorHistoryItem[]): MentorHistoryMessage[] {
  return (Array.isArray(history) ? history : [])
    .slice(-MENTOR_HISTORY_LIMIT)
    .map((item) => ({ role: item.role, parts: [{ text: item.text }] }));
}

export function parseGeminiJson(text: string | undefined | null): any {
  const raw = (text ?? '').trim() || '{}';
  return JSON.parse(raw);
}

export interface WebSource {
  title: string;
  uri: string;
}

export interface MapPlace {
  title: string;
  uri: string;
  snippets: string[];
}

export function extractWebSources(candidates: any): WebSource[] {
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: WebSource[] = [];
  for (const chunk of chunks) {
    if (chunk.web?.uri) {
      sources.push({
        title: chunk.web.title || chunk.web.uri,
        uri: chunk.web.uri,
      });
    }
  }
  return sources;
}

export function extractMapPlaces(candidates: any): MapPlace[] {
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const places: MapPlace[] = [];
  for (const chunk of chunks) {
    if (chunk.maps?.uri) {
      const snippets: string[] =
        chunk.maps.placeAnswerSources?.reviewSnippets
          ?.map((s: any) => s.title || s.review)
          .filter((t: unknown): t is string => Boolean(t)) ?? [];
      places.push({
        title: chunk.maps.title || chunk.maps.uri,
        uri: chunk.maps.uri,
        snippets,
      });
    }
  }
  return places;
}

export function buildSearchSystemInstruction(): string {
  return 'คุณคือผู้ช่วยสืบค้นข้อมูลสดสำหรับพนักงานตอบแชทงานบริการร้านผลไม้พรีเมียม ตอบเป็นภาษาไทยอย่างกระชับ ชัดเจน และเป็นประโยชน์ในการนำไปตอบคำถามลูกค้า (เช่น ฤดูกาลผลไม้ วิธีเก็บรักษา คุณประโยชน์ของผลไม้ หรือข้อมูลติดต่อโรงพยาบาล/สถานที่ในไทย)';
}

export function buildMapsPrompt(query: string): string {
  return `ช่วยตรวจสอบข้อมูลสถานที่จัดส่ง ตำแหน่งที่ตั้ง จุดสังเกต หรือแนวทางการเดินทางในกรุงเทพฯ/ประเทศไทยสำหรับ: ${query} (ตอบเป็นภาษาไทยกระชับเพื่อใช้ประกอบการนัดหมายแมสเซนเจอร์ส่งกระเช้าผลไม้)`;
}

export const CHAT_TURN_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    customerReply: { type: 'STRING' },
    customerMood: { type: 'STRING' },
    stageDetected: { type: 'INTEGER' },
    isDealClosed: { type: 'BOOLEAN' },
    endedWithQuestion: { type: 'BOOLEAN' },
    toneScore: { type: 'INTEGER' },
    sopAccuracyNote: { type: 'STRING' },
    coachingTip: { type: 'STRING' },
    betterExample: { type: 'STRING' },
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
};

export const HINT_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    focusPoint: { type: 'STRING' },
    suggestedReply: { type: 'STRING' },
  },
  required: ['focusPoint', 'suggestedReply'],
};

export const EVALUATION_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    overallScore: { type: 'INTEGER' },
    gradeLabel: { type: 'STRING' },
    dimensions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          score: { type: 'INTEGER' },
          comment: { type: 'STRING' },
        },
        required: ['name', 'score', 'comment'],
      },
    },
    checkpointResults: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          passed: { type: 'BOOLEAN' },
          note: { type: 'STRING' },
        },
        required: ['label', 'passed', 'note'],
      },
    },
    strengths: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    improvements: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    summaryVerdict: { type: 'STRING' },
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
};
