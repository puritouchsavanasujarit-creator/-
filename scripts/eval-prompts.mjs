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
// used. Requests carry reasoning_effort only when LLM_REASONING_EFFORT asks for
// it, since endpoints that do not accept the knob reject the whole call: low,
// medium or high sends that level, auto translates the request's thinkingConfig
// level, and unset (or off) omits the field. To compare providers in one run,
// pass --compare with:
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
// Before it calls any provider the gate runs its own self-check (the rule
// validators, no network): a validator that accepts everything would make every
// pass rate meaningless, so a failing self-check stops the run.
//
// Exit codes: 0 = every provider reached the pass threshold, 1 = a provider is
// below it or the gate's self-check failed, 2 = configuration problem (missing
// key, bad --compare file).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { selectLlmProvider, readGeneratedText } from '../src/shared/llmProvider.ts';
import { EVAL_FIXTURES, buildRequest, runSelfCheck, validateAnswer } from './eval-fixtures.mjs';

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_PASS = 0.9;
const DEFAULT_BASELINE_PATH = 'eval-baseline.json';
const DEFAULT_EPSILON = 0.05;
const P95_GROWTH_LIMIT = 0.3;
// A 30% rise over a 2 ms baseline is scheduler noise, not a slowdown, so the
// growth rule also needs this much absolute movement to fire.
const P95_NOISE_FLOOR_MS = 50;
const BASELINE_VERSION = 2;

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
  --baseline <file> เทียบกับ baseline ที่เคยยอมรับไว้ (ค่าเริ่มต้น: ${DEFAULT_BASELINE_PATH})
  --update-baseline เขียนผลรอบนี้เป็น baseline ใหม่ (แทนที่ไฟล์เดิม)
  --epsilon <0-1>   ยอมให้ pass rate ตกลงได้ไม่เกินค่านี้ก่อนนับว่าถดถอย (ค่าเริ่มต้น: ${DEFAULT_EPSILON})
  --self-check      รันเฉพาะ self-check ของตัวตรวจ (ไม่เรียกโมเดล ไม่ต้องมีคีย์)
  -h, --help        แสดงข้อความนี้

ผู้ให้บริการเลือกจาก env เหมือนแอปจริง: มี LLM_API_KEY → OpenAI-compatible
(LLM_BASE_URL/LLM_MODEL) ไม่มี → Gemini (GEMINI_API_KEY)

ตัวแปร env ที่มีผล
  LLM_API_KEY, LLM_BASE_URL, LLM_MODEL  เลือก endpoint และโมเดล OpenAI-compatible
  GEMINI_API_KEY                        ใช้เมื่อไม่มี LLM_API_KEY
  LLM_REASONING_EFFORT                  คุม reasoning_effort ที่ส่งไป
      low | medium | high               ส่งระดับนั้นทุก request
      auto                              แปลงจาก thinkingConfig ของ request
      ไม่ตั้ง / off                     ไม่ส่ง field นี้ (ค่าเริ่มต้น)
                                        (endpoint ที่ไม่รับค่านี้จะตอบ 400)

ก่อนวัด provider ทุกครั้งสคริปต์รัน self-check ของตัวตรวจเอง (ไม่ใช้เครือข่าย)
ถ้า self-check ไม่ผ่าน จะหยุดทันทีเพื่อไม่ให้ผลวัดหลอก

baseline: --baseline <ไฟล์> จะ fail เมื่อ
  · pass rate ตกลงเกิน --epsilon (ค่าเริ่มต้น ${DEFAULT_EPSILON})
  · p95 ช้าลงเกิน ${Math.round(P95_GROWTH_LIMIT * 100)}% ของ baseline (และต่างกันเกิน ${P95_NOISE_FLOOR_MS} ms กันเสียงรบกวน)
  · fixture ที่เคยผ่านครบทุกรอบ กลายเป็นมีรอบที่ไม่ผ่าน
  และจะเตือน (ไม่ fail) เมื่อ promptHash เปลี่ยน เพราะผลเทียบอาจไม่มีความหมาย
สร้าง baseline แรกด้วย --update-baseline (ต้องผ่านเกณฑ์ --min-pass ก่อนจึงจะบันทึก)
ถ้ารันด้วย --only จะเทียบเฉพาะ fixture ที่มีทั้งใน baseline และรอบนี้ โดยคำนวณ
pass rate กับ p95 ของฝั่ง baseline ใหม่จากชุดเดียวกัน (ไม่เอา p95 ของชุดเต็มมาเทียบ)

รันแค่ self-check ด้วยคำสั่งเดียว (ไม่ต้องมีคีย์):
  bun run eval:self-check

รหัสออก
  0  ทุก provider ผ่านเกณฑ์ และไม่ถดถอยเมื่อเทียบ baseline
  1  มี provider ที่ต่ำกว่าเกณฑ์, self-check ของ gate ไม่ผ่าน, หรือถดถอยกว่า baseline
  2  ตั้งค่าไม่ครบ (ไม่มีคีย์ / ไฟล์ --compare ผิดรูปแบบ / ไม่พบไฟล์ baseline)`);
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
    selfCheck: false,
    baseline: '',
    updateBaseline: false,
    epsilon: DEFAULT_EPSILON,
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
    if (arg === '--self-check') {
      options.selfCheck = true;
      continue;
    }
    if (arg === '--update-baseline') {
      options.updateBaseline = true;
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
    else if (arg === '--baseline') options.baseline = value;
    else if (arg === '--epsilon') options.epsilon = Math.min(1, Math.max(0, Number(value)));
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

  const fingerprint = promptFingerprint(fixtures);
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
    promptHash: fingerprint.combined,
    promptHashes: fingerprint.perFixture,
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

// Fingerprint of one set of fixtures: the same ids with the same prompt hash, in
// any order, give the same value — so a --only round compares the fingerprints of
// the fixtures it actually ran, not of the whole suite.
const hashOf = (ids, hashes) =>
  createHash('sha256')
    .update(
      [...ids]
        .sort()
        .map((id) => `${id}:${hashes?.[id] ?? 'missing'}`)
        .join('|')
    )
    .digest('hex')
    .slice(0, 16);

// A baseline is only meaningful for the prompt that produced it, so every fixture
// is fingerprinted over the request the app would actually send (instructions,
// history and response schema). A changed hash warns instead of failing: the new
// prompt may be better, but the comparison no longer answers the same question.
function promptFingerprint(fixtures) {
  const perFixture = {};
  for (const fixture of fixtures) {
    let canonical;
    try {
      const body = buildRequest(fixture);
      canonical = JSON.stringify({
        contents: body.contents ?? null,
        system: body.systemInstruction ?? null,
        schema: body.generationConfig?.responseSchema ?? null,
        thinking: body.generationConfig?.thinkingConfig ?? null,
      });
    } catch (error) {
      canonical = `unbuildable:${error.message}`;
    }
    perFixture[fixture.id] = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  }
  return { combined: hashOf(Object.keys(perFixture), perFixture), perFixture };
}

// Per-run samples, not pre-aggregated numbers: a later run with --only covers a
// subset of the fixtures, so the baseline side of the comparison has to be
// re-summarised over the same subset (see compareWithBaseline).
function buildBaseline(reports, options, selfCheckSummary) {
  return {
    version: BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    minPass: options.minPass,
    epsilon: options.epsilon,
    p95GrowthLimit: P95_GROWTH_LIMIT,
    selfCheck: selfCheckSummary,
    providers: reports.map((report) => ({
      label: report.label,
      model: report.model,
      kind: report.kind,
      promptHash: report.promptHash,
      promptHashes: report.promptHashes,
      samples: report.runs.map((run) => ({
        fixture: run.fixture,
        ms: run.ms,
        passed: run.passed,
      })),
    })),
  };
}

function readBaseline(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`ไม่พบไฟล์ baseline "${file}" — สร้างด้วย --update-baseline`);
    }
    throw new Error(`อ่านไฟล์ baseline "${file}" ไม่ได้ (${error.message})`);
  }
  if (!parsed || !Array.isArray(parsed.providers)) {
    throw new Error(`ไฟล์ baseline "${file}" ไม่ถูกต้อง (ต้องมี providers เป็น array)`);
  }
  if (parsed.version !== BASELINE_VERSION) {
    throw new Error(
      `baseline version ${parsed.version} ไม่ตรงกับ gate (${BASELINE_VERSION}) — สร้างใหม่ด้วย --update-baseline`
    );
  }
  return parsed;
}

function summarizeRuns(runs) {
  const passed = runs.filter((run) => run.passed).length;
  const latencies = runs.map((run) => run.ms).sort((a, b) => a - b);
  return {
    passRate: runs.length === 0 ? 0 : passed / runs.length,
    p95: percentile(latencies, 0.95),
  };
}

function compareWithBaseline(reports, baseline, options) {
  const failures = [];
  const warnings = [];
  const rows = [];
  const epsilon = Number.isFinite(options.epsilon) ? options.epsilon : DEFAULT_EPSILON;
  const remaining = new Map(baseline.providers.map((entry) => [entry.label, entry]));

  for (const report of reports) {
    const previous =
      remaining.get(report.label) ??
      baseline.providers.find((entry) => entry.model === report.model && entry.kind === report.kind);
    if (!previous) {
      warnings.push(`${report.label}: ยังไม่มี baseline ของ provider/model นี้ — ไม่ได้เทียบถดถอย`);
      continue;
    }
    remaining.delete(previous.label);

    const previousRuns = Array.isArray(previous.samples) ? previous.samples : [];
    const previousIds = new Set(previousRuns.map((run) => run.fixture));
    const currentIds = [...new Set(report.runs.map((run) => run.fixture))];
    // Only fixtures that ran in both rounds are comparable. --only narrows the
    // current side, so the baseline is re-summarised instead of using its
    // whole-set pass rate and p95, which cover different work.
    const scope = currentIds.filter((id) => previousIds.has(id));
    const notInBaseline = currentIds.filter((id) => !previousIds.has(id));
    if (scope.length === 0) {
      warnings.push(
        `${report.label}: ไม่มี fixture ที่ตรงกับ baseline (รอบนี้ ${currentIds.join(', ') || '—'}) — ไม่ได้เทียบถดถอย`
      );
      continue;
    }
    if (notInBaseline.length > 0) {
      warnings.push(`${report.label}: ${notInBaseline.join(', ')} ไม่อยู่ใน baseline — ไม่ได้เทียบ`);
    }
    const scoped = scope.length < previousIds.size;

    const base = summarizeRuns(previousRuns.filter((run) => scope.includes(run.fixture)));
    const current = summarizeRuns(report.runs.filter((run) => scope.includes(run.fixture)));

    const drop = base.passRate - current.passRate;
    if (drop > epsilon + 1e-9) {
      failures.push(
        `${report.label}: pass rate ตกจาก ${pct(base.passRate)} เป็น ${pct(current.passRate)} (เกิน epsilon ${pct(epsilon)})`
      );
    }

    const grewTooMuch = current.p95 > base.p95 * (1 + P95_GROWTH_LIMIT);
    const movedEnoughToMatter = current.p95 - base.p95 >= P95_NOISE_FLOOR_MS;
    if (Number.isFinite(base.p95) && base.p95 > 0 && grewTooMuch && movedEnoughToMatter) {
      failures.push(
        `${report.label}: p95 ช้าลงจาก ${ms(base.p95)} เป็น ${ms(current.p95)} (เกิน ${Math.round(
          P95_GROWTH_LIMIT * 100
        )}% และเกิน ${P95_NOISE_FLOOR_MS} ms)`
      );
    }

    const regressed = [];
    for (const id of scope) {
      const wasGreen = previousRuns
        .filter((run) => run.fixture === id)
        .every((run) => run.passed);
      if (!wasGreen) continue;
      if (report.runs.some((run) => run.fixture === id && !run.passed)) regressed.push(id);
    }
    if (regressed.length > 0) {
      failures.push(`${report.label}: fixture ที่เคยผ่านครบทุกรอบกลับไม่ผ่าน — ${regressed.join(', ')}`);
    }

    if (hashOf(scope, previous.promptHashes) !== hashOf(scope, report.promptHashes)) {
      const changed = scope.filter(
        (id) => previous.promptHashes?.[id] !== report.promptHashes[id]
      );
      warnings.push(
        `${report.label}: prompt/schema เปลี่ยนตั้งแต่ baseline${
          changed.length > 0 ? ` (${changed.join(', ')})` : ''
        } — ควรทบทวนผลแล้วอัปเดต baseline`
      );
    }

    rows.push({
      label: report.label,
      fixtures: scope.length,
      scoped,
      previousPassRate: base.passRate,
      passRate: current.passRate,
      previousP95: base.p95,
      p95: current.p95,
    });
  }

  for (const leftover of remaining.values()) {
    warnings.push(`${leftover.label}: มีใน baseline แต่ไม่ได้รันในรอบนี้`);
  }
  return { failures, warnings, rows, passed: failures.length === 0 };
}

function printBaselineVerdict(file, baseline, comparison) {
  console.log(`baseline : ${file} (${baseline.generatedAt})`);
  for (const row of comparison.rows) {
    console.log(
      `  ${row.label}: pass ${pct(row.previousPassRate)} → ${pct(row.passRate)} · p95 ${ms(
        row.previousP95
      )} → ${ms(row.p95)}${
        row.scoped ? ` (เทียบ ${row.fixtures} fixture ที่รันทั้งสองรอบ)` : ''
      }`
    );
  }
  for (const warning of comparison.warnings) console.log(`  เตือน: ${warning}`);
  for (const failure of comparison.failures) console.log(`  ถดถอย: ${failure}`);
  console.log(`BASELINE: ${comparison.passed ? 'PASS' : 'FAIL'}\n`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ตั้งค่าไม่ถูกต้อง: ${error.message}`);
    process.exit(2);
  }

  // The rule validators decide every pass/fail below, so prove they still tell a
  // good answer from a bad one before spending provider calls on them.
  const selfChecks = runSelfCheck();
  const selfCheckFailures = selfChecks.filter((check) => !check.pass);
  const selfCheckSummary = {
    total: selfChecks.length,
    passed: selfChecks.length - selfCheckFailures.length,
  };

  // --self-check is the one command that tests the checks themselves: no key, no
  // network, no provider — so the matrix can be run on its own in review or CI.
  if (options.selfCheck) {
    if (options.json) {
      console.log(JSON.stringify({ selfCheck: selfCheckSummary, checks: selfChecks }, null, 2));
    } else {
      for (const check of selfChecks) {
        console.log(
          `${check.pass ? 'OK  ' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`
        );
      }
      console.log(
        `\nself-check : ${selfCheckSummary.passed}/${selfCheckSummary.total} ผ่าน (ไม่ใช้เครือข่าย)`
      );
    }
    process.exit(selfCheckFailures.length === 0 ? 0 : 1);
  }

  if (!options.json) {
    console.log(
      `self-check : ${selfCheckSummary.passed}/${selfCheckSummary.total} ผ่าน (ตัวตรวจ "จบด้วยคำถาม", ไม่ใช้เครือข่าย)`
    );
  }
  if (selfCheckFailures.length > 0) {
    for (const check of selfCheckFailures) {
      console.error(`FAIL  ${check.name} — ${check.detail}`);
    }
    console.error(
      `self-check ไม่ผ่าน ${selfCheckFailures.length}/${selfCheckSummary.total} เคส — ตัวตรวจเสีย ต้องแก้ก่อนวัด provider`
    );
    process.exit(1);
  }
  if (!options.json) console.log('');

  let specs;
  try {
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

  const minPassOk = reports.every((report) => report.passRate >= options.minPass);

  const baselineFile = options.baseline || (options.updateBaseline ? DEFAULT_BASELINE_PATH : '');
  let baseline = null;
  let comparison = null;
  let baselineSummary = null;

  if (options.updateBaseline) {
    if (!minPassOk) {
      console.error(
        `ไม่อัปเดต baseline: pass rate ยังต่ำกว่าเกณฑ์ ${pct(
          options.minPass
        )} — baseline ต้องมาจากรอบที่ยอมรับได้เท่านั้น`
      );
      process.exit(1);
    }
    baseline = buildBaseline(reports, options, selfCheckSummary);
    writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    baselineSummary = {
      file: baselineFile,
      written: true,
      generatedAt: baseline.generatedAt,
    };
    if (!options.json) console.log(`เขียน baseline ลง ${baselineFile}\n`);
  } else if (baselineFile) {
    try {
      baseline = readBaseline(baselineFile);
    } catch (error) {
      console.error(`ตั้งค่าไม่ถูกต้อง: ${error.message}`);
      process.exit(2);
    }
    comparison = compareWithBaseline(reports, baseline, options);
    baselineSummary = {
      file: baselineFile,
      written: false,
      generatedAt: baseline.generatedAt,
      passed: comparison.passed,
      rows: comparison.rows,
      failures: comparison.failures,
      warnings: comparison.warnings,
    };
  }

  const gatePassed = minPassOk && (comparison ? comparison.passed : true);

  if (options.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      minPass: options.minPass,
      passed: gatePassed,
      selfCheck: selfCheckSummary,
      baseline: baselineSummary,
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
    if (comparison) printBaselineVerdict(baselineFile, baseline, comparison);
  }

  if (options.out) {
    writeFileSync(
      options.out,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          minPass: options.minPass,
          passed: gatePassed,
          selfCheck: selfCheckSummary,
          baseline: baselineSummary,
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
