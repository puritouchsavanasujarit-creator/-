#!/usr/bin/env bun
// Consistency guard: the agent FAQ must not claim anything the playbook does not.
//
//   bun scripts/check-faq.mjs              ตรวจ FAQ จริง + self-check ของตัวตรวจ
//   bun scripts/check-faq.mjs --self-check ตรวจเฉพาะ self-check (ไม่แตะข้อมูลจริง)
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
// self-check: ตัวตรวจนี้ตัดสินว่า FAQ ผ่านหรือไม่ ถ้าตัวตรวจเองเสีย (เช่นยอมทุก
// ข้อความ) ทุกอย่างจะ "ผ่าน" อย่างไร้ความหมาย จึงมี FAQ_SELF_CHECK_CASES ที่ป้อน
// ข้อมูลปลอมให้ตัวตรวจชุดเดียวกับที่ใช้ตรวจจริง แล้วยืนยันว่ายังจับได้ — รันทุก
// เคสด้วยคำสั่งเดียวข้างบน ไม่เขียนไฟล์และไม่ใช้เครือข่าย
//
// สิ่งที่ยังตรวจไม่ได้: สคริปต์ไม่ได้เข้าใจความหมาย จึงยังไม่จับ (ก) เงื่อนไขที่
// กลับด้าน (คู่มือบอก "ไม่เกิน 25 กม." แต่ FAQ เขียน "เกิน 25 กม.") (ข) support ที่
// มีอยู่จริงแต่ไม่ได้รับรองเงื่อนไขนั้นจริง ๆ และ (ค) ตรรกะที่ขัดกันเองระหว่างสอง
// คำถาม — สามข้อนี้ยังต้องใช้คนอ่าน
//
// Exit codes: 0 = สอดคล้องและ self-check ผ่าน, 1 = พบข้อความที่คู่มือไม่มีหรือ
// self-check ไม่ผ่าน

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

// ตรวจ FAQ หนึ่งชุดกับคู่มือ — รับ groups เข้ามาเพื่อให้ self-check ป้อนข้อมูลปลอม
// เข้าตัวตรวจชุดเดียวกับที่ใช้ตรวจของจริงได้
export function checkFaqGroups(groups) {
  const problems = [];
  const usedDerived = new Set();
  let itemCount = 0;

  for (const group of groups) {
    for (const item of group.items) {
      itemCount += 1;
      const where = `${group.id}/${item.id}`;
      const text = [item.question, item.answer, item.script ?? ''].join('\n');
      let anchored = false;

      if (item.reference) {
        const cited = normalizeNumbers(item.reference).trim();
        const known =
          normalizeNumbers(dataSource).includes(cited) ||
          normalizeNumbers(viewSource).includes(cited);
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

  return { problems, itemCount };
}

// ---- self-check: พิสูจน์ว่าตัวตรวจยังแยกของปลอมออกจากของจริง ----------------

function itemById(groups, id) {
  for (const group of groups) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item;
  }
  throw new Error(`ไม่พบคำถาม id "${id}" — เคส self-check ต้องอัปเดตตามข้อมูล FAQ`);
}

const cloneFaq = () => structuredClone(AGENT_FAQ_GROUPS);

const FAKE_NUMBER = '98765';
const FAKE_SUPPORT = 'รับประกันตลอดชีพทุกกรณีไม่ว่าลูกค้าจะแจ้งอะไร';
const NO_ANCHOR_TEXT = 'โดรนขนส่งแบบอัตโนมัติทำงานทุกวัน';

// แต่ละเคส: `expected` = ข้อความที่ต้องโผล่ในปัญหา (null = ต้องผ่านสะอาด)
// `build` คืน FAQ ชุดที่แก้แล้ว โดยเริ่มจาก clone ทุกครั้ง
const FAQ_SELF_CHECK_CASES = [
  {
    name: 'FAQ จริงผ่านทุกกติกา',
    expected: null,
    build: () => cloneFaq(),
  },
  {
    name: 'เงื่อนไขปลอมที่คู่มือไม่มี',
    expected: 'เงื่อนไข "ห้าม"',
    build: () => {
      const groups = cloneFaq();
      itemById(groups, 'shipping-free-threshold').answer +=
        ' และห้ามโทรหาลูกค้าตอนกลางคืนโดยไม่ได้รับอนุญาต';
      return groups;
    },
  },
  {
    name: 'ข้อยกเว้นปลอมที่คู่มือไม่มีประโยคเดียวกัน',
    expected: 'ข้อยกเว้น "เฉพาะ"',
    build: () => {
      const groups = cloneFaq();
      itemById(groups, 'stock-swap').answer +=
        ' · เฉพาะเส้นทางน้ำท่วมสูงที่รถเล็กเข้าไม่ได้';
      return groups;
    },
  },
  {
    name: 'support ที่แต่งขึ้นเอง',
    expected: `support "${FAKE_SUPPORT}"`,
    build: () => {
      const groups = cloneFaq();
      itemById(groups, 'after-sales-quality-claim').support = FAKE_SUPPORT;
      return groups;
    },
  },
  {
    name: 'คำถามที่ไม่มีจุดอ้างอิงในคู่มือเลย',
    expected: 'ไม่มีจุดอ้างอิง',
    build: () => {
      const groups = cloneFaq();
      const item = itemById(groups, 'after-sales-storage');
      item.question = `${NO_ANCHOR_TEXT}หรือไม่`;
      item.answer = NO_ANCHOR_TEXT;
      delete item.script;
      delete item.reference;
      delete item.support;
      return groups;
    },
  },
  {
    name: 'ตัวเลขที่คู่มือไม่มี',
    expected: `ตัวเลข "${FAKE_NUMBER}"`,
    build: () => {
      const groups = cloneFaq();
      itemById(groups, 'stock-quality').answer += ` แจ้งล่วงหน้าอย่างน้อย ${FAKE_NUMBER} วัน`;
      return groups;
    },
  },
  {
    name: 'support ที่มีจริงทำให้เงื่อนไขผ่านได้',
    expected: null,
    build: () => {
      const groups = cloneFaq();
      itemById(groups, 'after-sales-delay').support = 'เส้นทางน้ำท่วมสูงจัดส่งไม่ได้';
      return groups;
    },
  },
  {
    name: 'ถอด support ออกแล้วเงื่อนไขเดิมต้องไม่ผ่าน',
    expected: 'เงื่อนไข "ไม่ได้"',
    build: () => {
      const groups = cloneFaq();
      delete itemById(groups, 'after-sales-delay').support;
      return groups;
    },
  },
];

export function runFaqSelfCheck() {
  return FAQ_SELF_CHECK_CASES.map((testCase) => {
    let problems;
    try {
      problems = checkFaqGroups(testCase.build()).problems;
    } catch (error) {
      return { name: testCase.name, pass: false, detail: error.message };
    }

    if (testCase.expected === null) {
      return {
        name: testCase.name,
        pass: problems.length === 0,
        detail: problems.length === 0 ? '' : `คาดว่าจะผ่าน แต่พบ ${problems.length} จุด: ${problems.join(' | ')}`,
      };
    }

    const found = problems.some((problem) => problem.includes(testCase.expected));
    return {
      name: testCase.name,
      pass: found,
      detail: found ? '' : `ไม่พบปัญหา "${testCase.expected}" (ได้: ${problems.join(' | ') || 'ไม่มีปัญหาเลย'})`,
    };
  });
}

// ---- CLI --------------------------------------------------------------------

function usage() {
  console.log(`ใช้: bun scripts/check-faq.mjs [--self-check]`);
}

function printSelfCheckChecks(checks) {
  for (const check of checks) {
    console.log(`${check.pass ? 'OK  ' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
}

function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }

  const checks = runFaqSelfCheck();
  const failed = checks.filter((check) => !check.pass);

  // --self-check: ตรวจเฉพาะตัวตรวจ ไม่อ่าน FAQ จริงในฐานะ "คำตอบ" และไม่เขียนไฟล์
  if (argv.includes('--self-check')) {
    printSelfCheckChecks(checks);
    console.log(`\nself-check : ${checks.length - failed.length}/${checks.length} ผ่าน (ไม่ใช้เครือข่าย)`);
    process.exit(failed.length === 0 ? 0 : 1);
  }

  const { problems, itemCount } = checkFaqGroups(AGENT_FAQ_GROUPS);

  if (problems.length) {
    console.error(`FAQ ไม่สอดคล้องกับคู่มือ (${problems.length} จุด จาก ${itemCount} คำถาม):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `FAQ สอดคล้องกับคู่มือ: ${itemCount} คำถาม, ${playbookNumbers.size} ตัวเลขในคู่มือ, ตรวจเงื่อนไขข้อความล้วน ${CONDITION_CUES.length} คำ`,
  );

  if (failed.length) {
    for (const check of failed) console.error(`FAIL  ${check.name} — ${check.detail}`);
    console.error(
      `self-check ไม่ผ่าน ${failed.length}/${checks.length} เคส — ตัวตรวจเสีย ต้องแก้ก่อนเชื่อผลตรวจ FAQ`,
    );
    process.exit(1);
  }

  console.log(`self-check : ${checks.length}/${checks.length} ผ่าน (ไม่ใช้เครือข่าย)`);
}

if (import.meta.main) main(process.argv.slice(2));
