#!/usr/bin/env bun
// Provider eval gate for ChatCraft.
//
//   bun scripts/eval-prompts.mjs
//   bun scripts/eval-prompts.mjs --repeat 3 --json --out eval-results.json
//   bun scripts/eval-prompts.mjs --compare eval-providers.json
//
// It runs the fixtures in scripts/eval-fixtures.mjs through the real provider
// layer (selectLlmProvider) and reports, per provider, the fixture pass rate,
// the rule-check pass rate and the p50/p95 latency of the model calls. Nothing
// is deployed and no UI is touched; this is the check that tells you whether a
// model swap (LLM_MODEL / LLM_BASE_URL, or a free-tier model being retired)
// made the coaching worse.
//
// Every provider is configured the same way the app is: LLM_API_KEY switches to
// an OpenAI-compatible endpoint (LLM_BASE_URL, LLM_MODEL), otherwise Gemini is
// used. To compare providers in one run, pass --compare with:
//
//   [
//     { "label": "groq", "env": { "LLM_API_KEY": "$GROQ_API_KEY", "LLM_MODEL": "openai/gpt-oss-120b" } },
//     { "label": "gemini", "env": { "GEMINI_API_KEY": "$GEMINI_API_KEY" } }
//   ]
//
// "$VAR" is read from the environment of this process, so no key is written to
// a file and none is ever printed.
//
// Coverage: chat/turn (both perspectives), chat/hint, chat/evaluate and
// mentor/chat. /api/tools/search and /api/tools/maps are not covered — they need
// Google grounding, which no fixture can mock.
//
// Exit codes: 0 = every provider reached the pass threshold, 1 = a provider is
// below it, 2 = configuration problem (missing key, bad --compare file).

import { readFileSync, writeFileSync } from 'node:fs';
import { selectLlmProvider, readGeneratedText } from '../src/shared/llmProvider.ts';
import { EVAL_FIXTURES, buildRequest, validateAnswer } from './eval-fixtures.mjs';

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_PASS = 0.9;

const usage = () => {
  console.log(`ใช้: bun scripts/eval-prompts.mjs [ตัวเลือก]

ตัวเลือก
  --repeat <n>      รันแต่ละ fixture ซ้ำ n ครั้ง เพื่อดู latency ที่นิ่งขึ้น (ค่าเริ่มต้น: 1)
  --only <list>     เฉพาะ endpoint ที่ระบุ เช่น turn,hint (ค่าเริ่มต้น: ทั้งหมด)
  --model <id>      บังคับโมเดลเดียว (ค่าเริ่มต้น: ตัวแรกของ provider.models)
  --timeout <ms>    เวลารอสูงสุดต่อการเรียกโมเดล (ค่าเริ่มต้น: ${DEFAULT_TIMEOUT_MS})
  --min-pass <0-1>  เกณฑ์ผ่านของสัดส่วน fixture (ค่าเริ่มต้น: ${DEFAULT_MIN_PASS})
  --compare <file>  เทียบหลาย provider ในรอบเดียว (ไฟล์ JSON ตามรูปแบบในหัวสคริปต์)
  --out <file>      เขียนผลลัพธ์เป็น JSON ลงไฟล์
  --json            พิมพ์ผลลัพธ์เป็น JSON แทนตาราง
  -h, --help        แสดงข้อความนี้

ผู้ให้บริการเลือกจาก env เหมือนแอปจริง: มี LLM_API_KEY → OpenAI-compatible
(LLM_BASE_URL/LLM_MODEL) ไม่มี → Gemini (GEMINI_API_KEY)

รหัสออก
  0  ทุก provider ผ่านเกณฑ์
  1  มี provider ที่ต่ำกว่าเกณฑ์
  2  ตั้งค่าไม่ครบ (ไม่มีคีย์ / ไฟล์ --compare ผิดรูปแบบ)`);
};

function parseArgs(argv) {
  const options = {
    repeat: 1,
    only: [],
    model: '',
    timeout: DEFAULT_TIMEOUT_MS,
    minPass: DEFAULT_MIN_PASS,
    compare: '',
    out: '',
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`ตัวเลือก ${arg} ต้องมีค่า`);
    if (arg === '--repeat') options.repeat = Math.max(1, Number(value) || 1);
    else if (arg === '--only') options.only = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--model') options.model = value.trim();
    else if (arg === '--timeout') options.timeout = Math.max(1_000, Number(value) || 0);
    else if (arg === '--min-pass') options.minPass = Math.min(1, Math.max(0, Number(value)));
    else if (arg === '--compare') options.compare = value;
    else if (arg === '--out') options.out = value;
    else throw new Error(`ไม่รู้จักตัวเลือก ${arg}`);
    i += 1;
  }
  return options;
}

function resolveEnv(source) {
  const env = {};
  for (const [name, raw] of Object.entries(source)) {
    if (typeof raw !== 'string') continue;
    const match = /^\$([A-Z0-9_]+)$/.exec(raw.trim());
    if (match) {
      const value = process.env[match[1]];
      if (!value) throw new Error(`ไม่พบตัวแปร env ${match[1]} ที่ --compare อ้างถึง`);
      env[name] = value;
    } else {
      env[name] = raw;
    }
  }
  return env;
}

function loadSpecs(options) {
  if (!options.compare) return [{ label: '', env: { ...process.env } }];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(options.compare, 'utf8'));
  } catch (error) {
    throw new Error(`อ่านไฟล์ --compare ไม่ได้ (${error.message})`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ไฟล์ --compare ต้องเป็น array ที่มีอย่างน้อย 1 provider');
  }
  return parsed.map((entry, index) => ({
    label: String(entry?.label || `provider-${index + 1}`),
    env: resolveEnv(entry?.env ?? {}),
  }));
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

const ms = (value) => (value === null ? '—' : `${value.toLocaleString('en-US')} ms`);
const pct = (value) => `${(value * 100).toFixed(1)}%`;

async function runFixture(provider, model, fixture, options) {
  let body;
  try {
    body = buildRequest(fixture);
  } catch (error) {
    return { fixture, ms: 0, checks: [{ name: 'สร้าง request', pass: false, detail: error.message }] };
  }

  const startedAt = Date.now();
  let text = '';
  let callError = '';
  try {
    const data = await withTimeout(provider.generate(model, body), options.timeout);
    text = readGeneratedText(data);
  } catch (error) {
    callError = error instanceof Error ? error.message : String(error);
  }
  const duration = Date.now() - startedAt;

  const checks = callError
    ? [{ name: 'เรียกโมเดลสำเร็จ', pass: false, detail: callError.slice(0, 200) }]
    : validateAnswer(fixture, text);
  return { fixture, ms: duration, checks, text, callError };
}

async function runProvider(spec, options) {
  const provider = selectLlmProvider(spec.env);
  const requiredKey = provider.kind === 'gemini' ? 'GEMINI_API_KEY' : 'LLM_API_KEY';
  if (!spec.env[requiredKey]?.trim()) {
    throw new Error(
      `${spec.label || provider.label}: ไม่พบ ${requiredKey} — ตั้งค่าใน env หรือชี้ผ่าน --compare`
    );
  }

  const model = options.model || provider.models[0];
  const fixtures = EVAL_FIXTURES.filter(
    (fixture) => options.only.length === 0 || options.only.includes(fixture.endpoint)
  );
  if (fixtures.length === 0) throw new Error(`ไม่มี fixture ของ endpoint: ${options.only.join(',')}`);

  const runs = [];
  for (const fixture of fixtures) {
    for (let attempt = 0; attempt < options.repeat; attempt += 1) {
      // Sequential on purpose: parallel calls hide per-request latency and trip
      // free-tier rate limits, which would make the report meaningless.
      runs.push(await runFixture(provider, model, fixture, options));
    }
  }

  const passed = runs.filter((run) => run.checks.every((check) => check.pass));
  const totalChecks = runs.reduce((sum, run) => sum + run.checks.length, 0);
  const passedChecks = runs.reduce(
    (sum, run) => sum + run.checks.filter((check) => check.pass).length,
    0
  );
  const latencies = runs.map((run) => run.ms).sort((a, b) => a - b);
  const perEndpoint = {};
  for (const run of runs) {
    (perEndpoint[run.fixture.endpoint] ??= []).push(run.ms);
  }
  const endpointLatency = Object.fromEntries(
    Object.entries(perEndpoint).map(([endpoint, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [endpoint, { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }];
    })
  );

  return {
    label: spec.label || provider.label,
    providerLabel: provider.label,
    kind: provider.kind,
    model,
    fixtures: fixtures.length,
    repeat: options.repeat,
    passRate: runs.length === 0 ? 0 : passed.length / runs.length,
    passedRuns: passed.length,
    totalRuns: runs.length,
    checkRate: totalChecks === 0 ? 0 : passedChecks / totalChecks,
    passedChecks,
    totalChecks,
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      min: latencies[0] ?? null,
      max: latencies[latencies.length - 1] ?? null,
    },
    endpointLatency,
    runs: runs.map((run) => ({
      fixture: run.fixture.id,
      endpoint: run.fixture.endpoint,
      ms: run.ms,
      passed: run.checks.every((check) => check.pass),
      checks: run.checks,
    })),
  };
}

function printProviderReport(report) {
  console.log(`provider : ${report.providerLabel}`);
  console.log(`model    : ${report.model} (${report.kind})`);
  console.log(
    `fixtures : ${report.fixtures} · รัน ${report.totalRuns} ครั้ง (repeat ${report.repeat})\n`
  );

  for (const run of report.runs) {
    const passedCount = run.checks.filter((check) => check.pass).length;
    const status = run.passed ? 'PASS' : 'FAIL';
    console.log(
      `${status}  ${run.fixture.padEnd(28)} ${run.endpoint.padEnd(9)} ${String(
        passedCount
      ).padStart(2)}/${run.checks.length} checks ${ms(run.ms).padStart(10)}`
    );
    if (!run.passed) {
      for (const check of run.checks.filter((item) => !item.pass)) {
        console.log(`        · ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      }
    }
  }
  console.log('');

  const endpoints = Object.entries(report.endpointLatency)
    .map(([endpoint, value]) => `${endpoint} p50 ${ms(value.p50)}`)
    .join(' · ');
  console.log(
    `ผ่าน ${report.passedRuns}/${report.totalRuns} (${pct(report.passRate)}) · checks ${
      report.passedChecks
    }/${report.totalChecks} (${pct(report.checkRate)})`
  );
  console.log(
    `latency รวม p50 ${ms(report.latency.p50)} · p95 ${ms(report.latency.p95)} · min ${ms(
      report.latency.min
    )} · max ${ms(report.latency.max)}`
  );
  if (endpoints) console.log(`latency แยก endpoint: ${endpoints}`);
}

function printComparison(reports, minPass) {
  const header = ['provider', 'ผ่าน', 'checks', 'p50', 'p95'].map((title, index) =>
    index === 0 ? title.padEnd(34) : title.padStart(14)
  );
  console.log(header.join(' ').trimEnd());
  console.log('-'.repeat(34 + 14 * 4 + 4));
  for (const report of reports) {
    const cells = [
      `${report.label}`.padEnd(34),
      `${report.passedRuns}/${report.totalRuns} (${pct(report.passRate)})`.padStart(14),
      `${report.passedChecks}/${report.totalChecks}`.padStart(14),
      ms(report.latency.p50).padStart(14),
      ms(report.latency.p95).padStart(14),
    ];
    console.log(`${cells.join(' ')}${report.passRate >= minPass ? '' : '  ← ต่ำกว่าเกณฑ์'}`);
  }
}

async function main() {
  let options;
  let specs;
  try {
    options = parseArgs(process.argv.slice(2));
    specs = loadSpecs(options);
  } catch (error) {
    console.error(`ตั้งค่าไม่ถูกต้อง: ${error.message}`);
    process.exit(2);
  }

  const reports = [];
  let configurationError = '';
  for (const spec of specs) {
    try {
      reports.push(await runProvider(spec, options));
    } catch (error) {
      configurationError = error.message;
      console.error(`ตั้งค่าไม่ถูกต้อง: ${error.message}`);
      break;
    }
  }
  if (configurationError) process.exit(2);

  const gatePassed = reports.every((report) => report.passRate >= options.minPass);

  if (options.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      minPass: options.minPass,
      passed: gatePassed,
      providers: reports,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    if (reports.length > 1) {
      printComparison(reports, options.minPass);
      console.log('');
    }
    for (const report of reports) {
      if (reports.length > 1) console.log(`=== ${report.label} ===`);
      printProviderReport(report);
      console.log(
        `GATE: ${report.passRate >= options.minPass ? 'PASS' : 'FAIL'} (เกณฑ์ ${pct(
          options.minPass
        )})\n`
      );
    }
  }

  if (options.out) {
    writeFileSync(
      options.out,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          minPass: options.minPass,
          passed: gatePassed,
          providers: reports,
        },
        null,
        2
      ),
      'utf8'
    );
    if (!options.json) console.log(`เขียนผลลัพธ์ลง ${options.out}`);
  }

  process.exit(gatePassed ? 0 : 1);
}

await main();
