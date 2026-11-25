#!/usr/bin/env bun
// Consistency guard: the agent FAQ must not claim anything the playbook does not.
//
//   bun scripts/check-faq.mjs
//
// ตรวจสี่อย่าง
//   1. ทุก `reference` ของ FAQ ต้องมีอยู่จริงในคู่มือ (playbookData.ts) หรือในหัวข้อ
//      ที่แสดงบนหน้า Playbook (PlaybookView.tsx) — ถ้ามีการเปลี่ยนชื่อหัวข้อ
//      reference ที่ค้างจะ fail ไม่ใช่ปล่อยให้ FAQ อ้างส่วนที่ไม่มีแล้ว
//   2. ทุกตัวเลขในคำถาม/คำตอบ/สคริปต์ของ FAQ ต้องมีอยู่ในคู่มือ ตัวเลขที่ไม่มีใน
//      ข้อความเพราะเป็นตัวอย่างที่คำนวณจากอัตราในคู่มือ (เช่น 209 บาท ของระยะ
//      30 กม.) ต้องประกาศใน DERIVED_EXAMPLES พร้อมค่าที่คำนวณจาก calculateShipping
//      จริง ๆ สคริปต์จะเทียบค่าให้ ถ้าอัตราในคู่มือเปลี่ยนแล้วตัวอย่างยังเป็นค่าเก่า
//      จะ fail และรายการที่ไม่ได้ใช้อีกแล้วก็ fail เพื่อไม่ให้รายการยกเว้นงอกเงย
//   3. เงื่อนไขที่เป็นข้อความล้วน (ไม่มีตัวเลขและไม่อ้างหัวข้อ) — clause ในคำตอบหรือ
//      สคริปต์ที่มีคำบอกเงื่อนไข/ข้อยกเว้น ("ยกเว้น", "ห้าม", "ไม่ได้", "เท่านั้น",
//      "ขึ้นไป", "ฟรี", "งด", "จำกัด", "ประกัน", "มัดจำ", ...) ต้องรองรับด้วยอย่างใด
//      อย่างหนึ่ง
//        (ก) ข้อความที่ตรงกับคู่มือติดกันอย่างน้อย LONG_MATCH_CHARS ตัวอักษร หรือ
//        (ข) `support` ของคำถามข้อนั้น ซึ่งต้องเป็นข้อความที่คัดมาจากคู่มือจริง
//            (สคริปต์ตรวจว่ามีอยู่ทุกตัวอักษรในคู่มือ) และต้องมีข้อความตรงกับ
//            clause ที่มันรองรับอย่างน้อย SUPPORT_MATCH_CHARS ตัวอักษร
//   4. คำบอก "ข้อยกเว้น" โดยเฉพาะ ("ยกเว้น", "เว้นแต่", "นอกจาก", "เฉพาะ") ต้องมี
//      ประโยคในคู่มือที่ใช้คำเดียวกันและมีข้อความตรงกับ clause นั้นด้วย ไม่ใช่แค่คำ
//      "ยกเว้น" โผล่ที่อื่นในคู่มือ (เช่นเรื่องภาษี) แล้วจะเอาไปอ้างข้อยกเว้นใหม่ได้
//
// ทำไมต้องมี support: การเทียบข้อความอย่างเดียวแยก "ถอดความจากคู่มือ" ออกจาก
// "แต่งเงื่อนไขใหม่โดยใช้ถ้อยคำคล้ายคู่มือ" ได้ไม่แน่นอน จึงให้คำถามประกาศข้อความ
// ต้นทาง แล้วให้สคริปต์คุมว่าข้อความนั้นมีจริงทุกตัวอักษรและตรงกับเงื่อนไขที่อ้าง
//
// สิ่งที่ยังตรวจไม่ได้: สคริปต์ไม่ได้เข้าใจความหมาย จึงยังไม่จับ (ก) เงื่อนไขที่
// กลับด้าน (คู่มือบอก "ไม่เกิน 25 กม." แต่ FAQ เขียน "เกิน 25 กม.") (ข) support ที่
// มีอยู่จริงแต่ไม่ได้รับรองเงื่อนไขนั้นจริง ๆ และ (ค) ตรรกะที่ขัดกันเองระหว่างสอง
// คำถาม — สามข้อนี้ยังต้องใช้คนอ่าน
//
// Exit codes: 0 = สอดคล้อง, 1 = พบข้อความที่คู่มือไม่มี

import { readFileSync } from 'node:fs';
import { AGENT_FAQ_GROUPS } from '../src/data/agentFaqData.ts';
import * as playbook from '../src/data/playbookData.ts';

const dataSource = readFileSync(new URL('../src/data/playbookData.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/components/PlaybookView.tsx', import.meta.url), 'utf8');

// ตัวเลขที่ FAQ ยกเป็นตัวอย่างจากการคำนวณ ไม่ปรากฏเป็นตัวอักษรในคู่มือ
// ทุกตัวต้องพิสูจน์ได้จากฟังก์ชันคิดค่าส่งของคู่มือ ไม่ใช่รายการยกเว้นลอย ๆ
const DERIVED_EXAMPLES = [
  {
    number: '209',
    why: 'ตัวอย่างค่าส่งระยะ 30 กม. = 159 + (30 − 25) × 10',
    computed: () => playbook.calculateShipping({ distanceKm: 30, orderSubtotal: 0 }).fee,
  },
];

// id/code เป็นชื่อภายใน ไม่ใช่ข้อความนโยบาย จึงไม่ควรใช้ยืนยันตัวเลขใน FAQ
const SKIP_KEYS = new Set(['id', 'code', 'imageKey', 'key']);

// คำที่ทำให้ clause หนึ่งกลายเป็น "การอ้างเงื่อนไข/ข้อยกเว้น" ซึ่งต้องมีที่มาในคู่มือ
const CONDITION_CUES = [
  'ยกเว้น',
  'ห้าม',
  'ไม่ได้',
  'ไม่ได้รับ',
  'ไม่มีสิทธิ์',
  'ไม่เกิน',
  'เท่านั้น',
  'ขึ้นไป',
  'ฟรี',
  'งด',
  'จำกัด',
  'อนุญาต',
  'ประกัน',
  'ลดได้',
  'ลดราคา',
  'มัดจำ',
  'เฉพาะ',
];

// คำบอกข้อยกเว้น ต้องมีประโยคข้อยกเว้นเดียวกันในคู่มือ ไม่ใช่แค่คำโผล่ที่อื่น
const EXCEPTION_CUES = ['ยกเว้น', 'เว้นแต่', 'นอกจาก', 'เฉพาะ'];

// ข้อความที่ยกมาจากคู่มือติดกันเท่านี้ = clause รองรับตัวเองได้
const LONG_MATCH_CHARS = 12;
// ข้อความที่ต้องตรงกับ `support` หรือประโยคข้อยกเว้นของคู่มือเป็นอย่างน้อย
const SUPPORT_MATCH_CHARS = 8;
// ความยาวสูงสุดที่ไล่หาข้อความตรงกัน (ตัดการค้นที่ยาวเกินจำเป็น)
const MAX_PROBE_CHARS = 16;

const problems = [];
const usedDerived = new Set();

function normalizeNumbers(text) {
  return text
    .replace(/[,\u200b]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[\u0e50-\u0e59]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50));
}

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

function numbersIn(text) {
  return [...new Set(normalizeNumbers(text).match(NUMBER_PATTERN) ?? [])];
}

const corpusParts = [];
(function collect(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    corpusParts.push(String(value));
    return;
  }
  if (typeof value === 'function') {
    // ฟังก์ชันคิดค่าส่งถือเป็นแหล่งความจริงของตัวเลขค่าส่ง
    corpusParts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(collect);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!SKIP_KEYS.has(key)) collect(child);
    }
  }
})(playbook);

const playbookNumbers = new Set(numbersIn(corpusParts.join('\n')));

// ข้อความคู่มือแบบไม่มีช่องว่าง/เครื่องหมาย ใช้หาว่า clause ใน FAQ มีที่มาจากคู่มือไหม
function normalizeForMatch(text) {
  return text.replace(/[^\u0e00-\u0e7fa-zA-Z0-9]/g, '').toLowerCase();
}

const playbookBlob = normalizeForMatch(corpusParts.join('\n'));

// ประโยคของคู่มือ ใช้ตรวจว่าข้อยกเว้นที่ FAQ อ้างมีประโยคข้อยกเว้นในคู่มือจริง
const playbookSentences = corpusParts
  .flatMap((part) => String(part).split(/\n|·/))
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length > 0);

// ความยาวของข้อความสองท่อนที่ตรงกันติดกันมากที่สุด (ไม่เกิน MAX_PROBE_CHARS)
// ฟังก์ชันนี้ไม่ผูกกับ threshold ใด ๆ ผู้เรียกเทียบกับค่าที่ตัวเองใช้ และรายงาน
// ค่าจริงได้แม้จะต่ำกว่าเกณฑ์
function sharedRunChars(a, b) {
  const limit = Math.min(MAX_PROBE_CHARS, a.length, b.length);
  for (let length = limit; length > 0; length -= 1) {
    for (let i = 0; i + length <= a.length; i += 1) {
      if (b.includes(a.slice(i, i + length))) return length;
    }
  }
  return 0;
}

const quotedChars = (text) => sharedRunChars(normalizeForMatch(text), playbookBlob);

// แยก clause ด้วยบรรทัดใหม่, ตัวคั่น "·" และคำเชื่อม เพื่อให้ข้อความที่ต่อท้าย
// ประโยคจริงถูกตรวจแยก ไม่รอดเพราะประโยคยาวมีข้อความจริงปนอยู่
function clausesOf(text) {
  return text
    .split(/\n|·|\s+และ|\s+แต่/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function conditionCueIn(clause) {
  return CONDITION_CUES.find((cue) => clause.includes(cue));
}

function exceptionCueIn(clause) {
  return EXCEPTION_CUES.find((cue) => clause.includes(cue));
}

for (const group of AGENT_FAQ_GROUPS) {
  for (const item of group.items) {
    const where = `${group.id}/${item.id}`;
    const text = [item.question, item.answer, item.script ?? ''].join('\n');
    let anchored = false;

    if (item.reference) {
      const cited = normalizeNumbers(item.reference).trim();
      const known =
        normalizeNumbers(dataSource).includes(cited) || normalizeNumbers(viewSource).includes(cited);
      if (!known) {
        problems.push(`${where}: reference "${item.reference}" ไม่มีในคู่มือหรือหน้า Playbook`);
      } else {
        anchored = true;
      }
    }

    for (const number of numbersIn(text)) {
      if (playbookNumbers.has(number)) {
        anchored = true;
        continue;
      }

      const derived = DERIVED_EXAMPLES.find((entry) => entry.number === number);
      if (!derived) {
        problems.push(`${where}: ตัวเลข "${number}" ไม่มีในคู่มือ`);
        continue;
      }
      usedDerived.add(number);
      anchored = true;
      const computed = derived.computed();
      if (String(computed) !== number) {
        problems.push(
          `${where}: ตัวอย่าง "${number}" ไม่ตรงกับค่าที่คู่มือคำนวณได้แล้ว (${computed}) — ${derived.why}`,
        );
      }
    }

    // support ต้องเป็นข้อความที่คัดมาจากคู่มือจริง ไม่ใช่ถ้อยคำที่แต่งขึ้น
    const supports = [];
    if (item.support) {
      const normalizedSupport = normalizeForMatch(item.support);
      if (!playbookBlob.includes(normalizedSupport)) {
        problems.push(`${where}: support "${item.support}" ไม่มีอยู่ในคู่มือแบบตรงทุกตัวอักษร`);
      } else {
        supports.push(normalizedSupport);
      }
    }

    const supportChars = (clause) => {
      const normalizedClause = normalizeForMatch(clause);
      return supports.reduce(
        (best, support) => Math.max(best, sharedRunChars(normalizedClause, support)),
        0,
      );
    };

    // clause มีที่มาเมื่อข้อความยกจากคู่มือตรงกันติดกัน LONG_MATCH_CHARS ตัวอักษร
    // หรือถูกประกาศไว้ใน support แล้วตรงกับ clause ตั้งแต่ SUPPORT_MATCH_CHARS ตัวอักษร
    const backedByPlaybook = (clause) =>
      quotedChars(clause) >= LONG_MATCH_CHARS || supportChars(clause) >= SUPPORT_MATCH_CHARS;

    const textAnchored = clausesOf(text).some(backedByPlaybook);

    // ตรวจคำบอกเงื่อนไขจากคำตอบและสคริปต์เท่านั้น เพราะคำถามเป็นถ้อยคำที่ FAQ
    // ใช้ถามนำ (เช่น "กฎเหล็กที่ห้ามลืม...") ไม่ใช่ข้อความที่นโยบายต้องรองรับ
    for (const clause of clausesOf([item.answer, item.script ?? ''].join('\n'))) {
      const cue = conditionCueIn(clause);
      if (!cue) continue;

      if (!backedByPlaybook(clause)) {
        problems.push(
          `${where}: เงื่อนไข "${cue}" ไม่มีข้อความรองรับในคู่มือ (ตรงกับคู่มือ ${quotedChars(clause)} ตัวอักษร, support ตรง ${supportChars(clause)} ตัวอักษร) — "${clause}"`,
        );
        continue;
      }

      const exceptionCue = exceptionCueIn(clause);
      if (!exceptionCue) continue;

      const expected = normalizeForMatch(clause);
      const hasMatchingException = playbookSentences.some((sentence) => {
        const normalizedSentence = normalizeForMatch(sentence);
        return (
          normalizedSentence.includes(normalizeForMatch(exceptionCue)) &&
          sharedRunChars(expected, normalizedSentence) >= SUPPORT_MATCH_CHARS
        );
      });
      if (!hasMatchingException) {
        problems.push(
          `${where}: ข้อยกเว้น "${exceptionCue}" ไม่มีประโยคข้อยกเว้นเดียวกันในคู่มือ — "${clause}"`,
        );
      }
    }

    if (!anchored && !textAnchored) {
      problems.push(
        `${where}: ไม่มีจุดอ้างอิงในคู่มือเลย (ไม่มี reference, ไม่มีตัวเลขที่คู่มือมี, ไม่มีข้อความที่ตรงกับคู่มือ ${LONG_MATCH_CHARS} ตัวอักษร และไม่มี support)`,
      );
    }
  }
}

for (const entry of DERIVED_EXAMPLES) {
  if (!usedDerived.has(entry.number)) {
    problems.push(
      `DERIVED_EXAMPLES: "${entry.number}" ไม่ถูกใช้ใน FAQ แล้ว — ลบออกจากรายการยกเว้น`,
    );
  }
}

const itemCount = AGENT_FAQ_GROUPS.reduce((sum, group) => sum + group.items.length, 0);

if (problems.length) {
  console.error(`FAQ ไม่สอดคล้องกับคู่มือ (${problems.length} จุด จาก ${itemCount} คำถาม):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `FAQ สอดคล้องกับคู่มือ: ${itemCount} คำถาม, ${playbookNumbers.size} ตัวเลขในคู่มือ, ตรวจเงื่อนไขข้อความล้วน ${CONDITION_CUES.length} คำ`,
);
