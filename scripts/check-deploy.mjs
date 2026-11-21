#!/usr/bin/env node
// Post-deploy smoke check for the ChatCraft worker.
//
//   node scripts/check-deploy.mjs https://your-site.freebuff.page
//   node scripts/check-deploy.mjs https://your-site.freebuff.page --scenario no-1209
//   node scripts/check-deploy.mjs https://your-site.freebuff.page --json
//
// It calls /api/health (no model call), then every main endpoint once, and says
// plainly which failures are caused by a Gemini key Google refuses, so a deploy
// can be judged without guessing from a generic 500.
//
// scenarioId เปลี่ยนได้ระหว่าง build สคริปต์จึงอ่านรายการ id ของ build นั้นจาก
// /build-meta.json ของหน้าเว็บ (หรือจาก JS bundle ถ้า deployment ยังไม่มีไฟล์นี้)
// แล้วยืนยันด้วยการยิง chat/hint ที่ messages ว่าง (ถูกปฏิเสธก่อนถึงการเรียกโมเดล
// จึงไม่เปลืองโควตา)
// worker กับ asset มาจากคนละ build เมื่อ build id ที่ /api/health รายงานไม่ตรงกับ
// build-meta.json หรือเมื่อ id จาก asset ถูกปฏิเสธทั้งหมด: สคริปต์จะรายงานเรื่องนี้
// และยังตรวจ mentor/chat, tools/search, tools/maps ต่อ เพราะสามตัวนั้นไม่ต้องใช้ scenarioId
// ชั้นที่สอง: build id ของ worker/asset ยังถูกเทียบกับ commit ที่ push ล่าสุด
// (git rev-parse --short HEAD) ถ้าสองฝั่งตรงกันแต่เป็น build เก่ากว่า HEAD สคริปต์จะขึ้น
// STALE และ exit 2 เพื่อไม่ให้ deploy ที่ล้าสมัยผ่านไปเงียบ ๆ
//
// Exit codes: 0 = all good, 1 = Gemini key rejected, 2 = other failures, the
// worker and its assets come from different builds, or the deploy is behind HEAD.
// No dependencies: needs Node 18+ (global fetch) or `bun scripts/check-deploy.mjs`.

import { execFileSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SCENARIO_CANDIDATES = 6;
// A TrainingScenario is the only object with id + title + … + customerPersonaPrompt.
// Matching on id alone also hits PRODUCT_SETS (no-1209, rt-02, …) and promo items,
// which would make a healthy deployment look like a worker/asset mismatch.
// Minified data uses quotes or backticks: id:"x",title: / id:`x`,title:
const SCENARIO_ID_PATTERN =
  /id:[`"']([a-z0-9][a-z0-9-]*)[`"'],(?=[^}]{0,1600}?customerPersonaPrompt)/g;

const usage = () => {
  console.log(`ใช้: node scripts/check-deploy.mjs <base-url> [ตัวเลือก]

ตัวเลือก
  --scenario <id>   ระบุ scenarioId เอง (ถ้าไม่ระบุ สคริปต์จะอ่าน id จาก bundle ของหน้าเว็บ)
  --timeout <ms>    เวลารอสูงสุดต่อคำขอ (ค่าเริ่มต้น: ${DEFAULT_TIMEOUT_MS})
  --json            พิมพ์ผลเป็น JSON แทนตาราง
  -h, --help        แสดงข้อความนี้

ตัวตรวจ
  /api/health         (ไม่เรียกโมเดล)
  /api/chat/turn      ต้องมี scenarioId ที่ worker รู้จัก
  /api/chat/hint      ต้องมี scenarioId ที่ worker รู้จัก
  /api/mentor/chat    ไม่ต้องใช้ scenarioId
  /api/tools/search   ไม่ต้องใช้ scenarioId
  /api/tools/maps     ไม่ต้องใช้ scenarioId
  build ↔ git HEAD    เทียบ build id ของ deploy กับ commit ล่าสุด (STALE ถ้าเก่ากว่า)

รหัสออก
  0  ทุกอย่างผ่าน (คำเตือนเรื่อง grounding ไม่นับเป็นความล้มเหลว)
  1  คีย์ Gemini ถูกปฏิเสธ (UNAUTHENTICATED / API key not valid)
  2  ความล้มเหลวอื่น, timeout, response ไม่ครบ field,
     worker กับ asset ของหน้ามาจากคนละ build (ตรวจ chat/turn กับ chat/hint ไม่ได้)
     หรือ deploy ยังเป็น build เก่ากว่า commit ล่าสุด (git HEAD)`);
};

function parseArgs(argv) {
  const options = { scenario: '', timeout: DEFAULT_TIMEOUT_MS, json: false, baseUrl: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--scenario') {
      options.scenario = argv[++i] ?? '';
      continue;
    }
    if (arg === '--timeout') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        console.error('--timeout ต้องเป็นตัวเลขมากกว่า 0');
        process.exit(64);
      }
      options.timeout = value;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`ไม่รู้จักตัวเลือก ${arg} (ดู --help)`);
      process.exit(64);
    }
    if (!options.baseUrl) {
      options.baseUrl = arg;
      continue;
    }
    console.error(`ระบุ base URL ซ้ำ: ${arg}`);
    process.exit(64);
  }
  if (!options.baseUrl) {
    usage();
    process.exit(64);
  }
  const withScheme = /^https?:\/\//i.test(options.baseUrl)
    ? options.baseUrl
    : `https://${options.baseUrl}`;
  options.baseUrl = withScheme.replace(/\/+$/, '');
  return options;
}

const KEY_REJECTED =
  /api key not valid|unauthenticated|api_key_invalid|permission_denied|api key expired/i;
const QUOTA = /resource_exhausted|quota|429/i;
const UNKNOWN_SCENARIO = /ไม่พบสถานการณ์/;

function textOf(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (typeof body?.error === 'string') return body.error;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function clip(text, max = 160) {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

function missingKeys(body, keys) {
  return keys.filter((key) => {
    const value = body?.[key];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return value === undefined || value === null;
  });
}

async function call(baseUrl, method, path, payload, timeoutMs) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    let body;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    return { status: response.status, body, ms: Date.now() - startedAt };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: 0,
      body: null,
      ms: Date.now() - startedAt,
      transportError: timedOut ? `timeout หลัง ${timeoutMs} ms` : String(error?.message ?? error),
    };
  }
}

// Turn one raw result into a verdict. `required` lists the fields a healthy
// answer must contain, so a 200 with an empty or broken body still fails.
function judge(name, path, result, required) {
  const entry = {
    name,
    path,
    http: result.status,
    ms: result.ms,
    status: 'pass',
    detail: '',
  };

  if (result.transportError) {
    entry.status = 'fail';
    entry.detail = result.transportError;
    return entry;
  }

  if (result.status === 200) {
    const missing = missingKeys(result.body, required);
    if (missing.length > 0) {
      entry.status = 'fail';
      entry.detail = `200 แต่ response ขาด field: ${missing.join(', ')}`;
    } else if (result.body?.grounded === false) {
      entry.status = 'warn';
      entry.detail = 'ตอบได้แต่ grounding ปิด (โควตา Google Search/Maps)';
    }
    return entry;
  }

  const bodyText = textOf(result.body);
  if (KEY_REJECTED.test(bodyText)) {
    entry.status = 'key';
    entry.detail = clip(bodyText);
  } else if (result.status === 429 || QUOTA.test(bodyText)) {
    entry.status = 'quota';
    entry.detail = clip(bodyText);
  } else {
    entry.status = 'fail';
    entry.detail = clip(bodyText || `HTTP ${result.status}`);
  }
  return entry;
}

// The build stamp the deploy writes next to the assets (scripts/build-meta.mjs).
// Deployments made before it existed have no file: fall back to the bundle.
async function fetchBuildMeta(baseUrl, timeoutMs) {
  const response = await call(baseUrl, 'GET', '/build-meta.json', null, timeoutMs);
  if (response.status !== 200 || !response.body || typeof response.body !== 'object') return null;
  const scenarioIds = Array.isArray(response.body.scenarioIds)
    ? response.body.scenarioIds.filter((id) => typeof id === 'string')
    : [];
  return {
    buildId: typeof response.body.buildId === 'string' ? response.body.buildId : '',
    scenarioIds,
  };
}

// Read scenario ids out of the deployed frontend: build-meta.json when present,
// otherwise index.html -> first JS chunk (works when ids change between builds).
async function discoverScenarioIds(baseUrl, meta, timeoutMs) {
  if (meta?.scenarioIds?.length) return meta.scenarioIds;
  try {
    const page = await call(baseUrl, 'GET', '/', null, timeoutMs);
    if (page.status !== 200 || typeof page.body !== 'string') return [];
    const scripts = [...page.body.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
    const ids = [];
    for (const src of scripts.slice(0, 3)) {
      const path = src.startsWith('/') ? src : `/${src}`;
      const chunk = await call(baseUrl, 'GET', path, null, timeoutMs);
      if (chunk.status !== 200 || typeof chunk.body !== 'string') continue;
      for (const match of chunk.body.matchAll(SCENARIO_ID_PATTERN)) {
        if (!ids.includes(match[1])) ids.push(match[1]);
      }
      if (ids.length > 0) break;
    }
    return ids;
  } catch {
    return [];
  }
}

// messages ว่างทำให้ worker ตอบ 400 ก่อนเรียกโมเดล: id ที่รู้จักจะได้
// "กรุณาส่งข้อความบทสนทนา" ส่วน id ที่ไม่รู้จักจะได้ "ไม่พบสถานการณ์"
async function scenarioExists(baseUrl, scenarioId, timeoutMs) {
  const probe = await call(baseUrl, 'POST', '/api/chat/hint', { scenarioId, messages: [] }, timeoutMs);
  return !UNKNOWN_SCENARIO.test(textOf(probe.body));
}

// No hardcoded ids: only what this deployment's own build advertises is tried.
// A build-id disagreement, or every advertised id being rejected, means the
// worker and the assets are not from the same build: a deployment problem.
async function resolveScenario(baseUrl, requested, timeoutMs, healthBody) {
  const meta = await fetchBuildMeta(baseUrl, timeoutMs);
  const workerBuildId = typeof healthBody?.buildId === 'string' ? healthBody.buildId : '';
  const assetBuildId = meta?.buildId ?? '';
  const build = { worker: workerBuildId, asset: assetBuildId };
  const buildIdsDiffer = Boolean(workerBuildId && assetBuildId && workerBuildId !== assetBuildId);
  const workerIds = Array.isArray(healthBody?.scenarioIds)
    ? healthBody.scenarioIds.filter((id) => typeof id === 'string')
    : [];
  const base = { build, buildIdsDiffer, workerIds };

  if (requested) {
    const accepted = await scenarioExists(baseUrl, requested, timeoutMs);
    return {
      ...base,
      id: accepted ? requested : '',
      source: 'จาก --scenario',
      tried: [requested],
      mismatch: buildIdsDiffer,
      bundleIds: [],
      rejected: accepted ? [] : [requested],
    };
  }

  const discovered = await discoverScenarioIds(baseUrl, meta, timeoutMs);
  const tried = [];
  for (const id of discovered.slice(0, MAX_SCENARIO_CANDIDATES)) {
    tried.push(id);
    if (await scenarioExists(baseUrl, id, timeoutMs)) {
      return {
        ...base,
        id,
        source: meta?.scenarioIds?.length
          ? 'จาก build-meta.json ของหน้าเว็บ'
          : 'อ่านได้จาก bundle ของหน้าเว็บ',
        tried,
        mismatch: buildIdsDiffer,
        bundleIds: discovered,
        rejected: [],
      };
    }
  }
  return {
    ...base,
    id: '',
    source: discovered.length ? 'id ของ asset ถูกปฏิเสธทั้งหมด' : 'อ่าน id จาก asset ไม่ได้',
    tried,
    mismatch: buildIdsDiffer || discovered.length > 0,
    bundleIds: discovered,
    rejected: tried,
  };
}

// Commit ของ repo ที่สคริปต์อยู่ (ไม่ใช่ cwd เพื่อไม่ให้เรียกจาก repo อื่นแล้วขึ้น STALE ผิด ๆ)
function localHeadShortSha() {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.toLowerCase();
  } catch {
    return '';
  }
}

// build id คือ "<short-sha>-<UTC time>Z" (scripts/build-deploy.sh)
function shaFromBuildId(buildId) {
  const match = /^([0-9a-f]{7,40})(?:-|$)/i.exec(String(buildId || '').trim());
  return match ? match[1].toLowerCase() : '';
}

// git เลือกความยาว short sha ตามจำนวน object จึงเทียบด้วยส่วนที่สั้นกว่า
function sameCommit(a, b) {
  const shared = Math.min(a.length, b.length);
  return shared >= 7 && a.slice(0, shared) === b.slice(0, shared);
}

function headVerdict(headSha, build, healthOk) {
  const deployedBuildId = build.worker || build.asset || '';
  const deployedSha = shaFromBuildId(deployedBuildId);
  const base = { headSha, deployedBuildId, deployedSha };
  if (!headSha) {
    return {
      ...base,
      status: 'info',
      detail: 'อ่าน git HEAD ไม่ได้ (ไม่ใช่ git repo หรือไม่มี git) — ข้ามการเทียบ HEAD',
    };
  }
  if (!deployedSha) {
    return {
      ...base,
      status: 'info',
      detail: healthOk
        ? `deployment ยังไม่มี build stamp (build=${deployedBuildId || '?'}) — เทียบกับ HEAD ${headSha} ไม่ได้`
        : `อ่าน build id ไม่ได้เพราะ /api/health ตอบไม่ได้ — เทียบกับ HEAD ${headSha} ไม่ได้`,
    };
  }
  if (sameCommit(deployedSha, headSha)) {
    return { ...base, status: 'pass', detail: `build ${deployedSha} ตรงกับ HEAD ${headSha}` };
  }
  return {
    ...base,
    status: 'stale',
    detail: `deploy เป็น build ${deployedSha} แต่ HEAD คือ ${headSha} — commit ล่าสุดยังไม่ได้ deploy`,
  };
}

function buildMismatchDetail(resolved) {
  if (resolved.buildIdsDiffer) {
    const worker = resolved.build.worker || '(ไม่ระบุ)';
    const asset = resolved.build.asset || '(ไม่ระบุ — asset เก่ากว่าที่มี build stamp)';
    return `worker build ${worker} ≠ asset build ${asset}`;
  }
  return `worker ปฏิเสธ scenarioId ทุกตัวของ asset (${resolved.rejected.slice(0, 3).join(', ')}${
    resolved.rejected.length > 3 ? ' …' : ''
  })`;
}

async function main() {
  const { baseUrl, scenario: requestedScenario, timeout, json } = parseArgs(process.argv.slice(2));

  const adminTurn = [
    { role: 'customer', text: 'สวัสดีค่ะ อยากจัดกระเช้าไปเยี่ยมคนไข้ที่โรงพยาบาลค่ะ' },
    {
      role: 'admin',
      text: 'สวัสดีค่ะ ยินดีช่วยดูแลนะคะ ไม่ทราบว่าจะจัดส่งวันไหน และมีงบประมาณประมาณเท่าไรคะ',
    },
  ];

  const health = await call(baseUrl, 'GET', '/api/health', null, timeout);
  const healthEntry = judge('health', '/api/health', health, ['ok']);

  const resolved = await resolveScenario(baseUrl, requestedScenario, timeout, health.body);
  const results = [healthEntry];
  // นับเฉพาะใบที่ยิงคำขอไปยัง endpoint จริง (ไม่รวม health/build/head/scenario)
  const modelResults = [];

  if (resolved.mismatch) {
    results.push({
      name: 'build',
      path: '/api/health ↔ /build-meta.json',
      http: 0,
      ms: 0,
      status: 'mismatch',
      detail: `${buildMismatchDetail(resolved)} — worker กับ asset มาจากคนละ build`,
    });
  }

  // build ภายในอาจตรงกันแต่เป็น commit เก่า: เทียบกับ HEAD ของ repo นี้
  const head = headVerdict(localHeadShortSha(), resolved.build, health.status === 200);
  results.push({
    name: 'head',
    path: 'build id ↔ git HEAD',
    http: 0,
    ms: 0,
    status: head.status,
    detail: head.detail,
  });

  if (!resolved.id) {
    results.push({
      name: 'scenario',
      path: 'scenarioId',
      http: 0,
      ms: 0,
      status: resolved.mismatch ? 'skip' : 'fail',
      detail: resolved.mismatch
        ? 'ข้ามเพราะ worker กับ asset มาจากคนละ build'
        : resolved.rejected.length
          ? `scenarioId ที่ระบุถูกปฏิเสธ: ${resolved.rejected.join(', ')}`
          : 'อ่าน scenarioId จาก asset ไม่ได้ — ระบุเองด้วย --scenario <id>',
    });
  }

  // chat/turn กับ chat/hint ต้องมี scenarioId ที่ worker รู้จัก ส่วนสามตัวที่เหลือ
  // ไม่ต้องใช้ จึงตรวจต่อได้แม้หา scenarioId ไม่เจอ
  const scenarioEndpoints = [
    {
      name: 'chat/turn',
      path: '/api/chat/turn',
      payload: { scenarioId: resolved.id, messages: adminTurn, currentStage: 2 },
      required: ['customerReply', 'stageDetected', 'coachingTip'],
    },
    {
      name: 'chat/hint',
      path: '/api/chat/hint',
      payload: { scenarioId: resolved.id, messages: adminTurn, currentStage: 2 },
      required: ['focusPoint', 'suggestedReply'],
    },
  ];

  const scenarioFreeEndpoints = [
    {
      name: 'mentor/chat',
      path: '/api/mentor/chat',
      payload: { message: 'ขอตัวอย่างประโยคปิดการขายที่ทิ้งคำถามไว้ท้ายประโยค 2 แบบ' },
      required: ['reply'],
    },
    {
      name: 'tools/search',
      path: '/api/tools/search',
      payload: { query: 'มะม่วงน้ำดอกไม้มีผลผลิตช่วงเดือนไหนของไทย' },
      required: ['answerMarkdown'],
    },
    {
      name: 'tools/maps',
      path: '/api/tools/maps',
      payload: { query: 'โรงพยาบาลจุฬาลงกรณ์' },
      required: ['answerMarkdown'],
    },
  ];

  const runEndpoint = async (endpoint) => {
    const result = await call(baseUrl, 'POST', endpoint.path, endpoint.payload, timeout);
    const entry = judge(endpoint.name, endpoint.path, result, endpoint.required);
    results.push(entry);
    modelResults.push(entry);
  };

  if (resolved.id) {
    for (const endpoint of scenarioEndpoints) await runEndpoint(endpoint);
  } else {
    for (const endpoint of scenarioEndpoints) {
      results.push({
        name: endpoint.name,
        path: endpoint.path,
        http: 0,
        ms: 0,
        status: 'skip',
        detail: 'ข้ามเพราะหา scenarioId ที่ worker รู้จักไม่ได้',
      });
    }
  }

  for (const endpoint of scenarioFreeEndpoints) await runEndpoint(endpoint);

  const keyFlags =
    health.status === 200 && health.body && typeof health.body === 'object'
      ? {
          gemini: Boolean(health.body.geminiApiKeyConfigured),
          gemini2: Boolean(health.body.geminiApiKey2Configured),
          exa: Boolean(health.body.exaApiKeyConfigured),
        }
      : null;

  const failed = results.filter((entry) => entry.status === 'fail');
  const keyFailures = results.filter((entry) => entry.status === 'key');
  const quotaFailures = results.filter((entry) => entry.status === 'quota');
  const warnings = results.filter((entry) => entry.status === 'warn');
  const skipped = results.filter((entry) => entry.status === 'skip' || entry.status === 'mismatch');
  const stale = results.filter((entry) => entry.status === 'stale');
  const modelChecks = modelResults.length;
  const modelPassed = modelResults.filter(
    (entry) => entry.status === 'pass' || entry.status === 'warn'
  ).length;

  if (json) {
    console.log(
      JSON.stringify(
        {
          baseUrl,
          scenario: {
            id: resolved.id || null,
            source: resolved.source,
            mismatch: resolved.mismatch,
            build: resolved.build,
            workerIds: resolved.workerIds,
            bundleIds: resolved.bundleIds,
          },
          health: keyFlags,
          head: {
            headSha: head.headSha || null,
            deployedBuildId: head.deployedBuildId || null,
            deployedSha: head.deployedSha || null,
            stale: stale.length > 0,
          },
          results,
          summary: {
            passed: modelPassed,
            keyRejected: keyFailures.map((entry) => entry.name),
            quota: quotaFailures.map((entry) => entry.name),
            failed: failed.map((entry) => entry.name),
            skipped: skipped.map((entry) => entry.name),
            warnings: warnings.map((entry) => entry.name),
          },
        },
        null,
        2
      )
    );
  } else {
    const label = {
      pass: 'PASS',
      warn: 'WARN',
      key: 'KEY!',
      quota: 'QUOTA',
      fail: 'FAIL',
      skip: 'SKIP',
      mismatch: 'MISMATCH',
      stale: 'STALE',
      info: 'INFO',
    };
    console.log(`\nตรวจ ${baseUrl}`);
    console.log(
      `scenario: ${resolved.id || '(ไม่พบ)'} (${resolved.source}) | timeout: ${timeout} ms`
    );
    if (resolved.build.worker || resolved.build.asset) {
      console.log(
        `build: worker=${resolved.build.worker || '?'} asset=${resolved.build.asset || '?'}` +
          (resolved.workerIds.length ? ` | worker รู้จัก ${resolved.workerIds.length} scenario` : '')
      );
    }
    console.log('');
    for (const entry of results) {
      const seconds = `${(entry.ms / 1000).toFixed(2)}s`.padStart(7);
      const http = String(entry.http || '-').padStart(3);
      console.log(
        `${label[entry.status].padEnd(8)} ${entry.path.padEnd(18)} ${http} ${seconds}`
      );
      if (entry.detail) console.log(`        ↳ ${entry.detail}`);
    }
    if (keyFlags) {
      const onOff = (value) => (value ? 'ตั้งแล้ว' : 'ไม่มี');
      console.log(
        `\nคีย์จาก /api/health: GEMINI_API_KEY=${onOff(keyFlags.gemini)}, ` +
          `GEMINI_API_KEY_2=${onOff(keyFlags.gemini2)}, EXA_API_KEY=${onOff(keyFlags.exa)}`
      );
    }

    if (stale.length > 0) {
      console.log('\n>>> deploy ยังเป็น build เก่ากว่า commit ล่าสุด (git HEAD)');
      console.log(`    deploy build: ${head.deployedSha} (${head.deployedBuildId})`);
      console.log(`    git HEAD:     ${head.headSha}`);
      console.log(
        '    worker กับ asset ตรงกันแล้ว แต่ทั้งคู่เป็น build เก่า — commit ล่าสุดยังไม่ขึ้น production/preview: รัน bash scripts/build-deploy.sh แล้ว publish ใหม่'
      );
    }

    if (resolved.mismatch) {
      console.log(`\n>>> worker กับ asset ของหน้าจอมาจากคนละ build: ${buildMismatchDetail(resolved)}`);
      if (resolved.bundleIds.length > 0) {
        console.log(
          `    asset ประกาศ scenarioId: ${resolved.bundleIds.slice(0, 3).join(', ')}` +
            (resolved.bundleIds.length > 3 ? ' …' : '')
        );
      }
      if (resolved.workerIds.length > 0) {
        console.log(
          `    worker รู้จัก scenarioId: ${resolved.workerIds.slice(0, 3).join(', ')}` +
            (resolved.workerIds.length > 3 ? ' …' : '')
        );
      }
      console.log(
        '    ผู้ใช้ที่เปิดหน้าเว็บอาจเจอ 400 "ไม่พบสถานการณ์ฝึกซ้อมที่ระบุ" — ต้อง deploy worker กับ asset จาก build เดียวกัน (scripts/build-deploy.sh ตรวจให้ก่อน publish)'
      );
    }

    console.log('');
    if (keyFailures.length === 0 && failed.length === 0 && quotaFailures.length === 0 && skipped.length === 0) {
      console.log(`สรุป: ผ่านทุก endpoint (${modelPassed}/${modelChecks} คำขอที่เรียกโมเดล)`);
    } else {
      console.log(
        `สรุป: ผ่าน ${modelPassed}/${modelChecks} คำขอที่เรียกโมเดล, ` +
          `ล้มเหลว ${failed.length}, คีย์ถูกปฏิเสธ ${keyFailures.length}, ` +
          `โควตาเต็ม ${quotaFailures.length}, ข้าม ${skipped.length}`
      );
    }
    if (keyFailures.length > 0) {
      const names = keyFailures.map((entry) => entry.name).join(', ');
      console.log(`\n>>> ล้มเพราะคีย์ Gemini ใช้ไม่ได้: ${names}`);
      console.log(
        keyFlags?.gemini
          ? '    /api/health บอกว่ามี GEMINI_API_KEY แต่ Google ปฏิเสธ (UNAUTHENTICATED) — ค่าเดิมใช้ไม่ได้แล้ว ต้องใส่คีย์ใหม่ที่ Sites → Secrets ของ environment นี้'
          : '    /api/health บอกว่าไม่มี GEMINI_API_KEY — ยังไม่ได้ตั้ง Secrets ของ environment นี้'
      );
      if (keyFlags?.gemini && !keyFlags.gemini2) {
        console.log('    GEMINI_API_KEY_2 ก็ไม่มี จึงไม่มีคีย์สำรองให้สลับ');
      }
    }
    if (quotaFailures.length > 0) {
      console.log(
        `\n>>> โควตา/สิทธิ์ต้นทางเต็ม (ไม่ใช่บั๊กโค้ด): ${quotaFailures
          .map((entry) => entry.name)
          .join(', ')} — มักเป็น grounding (Google Search/Maps) ที่ต้องเปิด billing`
      );
    }
    const otherFailures = failed.filter((entry) => entry.name !== 'scenario');
    if (otherFailures.length > 0) {
      console.log(
        `\n>>> ล้มเหลวอื่น ๆ: ${otherFailures.map((entry) => entry.name).join(', ')} (ดู ↳ ด้านบน)`
      );
    }
    if (warnings.length > 0) {
      console.log(`\n>>> คำเตือน: ${warnings.map((entry) => entry.name).join(', ')}`);
    }
  }

  if (keyFailures.length > 0) process.exit(1);
  if (failed.length > 0 || skipped.length > 0 || stale.length > 0) process.exit(2);
  process.exit(0);
}

main().catch((error) => {
  console.error(`ตรวจไม่สำเร็จ: ${error?.stack ?? error}`);
  process.exit(2);
});
