import {
  TRAINING_SCENARIOS,
  PRODUCT_SETS,
  INDIVIDUAL_FRUITS,
  SALES_STAGES,
} from '../data/playbookData.ts';
import type { TrainingScenario } from '../data/playbookData.ts';

export type ChatPerspective = 'seller' | 'buyer';

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
  degraded: FALLBACK_MODEL,
} as const;

// Endpoints that prefer one model still need backups: start with their preferred
// model, then every other model of the shared chain.
export function modelChainStartingWith(preferred: string): readonly string[] {
  return [preferred, ...GEMINI_MODEL_CHAIN.filter((model) => model !== preferred)];
}

export const THINKING_LEVELS = {
  chat: 'LOW',
  hint: 'MINIMAL',
  // Search answers are short summaries, so thinking only adds latency. LOW is
  // used because MINIMAL is rejected by some models in the chain.
  search: 'LOW',
  evaluation: 'MEDIUM',
  mentor: 'LOW',
} as const;

const MENTOR_HISTORY_LIMIT = 20;

const RETRIES_PER_MODEL = 1;
const RETRY_DELAY_MS = 600;

// A slow model is as unavailable as a throttled one: after this long the request
// moves to the next model instead of waiting for the primary to answer.
export const MODEL_TIMEOUT_MS = 16_000;

// Short, tool-backed answers (search, maps, hint, evaluation) do not need a
// long wait: a first model still silent after a few seconds is slower than
// switching. Only the first model is cut this short; the backup keeps
// MODEL_TIMEOUT_MS so the fallback stays exactly as reachable as before.
export const QUICK_MODEL_TIMEOUT_MS = 6_000;

// One practice turn is a short JSON reply, so a model that is still silent after
// a few seconds is slower than switching to the backup model. The backup still
// gets MODEL_TIMEOUT_MS, so switching never loses the fallback.
export const CHAT_MODEL_TIMEOUT_MS = 6_000;

// Mentor answers are longer prose, so they get a little more room than a turn.
export const MENTOR_MODEL_TIMEOUT_MS = 8_000;

// Degraded mode already spent a round trip on the grounded call, so the backup
// model runs first with full budget and the fallback model gets a compact timeout.
export const DEGRADED_MODEL_TIMEOUT_MS = 5_000;

export class ModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`MODEL_TIMEOUT after ${timeoutMs}ms`);
    this.name = 'ModelTimeoutError';
  }
}

export type ModelFailureReason =
  | 'timeout'
  | 'throttled'
  | 'unauthorized'
  | 'unavailable'
  | 'overloaded'
  | 'error';

export interface ModelAttemptFailure {
  model: string;
  attempt: number;
  timeoutMs: number;
  reason: ModelFailureReason;
  detail: string;
}

const FAILURE_DETAIL_LIMIT = 160;

// Why an attempt failed, in a form that fits a log line and an error message:
// a timeout reads as "timeout", a quota rejection as "throttled", not both as
// an opaque 500.
export function describeModelFailure(error: unknown): { reason: ModelFailureReason; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const detail = message.slice(0, FAILURE_DETAIL_LIMIT);
  if (error instanceof ModelTimeoutError) return { reason: 'timeout', detail };
  // A key chain keeps the reason of its last key, so the model failure reads as
  // "throttled" rather than re-deriving it from the summary text.
  if (error instanceof ApiKeyChainError) return { reason: error.reason, detail };
  const status = (error as { status?: number } | null)?.status;
  const lower = message.toLowerCase();
  if (status === 429 || lower.includes('429') || lower.includes('resource_exhausted')) {
    return { reason: 'throttled', detail };
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('401') ||
    lower.includes('unauthenticated') ||
    lower.includes('api key not valid') ||
    lower.includes('api_key_invalid') ||
    lower.includes('access_token_type_unsupported') ||
    lower.includes('403') ||
    lower.includes('permission_denied')
  ) {
    return { reason: 'unauthorized', detail };
  }
  if (status === 503 || lower.includes('503') || lower.includes('unavailable')) {
    return { reason: 'unavailable', detail };
  }
  if (lower.includes('high demand') || lower.includes('overloaded')) {
    return { reason: 'overloaded', detail };
  }
  return { reason: 'error', detail };
}

// Every model in the chain failed: keep each attempt (model, try, reason) so the
// 500 says which model broke and whether it was a timeout or a throttle.
export class ModelChainError extends Error {
  readonly lastError: unknown;
  readonly attempts: readonly ModelAttemptFailure[];

  constructor(attempts: ModelAttemptFailure[], lastError: unknown) {
    super(
      `ทุกโมเดลที่ลองใช้งานไม่ได้ → ${attempts
        .map(
          (a) => `${a.model} (ครั้งที่ ${a.attempt}, ${a.timeoutMs}ms): ${a.reason}${a.detail ? ` — ${a.detail}` : ''}`
        )
        .join(' | ')}`
    );
    this.name = 'ModelChainError';
    this.attempts = attempts;
    this.lastError = lastError;
  }

  // Compact one-line form for logs: `model#try=reason, ...`.
  get summary(): string {
    return this.attempts.map((a) => `${a.model}#${a.attempt}=${a.reason}`).join(', ');
  }
}

type FailureAction = 'fallback' | 'retry' | 'throw';

// 429/503 cannot serve this model now, so switch models at once. Overload spikes
// are often brief, so they get one retry first. Anything else is a real error.
function classifyFailure(error: unknown): FailureAction {
  if (error instanceof ModelTimeoutError) return 'fallback';
  if (error instanceof ApiKeyChainError) return classifyReason(error.reason);
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

// The first model may be cut short so a stall turns into a switch sooner, while
// the backup keeps the full budget: the fallback stays exactly as reachable as
// before instead of inheriting the shorter wait.
// `label` is the endpoint tag (`chat/turn`, `maps`, ...), so every model switch
// is visible in the logs with the model, the try and the reason it failed.
export async function withModelFallback<T>(
  models: readonly string[],
  generate: (model: string) => Promise<T>,
  timeoutMs: number = MODEL_TIMEOUT_MS,
  backupTimeoutMs: number = timeoutMs,
  label?: string
): Promise<T> {
  const startedAt = Date.now();
  const attempts: ModelAttemptFailure[] = [];
  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    const attemptTimeoutMs = index === 0 ? timeoutMs : backupTimeoutMs;
    for (let attempt = 0; attempt <= RETRIES_PER_MODEL; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const result = await withTimeout(generate(model), attemptTimeoutMs);
        if (label) {
          console.log(
            `[${label}] model=${model} attempt=${attempt + 1} ok_ms=${Date.now() - attemptStartedAt}`
          );
        }
        return result;
      } catch (error) {
        lastError = error;
        const action = classifyFailure(error);
        const { reason, detail } = describeModelFailure(error);
        attempts.push({ model, attempt: attempt + 1, timeoutMs: attemptTimeoutMs, reason, detail });
        if (label) {
          console.log(
            `[${label}] model=${model} attempt=${attempt + 1} failed=${reason} after_ms=${
              Date.now() - attemptStartedAt
            } detail="${detail}"`
          );
        }
        if (action === 'throw') throw error;
        const isLastModel = index === models.length - 1;
        const canRetryLastModel =
          isLastModel && (reason === 'unavailable' || reason === 'overloaded');
        if (action === 'fallback' && !canRetryLastModel) break;
        if (attempt < RETRIES_PER_MODEL) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
  }
  if (label) {
    console.log(
      `[${label}] all_models_failed tried=${attempts.length} total_ms=${Date.now() - startedAt} failures=${
        new ModelChainError(attempts, lastError).summary
      }`
    );
  }
  throw new ModelChainError(attempts, lastError);
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

export function formatTranscript(
  messages: ChatMessageInput[],
  perspective: ChatPerspective = 'seller'
): string {
  const customerLabel = perspective === 'buyer' ? 'ลูกค้า (ผู้ฝึก)' : 'ลูกค้า';
  const adminLabel = perspective === 'buyer' ? 'แอดมิน (พนักงานขาย)' : 'แอดมิน (ผู้ฝึก)';
  return messages
    .map((m, idx) => `[${idx + 1}] ${m.role === 'customer' ? customerLabel : adminLabel}: ${m.text}`)
    .join('\n');
}

// How a key-chain outcome should be handled, shared by the model chain.
function classifyReason(reason: ModelFailureReason): FailureAction {
  switch (reason) {
    case 'timeout':
    case 'throttled':
    case 'unavailable':
      return 'fallback';
    case 'overloaded':
      return 'retry';
    default:
      return 'throw';
  }
}

// Grounding (Search/Maps) has its own quota, separate from normal generation.
// Every configured Gemini key, primary first, blanks and placeholders dropped.
export function geminiApiKeys(...keys: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keys) {
    const key = raw?.trim();
    if (!key || key === 'MY_GEMINI_API_KEY' || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

// A throttled or rejected/invalid key says nothing about the model or the
// request, so the same call can move to the backup key. Anything else must
// surface unchanged.
export function apiKeyRotationAllowed(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 429 || status === 403 || status === 401) return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('403') ||
    message.includes('permission_denied') ||
    message.includes('401') ||
    message.includes('unauthenticated') ||
    message.includes('api_key_invalid') ||
    message.includes('api key not valid') ||
    message.includes('access_token_type_unsupported')
  );
}

export interface ApiKeyFailure {
  // 1-based slot of the key, never the key itself.
  key: number;
  reason: ModelFailureReason;
}

// Every key failed: say which slots were tried and why, never printing a key
// value. The last error is kept so the response status stays the same.
export class ApiKeyChainError extends Error {
  readonly failures: readonly ApiKeyFailure[];
  readonly lastError: unknown;

  constructor(failures: ApiKeyFailure[], lastError: unknown) {
    const { detail } = describeModelFailure(lastError);
    super(
      `ทุกคีย์ที่ลองใช้งานไม่ได้ ลองแล้ว ${failures
        .map((f) => `คีย์#${f.key}: ${f.reason}`)
        .join(', ')}${detail ? ` — ${detail}` : ''}`
    );
    this.name = 'ApiKeyChainError';
    this.failures = failures;
    this.lastError = lastError;
  }

  get reason(): ModelFailureReason {
    const nonUnauthorized = [...this.failures].reverse().find((f) => f.reason !== 'unauthorized');
    return nonUnauthorized ? nonUnauthorized.reason : this.failures[this.failures.length - 1].reason;
  }

  // Compact form for logs: `คีย์#1=throttled, คีย์#2=throttled`.
  get summary(): string {
    return this.failures.map((f) => `คีย์#${f.key}=${f.reason}`).join(', ');
  }
}

const KEY_COOLDOWN_MS: Partial<Record<ModelFailureReason, number>> = {
  unauthorized: 10 * 60_000,
  throttled: 30_000,
};

const keyCooldowns = new Map<unknown, { until: number; reason: ModelFailureReason }>();

// Runs `run` with healthy keys first and, if a key is exhausted or rejected,
// demotes it for a cooldown and tries the next key. One key means one attempt.
export async function withApiKeyFallback<T, K>(
  keys: readonly K[],
  run: (key: K) => Promise<T>
): Promise<T> {
  if (keys.length === 0) {
    throw new Error('ไม่พบ GEMINI_API_KEY ในระบบ กรุณาตรวจสอบการตั้งค่า Secrets');
  }
  const now = Date.now();
  const indexed = keys.map((key, index) => ({
    key,
    slot: index + 1,
    cooldown: keyCooldowns.get(key),
  }));
  const healthy = indexed.filter((item) => !item.cooldown || item.cooldown.until <= now);
  const nonUnauthorizedCooldown = indexed
    .filter(
      (item) =>
        item.cooldown && item.cooldown.until > now && item.cooldown.reason !== 'unauthorized'
    )
    .sort((a, b) => (a.cooldown?.until ?? 0) - (b.cooldown?.until ?? 0));
  const unauthorizedCooldown = indexed
    .filter(
      (item) =>
        item.cooldown && item.cooldown.until > now && item.cooldown.reason === 'unauthorized'
    )
    .sort((a, b) => (a.cooldown?.until ?? 0) - (b.cooldown?.until ?? 0));

  // Try healthy keys first; if none are healthy, try recoverable keys without
  // rotating into known-unauthorized keys (which would mask a 429/503 as a 401).
  // Only fall back to unauthorized keys when every key is marked unauthorized.
  const ordered =
    healthy.length > 0
      ? healthy
      : nonUnauthorizedCooldown.length > 0
        ? nonUnauthorizedCooldown
        : unauthorizedCooldown;

  const failures: ApiKeyFailure[] = [];
  let lastError: unknown;
  let preferredError: unknown;
  for (const [pos, entry] of ordered.entries()) {
    try {
      const result = await run(entry.key);
      keyCooldowns.delete(entry.key);
      return result;
    } catch (error) {
      lastError = error;
      const { reason } = describeModelFailure(error);
      if (reason !== 'unauthorized' || preferredError === undefined) {
        preferredError = error;
      }
      failures.push({ key: entry.slot, reason });
      const cooldownMs = KEY_COOLDOWN_MS[reason];
      if (cooldownMs) {
        if (keyCooldowns.size > 16) keyCooldowns.clear();
        keyCooldowns.set(entry.key, { until: Date.now() + cooldownMs, reason });
      }
      // The last key, or a failure another key cannot fix: stop here.
      if (pos + 1 >= ordered.length || !apiKeyRotationAllowed(error)) break;
      console.log(
        `[gemini] key=#${entry.slot} failed (${reason}), trying key=#${ordered[pos + 1].slot}`
      );
    }
  }
  const reportedError = preferredError ?? lastError;
  // Name the key slots whenever the failure was about a key or a key switch was
  // tried; a genuine request error keeps its own message untouched.
  const keyLevel = failures.length > 1 || apiKeyRotationAllowed(reportedError);
  throw keyLevel ? new ApiKeyChainError(failures, reportedError) : reportedError;
}

// Only 429/503 may switch to a non-grounded retry; any other error must surface
// unchanged instead of being masked by a second call.
export const GROUNDING_TIMEOUT_NOTICES = {
  search:
    'ตอนนี้ระบบค้นหาเว็บแบบเรียลไทม์ตอบช้าเกินกำหนด คำตอบด้านล่างจึงมาจากความรู้ของโมเดลโดยไม่มีแหล่งอ้างอิง',
  maps: 'ตอนนี้ระบบค้นหาสถานที่บน Google Maps ตอบช้าเกินกำหนด คำตอบด้านล่างจึงมาจากความรู้ของโมเดลโดยไม่มีข้อมูลสถานที่จริง',
} as const;

export const GROUNDING_NOTICES = {
  search:
    'ตอนนี้ระบบค้นหาเว็บแบบเรียลไทม์ใช้งานไม่ได้ชั่วคราว (โควตาการค้นหาเว็บเต็ม) คำตอบด้านล่างจึงมาจากความรู้ของโมเดลโดยไม่มีแหล่งอ้างอิง',
  maps: 'ตอนนี้ระบบค้นหาสถานที่บน Google Maps ใช้งานไม่ได้ชั่วคราว (โควตาการค้นหาแผนที่เต็ม) คำตอบด้านล่างจึงมาจากความรู้ของโมเดลโดยไม่มีข้อมูลสถานที่จริง',
} as const;

// Used instead of GROUNDING_NOTICES.search when Exa supplies backup sources.
export const EXA_FALLBACK_NOTICE =
  'ตอนนี้ระบบค้นหาเว็บแบบเรียลไทม์ของ Google ใช้งานไม่ได้ชั่วคราว (โควตาการค้นหาเว็บเต็ม) คำตอบด้านล่างมาจากความรู้ของโมเดล โดยมีแหล่งอ้างอิงสำรองจาก Exa ให้ตรวจสอบแทน';

// Returns the fields to add to a non-grounded answer, or rethrows errors that
// must not be masked by a retry.
export function groundingFallback(kind: keyof typeof GROUNDING_NOTICES, error: unknown) {
  // A chain error carries its reasons structurally: its message is a summary and
  // its details are truncated, so the 429 text that caused the failure may not
  // survive. Read the reasons instead of hoping the words are still there.
  const reasons =
    error instanceof ModelChainError ? error.attempts.map((attempt) => attempt.reason) : [];
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  // A grounded call that hangs is as unusable as one that is throttled: it must
  // degrade too, otherwise the request pays both waits and still returns 500.
  const timedOut = reasons.includes('timeout') || message.includes('model_timeout');
  const exhausted =
    reasons.includes('throttled') ||
    message.includes('429') ||
    message.includes('resource_exhausted');
  const unavailable =
    reasons.includes('unavailable') ||
    reasons.includes('overloaded') ||
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('high demand');
  if (!exhausted && !unavailable && !timedOut) throw error;

  const byQuota = exhausted || unavailable;
  return {
    grounded: false as const,
    notice: byQuota ? GROUNDING_NOTICES[kind] : GROUNDING_TIMEOUT_NOTICES[kind],
    groundingStatus: (exhausted ? 429 : unavailable ? 503 : 504) as 429 | 503 | 504,
  };
}

function extractCleanErrorText(errMsg: string): string {
  const trimmed = errMsg.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        return parsed.error.message;
      }
    } catch {
      // Ignore parse failures and fall back to raw message
    }
  }
  return errMsg;
}

export function formatGeminiError(error: unknown): { status: number; message: string } {
  if (error instanceof ApiKeyChainError) {
    const base = formatGeminiError(error.lastError);
    return { status: base.status, message: `${base.message} (${error.summary})` };
  }
  if (error instanceof ModelChainError) {
    // Keep the same status the last failure would have produced, but say which
    // model failed and why instead of one opaque message.
    const base = formatGeminiError(error.lastError);
    return {
      status: base.status,
      message: base.status === 500 ? error.message : `${base.message} (${error.summary})`,
    };
  }
  const errMsg = error instanceof Error ? error.message : String(error);
  const lower = errMsg.toLowerCase();
  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('access_token_type_unsupported') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return {
      status: lower.includes('401') || lower.includes('unauthenticated') ? 401 : 403,
      message: 'API Key ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบค่า GEMINI_API_KEY ในเมนู Settings > Secrets',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      message: 'ขณะนี้มีการใช้งานเกินโควตาชั่วคราว กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
    };
  }
  return {
    status: 500,
    message: extractCleanErrorText(errMsg) || 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ AI Coach',
  };
}

export function buildChatTurnPrompt(
  scenario: TrainingScenario,
  messages: ChatMessageInput[],
  currentStage?: number,
  perspective: ChatPerspective = 'seller'
): string {
  const knowledge = buildKnowledgeContext();
  const transcript = formatTranscript(messages, perspective);

  if (perspective === 'buyer') {
    return `
คุณทำหน้าที่ 2 บทบาทพร้อมกันในรูปแบบ JSON (โหมดสลับบทบาท: ผู้ฝึกสวมบทบาทเป็น "ลูกค้า/ฝ่ายซื้อ", AI สวมบทบาทเป็น "พนักงานขาย Admin Sale"):
บทบาทที่ 1: สวมบทบาทเป็น "พนักงานขาย (Admin Sale)" ของร้าน Premium Fruit Delivery ที่เชี่ยวชาญคู่มือ SOP ตอบแชทลูกค้าอย่างสุภาพ อบอุ่น แม่นยำเรื่องราคา ค่าจัดส่ง ผลไม้ตามฤดูกาล และ "ทิ้งคำถามไว้ท้ายประโยคเสมอ"
บทบาทที่ 2: เป็น "โค้ชฝึกสื่อสารฝ่ายซื้อ (Live Coach)" ที่ประเมินข้อความล่าสุดของลูกค้า (ผู้ฝึก) ว่าสื่อสารความต้องการครบถ้วน สุภาพ และตั้งคำถาม/เปิดช่องให้พนักงานขายตอบต่อได้ดีหรือไม่

ข้อมูลสถานการณ์:
ชื่อเคส: ${scenario.title}
ช่องทาง: ${scenario.channel} | ช่วงเวลา: ${scenario.shiftTime}
ระยะทางจัดส่ง: ${scenario.distanceKm} กม. | งบประมาณลูกค้า: ~${scenario.budgetHint} บาท
บริบทลูกค้าที่ผู้ฝึกกำลังสวมบทบาท:
${scenario.customerPersonaPrompt}

เช็คลิสต์สำคัญของเคสนี้:
${scenario.keyCheckpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${knowledge}

ขั้นตอนปัจจุบันก่อนหน้านี้: ขั้นที่ ${currentStage || 1} จาก 6 (${SALES_STAGES.map((s) => `${s.step}.${s.label}`).join(' -> ')})

ประวัติแชททั้งหมด:
${transcript}

คำแนะนำในการสร้าง JSON ตอบกลับ:
- customerReply: คำตอบของ "พนักงานขาย (AI)" ในรอบถัดไปเป็นภาษาไทยธรรมชาติ (1-3 ประโยค) สุภาพ ชัดเจน ถูกต้องตามคู่มือร้าน และทิ้งคำถามไว้ท้ายประโยคเพื่อให้ลูกค้าตอบต่อ
- customerMood: ท่าที/อารมณ์ของพนักงานขาย 1 คำ เช่น "กระตือรือร้น", "สุภาพ", "ช่วยเหลือดี", "ใส่ใจ", "มืออาชีพ"
- stageDetected: หมายเลขขั้นตอนปัจจุบัน (1 ถึง 6) ตาม Flow การขาย
- isDealClosed: true เมื่อตกลงสั่งซื้อและให้ข้อมูลครบถ้วนแล้ว มิฉะนั้น false
- endedWithQuestion: true ถ้าข้อความล่าสุดของผู้ฝึก (ฝ่ายซื้อ) มีคำถามหรือคำขอที่ชัดเจนให้พนักงานขายตอบต่อ, false ถ้าจบแบบไม่มีประเด็นต่อ
- toneScore: คะแนนความสุภาพและความชัดเจนในการสื่อสารของข้อความล่าสุดจากผู้ฝึก (1 ถึง 5)
- sopAccuracyNote: สรุปสั้นๆ 1 ประโยคว่าข้อความล่าสุดของผู้ฝึกให้ข้อมูลหรือเช็คประเด็นสำคัญตามเคสนี้ครบหรือยังขาดจุดใด (เช่น งบประมาณ, สถานที่, วันเวลา, ฤดูกาล, ค่าส่ง, เงื่อนไขเร่งด่วน)
- coachingTip: คำแนะนำสั้นๆ 1-2 ประโยคสำหรับผู้ฝึกในฐานะฝ่ายซื้อว่าควรถามหรือให้ข้อมูลอะไรต่อ
- betterExample: ตัวอย่างประโยคที่ผู้ฝึก (ฝ่ายซื้อ) ควรพิมพ์ในจังหวะนี้เพื่อให้ได้ข้อมูลครบถ้วน สุภาพ และจบด้วยคำถามเสมอ
`;
  }

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
  currentStage?: number,
  perspective: ChatPerspective = 'seller'
): string {
  const knowledge = buildKnowledgeContext();
  const transcript = formatTranscript(messages, perspective);

  if (perspective === 'buyer') {
    return `
คุณเป็นโค้ชฝึกการสื่อสารสำหรับโหมด "ฝ่ายซื้อ (ลูกค้า)" ในเคส "${scenario.title}" (ขั้นตอนปัจจุบัน: ${currentStage || 1}/6)
จากประวัติแชทล่าสุด กรุณาแนะนำผู้ฝึกว่าในบทบาทลูกค้าควรสอบถามหรือระบุรายละเอียดใดเพิ่มเติมกับพนักงานขาย (เช่น งบประมาณ สถานที่ ช่วงเวลา ค่าส่ง เงื่อนไขผลไม้ตามฤดูกาล หรือเอกสาร E-Tax) พร้อมร่างประโยคตัวอย่างที่สุภาพ ชัดเจน และจบด้วยคำถามเสมอ

${knowledge}

เช็คลิสต์ของเคสนี้:
${scenario.keyCheckpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

บทสนทนาปัจจุบัน:
${transcript}
`;
  }

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

// Maps grounding is sharper when it knows where the courier is heading from.
export function buildMapsToolConfig(latLng?: { latitude: number; longitude: number }) {
  return latLng ? { toolConfig: { retrievalConfig: { latLng } } } : {};
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
