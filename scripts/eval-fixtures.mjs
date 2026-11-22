// Fixtures for the provider eval gate (scripts/eval-prompts.mjs).
//
// Each fixture is one realistic request. The request body is assembled with the
// same prompt builders and schema constants the handlers use, so a fixture that
// passes here exercises the payload production actually sends — including the
// Gemini→OpenAI translation inside selectLlmProvider.
//
// Fixtures are data, checks are plain rules. Keep the rules structural (schema,
// ranges, wording requirements the prompt states) so a pass/fail means a real
// regression instead of a changed model's personal style.

import {
  CHAT_TURN_SCHEMA,
  EVALUATION_SCHEMA,
  HINT_SCHEMA,
  THINKING_LEVELS,
  buildChatTurnPrompt,
  buildEvaluationPrompt,
  buildHintPrompt,
  buildMentorHistory,
  buildMentorSystemInstruction,
  findScenario,
} from '../src/shared/geminiPrompts.ts';

export const EVAL_FIXTURES = [
  {
    id: 'turn-seller-hospital-open',
    endpoint: 'turn',
    scenarioId: 'hospital-visit',
    perspective: 'seller',
    currentStage: 1,
    messages: [
      { role: 'customer', text: 'สวัสดีค่ะ สอบถามกระเช้าผลไม้หน่อยค่ะ อยากสั่งไปให้ผู้ใหญ่' },
      { role: 'admin', text: 'สวัสดีค่ะ ยินดีให้คำปรึกษาค่ะ ไม่ทราบว่าลูกค้าต้องการส่งให้ใครและงบประมาณเท่าไหร่คะ' },
    ],
  },
  {
    id: 'turn-seller-fee-check',
    endpoint: 'turn',
    scenarioId: 'congrats-upsell-reject',
    perspective: 'seller',
    currentStage: 6,
    messages: [
      { role: 'customer', text: 'สวัสดีครับ มีกระเช้าดูภูมิฐานไหมครับ งบไม่เกินสองพัน' },
      { role: 'admin', text: 'มีเซต NO.1229 Blissful Harmony 1,950 บาทค่ะ ค่าส่ง 59 บาท รวม 2,009 บาทค่ะ' },
      { role: 'customer', text: 'เอ๊ะ ยอดเกิน 1,500 บาท ระยะ 8 กม. ไม่ได้ส่งฟรีเหรอครับ?' },
      {
        role: 'admin',
        text: 'ขออภัยค่ะ ระยะ 8 กม. ยอด 1,950 บาท ส่งฟรีค่ะ รวม 1,950 บาท สะดวกให้จัดส่งพรุ่งนี้ 10.00 น. ไหมคะ',
      },
    ],
  },
  {
    id: 'turn-buyer-upcountry',
    endpoint: 'turn',
    scenarioId: 'upcountry-seasonal',
    perspective: 'buyer',
    currentStage: 4,
    messages: [
      { role: 'customer', text: 'สนใจชุด RT02 The Graceful Dawn 1,990 บาทครับ อยากให้ส่งไปโคราชถึงวันเสาร์นี้ ทันไหมครับ?' },
      {
        role: 'admin',
        text: 'ชุด RT02 มีเชอร์รี่ค่ะ ส่งต่างจังหวัดใช้รถห้องเย็น Inter Express 450 บาท/ชิ้น ใช้เวลา 3 วันค่ะ',
      },
      { role: 'customer', text: 'แล้วถ้าเชอร์รี่หมดฤดู เปลี่ยนเป็นบลูเบอร์รีได้ไหมครับ และวันเสาร์ส่งได้จริงหรือเปล่า?' },
    ],
  },
  {
    id: 'hint-seller-urgent',
    endpoint: 'hint',
    scenarioId: 'urgent-limited-budget',
    perspective: 'seller',
    currentStage: 2,
    messages: [
      { role: 'customer', text: 'ด่วนมากเลยค่ะ มีงบไม่เกิน 1,000 บาท ส่งแถวพระราม 9 ภายใน 1 ชั่วโมงทันไหมคะ?' },
      { role: 'admin', text: 'ได้เลยค่ะ เดี๋ยวจัดส่งให้ภายใน 1 ชั่วโมงนะคะ' },
    ],
  },
  {
    id: 'hint-buyer-shift2',
    endpoint: 'hint',
    scenarioId: 'shift2-etax-payment',
    perspective: 'buyer',
    currentStage: 2,
    messages: [
      { role: 'customer', text: 'สวัสดีค่ะ ขอใบกำกับภาษีแบบ E-Tax ด้วยได้ไหมคะ' },
      { role: 'admin', text: 'ได้ค่ะ ขอชื่อบริษัทและเลขผู้เสียภาษีด้วยนะคะ' },
    ],
  },
  {
    id: 'evaluate-hospital',
    endpoint: 'evaluate',
    scenarioId: 'hospital-visit',
    messages: [
      { role: 'customer', text: 'สวัสดีค่ะ สอบถามกระเช้าผลไม้หน่อยค่ะ อยากสั่งไปให้ผู้ใหญ่' },
      {
        role: 'admin',
        text: 'สวัสดีค่ะ ยินดีช่วยค่ะ ไม่ทราบว่าโอกาสไหนและงบประมาณเท่าไหร่คะ ส่งสถานที่ใด ช่วงเวลาใดคะ',
      },
      { role: 'customer', text: 'ใช้เยี่ยมไข้หัวหน้าค่ะ งบ 1,500 บาท ส่งโรงพยาบาลบำรุงราษฎร์ บ่ายวันนี้ค่ะ' },
      {
        role: 'admin',
        text: 'แนะนำ NO.1209 Fruit Symphony 1,390 บาท ในกล่องสีเขียวเหมาะกับเยี่ยมไข้ค่ะ ระยะ 14 กม. ค่าส่ง 159 บาท รวม 1,549 บาทค่ะ',
      },
      { role: 'customer', text: 'โอเคค่ะ เอาเซตนี้ค่ะ' },
      {
        role: 'admin',
        text: 'ขอบคุณค่ะ ขอชื่อผู้รับและเบอร์ญาติผู้ป่วยด้วยนะคะ ต้องการข้อความการ์ดอะไรคะ',
      },
      { role: 'customer', text: 'คุณสมชาย ใจดี ห้อง 804 เบอร์ญาติ 0812345678 ค่ะ ข้อความ "หายป่วยไวๆ นะคะ"' },
      {
        role: 'admin',
        text: 'รับทราบค่ะ สรุปยอด 1,549 บาท รวมค่าส่งแล้ว สะดวกโอนผ่านลิงก์นี้เลยไหมคะ',
      },
    ],
  },
  {
    id: 'evaluate-fee-error',
    endpoint: 'evaluate',
    scenarioId: 'congrats-upsell-reject',
    messages: [
      { role: 'customer', text: 'สวัสดีครับ มีกระเช้าดูภูมิฐานไหมครับ งบไม่เกินสองพัน' },
      { role: 'admin', text: 'มีเซต NO.1229 ราคา 1,950 บาทครับ ค่าส่ง 59 บาท รวม 2,009 บาทครับ' },
      { role: 'customer', text: 'เอ๊ะ ยอดเกิน 1,500 ระยะ 8 กม. ไม่ได้ส่งฟรีเหรอครับ?' },
      { role: 'admin', text: 'ขออภัยครับ ส่งฟรีครับ รวม 1,950 บาทครับ' },
      { role: 'customer', text: 'โอเคครับ เอาเซตเดิม ไม่ต้องเพิ่มของหวานครับ' },
    ],
  },
  {
    id: 'mentor-delivery-fee',
    endpoint: 'mentor',
    scenarioId: 'hospital-visit',
    activeScenarioId: 'hospital-visit',
    message: 'ลูกค้าระยะ 18 กม. ยอด 1,200 บาท ค่าส่งเท่าไหร่ และควรพูดกับลูกค้ายังไงดีคะ',
    history: [
      { role: 'user', text: 'เคสเยี่ยมไข้ต้องขอข้อมูลอะไรเพิ่มคะ' },
      { role: 'model', text: 'ขอชื่อผู้รับ เบอร์ญาติผู้ป่วย และข้อความการ์ดค่ะ' },
    ],
  },
];

// One request body per endpoint, assembled exactly like worker.ts / server.ts do.
export function buildRequest(fixture) {
  const scenario = findScenario(fixture.scenarioId);
  if (!scenario) throw new Error(`ไม่พบ scenarioId "${fixture.scenarioId}" ใน playbookData`);

  if (fixture.endpoint === 'turn') {
    return {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildChatTurnPrompt(
                scenario,
                fixture.messages,
                fixture.currentStage,
                fixture.perspective
              ),
            },
          ],
        },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.chat },
        responseMimeType: 'application/json',
        responseSchema: CHAT_TURN_SCHEMA,
      },
    };
  }

  if (fixture.endpoint === 'hint') {
    return {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildHintPrompt(
                scenario,
                fixture.messages,
                fixture.currentStage,
                fixture.perspective
              ),
            },
          ],
        },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.hint },
        responseMimeType: 'application/json',
        responseSchema: HINT_SCHEMA,
      },
    };
  }

  if (fixture.endpoint === 'evaluate') {
    return {
      contents: [
        { role: 'user', parts: [{ text: buildEvaluationPrompt(scenario, fixture.messages) }] },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: THINKING_LEVELS.evaluation },
        responseMimeType: 'application/json',
        responseSchema: EVALUATION_SCHEMA,
      },
    };
  }

  if (fixture.endpoint === 'mentor') {
    return {
      contents: [
        ...buildMentorHistory(fixture.history),
        { role: 'user', parts: [{ text: fixture.message }] },
      ],
      systemInstruction: { parts: [{ text: buildMentorSystemInstruction(scenario) }] },
      generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVELS.mentor } },
    };
  }

  throw new Error(`ไม่รู้จัก endpoint "${fixture.endpoint}"`);
}

function typeErrors(value, schema, path = '$') {
  const type = String(schema?.type ?? 'string').toLowerCase();
  const errors = [];
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path}: ต้องเป็น object`];
    }
    const properties = schema.properties ?? {};
    for (const key of Object.keys(properties)) {
      if (!(key in value)) errors.push(`${path}.${key}: ขาด field`);
    }
    // Strict JSON Schema means no extra keys; Gemini tolerates them, so this is
    // also the check that the provider honours the schema it was given.
    for (const key of Object.keys(value)) {
      if (!(key in properties)) errors.push(`${path}.${key}: field เกิน schema`);
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) errors.push(...typeErrors(value[key], sub, `${path}.${key}`));
    }
    return errors;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: ต้องเป็น array`];
    value.forEach((item, index) => {
      errors.push(...typeErrors(item, schema.items ?? { type: 'string' }, `${path}[${index}]`));
    });
    return errors;
  }
  if (type === 'integer') {
    return Number.isInteger(value) ? [] : [`${path}: ต้องเป็นจำนวนเต็ม`];
  }
  if (type === 'number') {
    return typeof value === 'number' ? [] : [`${path}: ต้องเป็นตัวเลข`];
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? [] : [`${path}: ต้องเป็น true/false`];
  }
  return typeof value === 'string' ? [] : [`${path}: ต้องเป็นข้อความ`];
}

// Thai questions do not need a "?": the interrogative word carries the meaning.
// The same reply can therefore arrive as "…ไหมคะ", "…ไหมคะ?", "…ไหมครับ 🎁" or
// "…ไหมคะ" ในเครื่องหมายคำพูด, and a check that only accepts one of those shapes
// fails the others for formatting rather than for content. So the decoration is
// stripped first and the marker is then looked for in the closing clause.
const TRAILING_DECORATION = /[\s"'“”‘’「」『』()（）\[\]{}<>…~.,!*_=+—–‑-]+$/u;
const TRAILING_EMOJI = /\p{Extended_Pictographic}+$/u;
const QUESTION_MARKERS =
  /(ไหม|มั้ย|หรือเปล่า|หรือไม่|หรือยัง|หรือคะ|หรือครับ|เท่าไหร่|เท่าไร|กี่บาท|อะไร|ไหน|เมื่อไหร่|เมื่อไร|อย่างไร|ยังไง|เป็นไง|ดีไหม)/;
// Only the closing part of the reply counts: "อะไร" in a first sentence is not a
// question at the end of the message.
const QUESTION_TAIL_CHARS = 40;

function meaningfulTail(text) {
  let tail = String(text ?? '').trim();
  for (let previous = ''; tail !== previous; ) {
    previous = tail;
    tail = tail.replace(TRAILING_DECORATION, '').replace(TRAILING_EMOJI, '');
  }
  return tail;
}

// The manual requires every reply to keep the conversation alive with a question.
function endsWithQuestion(text) {
  const tail = meaningfulTail(text);
  if (!tail) return false;
  const closing = tail.slice(-QUESTION_TAIL_CHARS);
  if (/[?？]/.test(closing)) return true;
  return QUESTION_MARKERS.test(closing);
}

const hasThai = (text) => /[\u0E00-\u0E7F]/.test(String(text ?? ''));

function textCheck(name, value, { min = 1, max = Infinity, question = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) return { name, pass: false, detail: `สั้นเกินไป (${text.length} ตัวอักษร)` };
  if (text.length > max) return { name, pass: false, detail: `ยาวเกินไป (${text.length} ตัวอักษร)` };
  if (!hasThai(text)) return { name, pass: false, detail: 'ไม่มีข้อความภาษาไทย' };
  if (question && !endsWithQuestion(text)) {
    return { name, pass: false, detail: `ไม่ได้จบด้วยคำถาม — "${text.slice(-60)}"` };
  }
  return { name, pass: true, detail: '' };
}

function rangeCheck(name, value, min, max) {
  const pass = Number.isFinite(value) && value >= min && value <= max;
  return { name, pass, detail: pass ? '' : `ได้ ${value} (ต้องอยู่ ${min}–${max})` };
}

function turnChecks(answer) {
  return [
    rangeCheck('stageDetected 1–6', answer.stageDetected, 1, 6),
    rangeCheck('toneScore 1–5', answer.toneScore, 1, 5),
    textCheck('customerReply', answer.customerReply, { min: 6, max: 600 }),
    textCheck('customerMood', answer.customerMood, { max: 40 }),
    textCheck('sopAccuracyNote', answer.sopAccuracyNote, { min: 8, max: 500 }),
    textCheck('coachingTip', answer.coachingTip, { min: 8, max: 500 }),
    textCheck('betterExample', answer.betterExample, { min: 8, max: 600, question: true }),
  ];
}

function hintChecks(answer) {
  return [
    textCheck('focusPoint', answer.focusPoint, { min: 8, max: 500 }),
    textCheck('suggestedReply', answer.suggestedReply, { min: 8, max: 600, question: true }),
  ];
}

function evaluationChecks(answer) {
  const dimensions = Array.isArray(answer.dimensions) ? answer.dimensions : [];
  const checkpoints = Array.isArray(answer.checkpointResults) ? answer.checkpointResults : [];
  const strengths = Array.isArray(answer.strengths) ? answer.strengths : [];
  const improvements = Array.isArray(answer.improvements) ? answer.improvements : [];
  const scoresInRange = dimensions.every(
    (item) => Number.isFinite(item.score) && item.score >= 0 && item.score <= 100
  );
  return [
    rangeCheck('overallScore 0–100', answer.overallScore, 0, 100),
    textCheck('gradeLabel', answer.gradeLabel, { min: 4, max: 200 }),
    {
      name: 'dimensions ครบ 5 มิติ',
      pass: dimensions.length === 5,
      detail: dimensions.length === 5 ? '' : `ได้ ${dimensions.length} มิติ`,
    },
    { name: 'dimension score 0–100', pass: scoresInRange, detail: scoresInRange ? '' : 'มีคะแนนนอกช่วง' },
    {
      name: 'checkpointResults 3–8 ข้อ',
      pass: checkpoints.length >= 3 && checkpoints.length <= 8,
      detail: `ได้ ${checkpoints.length} ข้อ`,
    },
    {
      name: 'strengths 2–3 ข้อ',
      pass: strengths.length >= 2 && strengths.length <= 3,
      detail: `ได้ ${strengths.length} ข้อ`,
    },
    {
      name: 'improvements 2–3 ข้อ',
      pass: improvements.length >= 2 && improvements.length <= 3,
      detail: `ได้ ${improvements.length} ข้อ`,
    },
    textCheck('summaryVerdict', answer.summaryVerdict, { min: 20, max: 1500 }),
  ];
}

// Returns [{ name, pass, detail }] for one answer. A model call that failed is
// reported by the runner; here `text` is whatever the provider returned.
export function validateAnswer(fixture, text) {
  const raw = String(text ?? '').trim();

  if (fixture.endpoint === 'mentor') {
    return [
      textCheck('reply คุยกับผู้ฝึก', raw, { min: 40, max: 2500 }),
      {
        name: 'reply ไม่ใช่ JSON',
        pass: !/^\s*\{/.test(raw),
        detail: /^\s*\{/.test(raw) ? 'ได้ JSON ทั้งที่ควรเป็นข้อความ' : '',
      },
    ];
  }

  let answer;
  try {
    answer = JSON.parse(raw);
  } catch {
    return [
      { name: 'JSON ถูกต้อง', pass: false, detail: `parse ไม่ได้ — "${raw.slice(0, 120)}"` },
    ];
  }

  const schema =
    fixture.endpoint === 'turn'
      ? CHAT_TURN_SCHEMA
      : fixture.endpoint === 'hint'
        ? HINT_SCHEMA
        : EVALUATION_SCHEMA;
  const schemaErrors = typeErrors(answer, schema);
  const checks = [
    {
      name: 'ตรง schema (field ครบ ไม่เกิน)',
      pass: schemaErrors.length === 0,
      detail: schemaErrors.slice(0, 3).join(' · '),
    },
  ];

  if (fixture.endpoint === 'turn') checks.push(...turnChecks(answer));
  if (fixture.endpoint === 'hint') checks.push(...hintChecks(answer));
  if (fixture.endpoint === 'evaluate') checks.push(...evaluationChecks(answer));
  return checks;
}
