#!/usr/bin/env bun
// Consistency guard: the agent FAQ must not claim anything the playbook does not.
//
//   bun scripts/check-faq.mjs
//
// ตรวจสองอย่าง
//   1. ทุก `reference` ของ FAQ ต้องมีอยู่จริงในคู่มือ (playbookData.ts) หรือในหัวข้อ
//      ที่แสดงบนหน้า Playbook (PlaybookView.tsx) — ถ้ามีการเปลี่ยนชื่อหัวข้อ
//      reference ที่ค้างจะ fail ไม่ใช่ปล่อยให้ FAQ อ้างส่วนที่ไม่มีแล้ว
//   2. ทุกตัวเลขในคำถาม/คำตอบ/สคริปต์ของ FAQ ต้องมีอยู่ในคู่มือ ตัวเลขที่ไม่มีใน
//      ข้อความเพราะเป็นตัวอย่างที่คำนวณจากอัตราในคู่มือ (เช่น 209 บาท ของระยะ
//      30 กม.) ต้องประกาศใน DERIVED_EXAMPLES พร้อมค่าที่คำนวณจาก calculateShipping
//      จริง ๆ สคริปต์จะเทียบค่าให้ ถ้าอัตราในคู่มือเปลี่ยนแล้วตัวอย่างยังเป็นค่าเก่า
//      จะ fail และรายการที่ไม่ได้ใช้อีกแล้วก็ fail เพื่อไม่ให้รายการยกเว้นงอกเงย
//
// สิ่งที่ตรวจไม่ได้: เงื่อนไขที่เป็นข้อความล้วน (ไม่มีการอ้างหัวข้อและไม่มีตัวเลข)
// เช่นการอธิบายเหตุผลทางภาษี — สคริปต์นี้ยืนยันเฉพาะหัวข้อที่อ้างและตัวเลขทุกตัว
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

for (const group of AGENT_FAQ_GROUPS) {
  for (const item of group.items) {
    const where = `${group.id}/${item.id}`;

    if (item.reference) {
      const cited = normalizeNumbers(item.reference).trim();
      const known =
        normalizeNumbers(dataSource).includes(cited) || normalizeNumbers(viewSource).includes(cited);
      if (!known) {
        problems.push(`${where}: reference "${item.reference}" ไม่มีในคู่มือหรือหน้า Playbook`);
      }
    }

    const text = [item.question, item.answer, item.script ?? ''].join('\n');
    for (const number of numbersIn(text)) {
      if (playbookNumbers.has(number)) continue;

      const derived = DERIVED_EXAMPLES.find((entry) => entry.number === number);
      if (!derived) {
        problems.push(`${where}: ตัวเลข "${number}" ไม่มีในคู่มือ`);
        continue;
      }
      usedDerived.add(number);
      const computed = derived.computed();
      if (String(computed) !== number) {
        problems.push(
          `${where}: ตัวอย่าง "${number}" ไม่ตรงกับค่าที่คู่มือคำนวณได้แล้ว (${computed}) — ${derived.why}`,
        );
      }
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

console.log(`FAQ สอดคล้องกับคู่มือ: ${itemCount} คำถาม, ${playbookNumbers.size} ตัวเลขในคู่มือ`);
