#!/usr/bin/env node
// Pre-deploy guard: the worker bundle and the frontend assets must come from the
// same build. This is what stops a deploy from shipping a worker that rejects the
// scenarioIds the served page sends (or assets that never heard of the worker's
// scenarios).
//
//   node scripts/verify-build.mjs [--dir deploy]
//
// Checks
//   1. deploy/public/build-meta.json exists and names a build id.
//   2. deploy/worker.js was bundled with that same build id (/api/health reports it).
//   3. Every scenarioId of the build exists in the worker bundle AND in the assets.
//   4. The scenario ids read out of the asset bundle equal the build-meta list.
//
// Exit codes: 0 = consistent, 1 = the halves do not match (do not deploy).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// A TrainingScenario is the only object that carries id + title + ... +
// customerPersonaPrompt. Matching on id alone also hits PRODUCT_SETS and promo
// items, which is how a checker can mistake a product id for a scenario id.
const SCENARIO_ID_PATTERN =
  /id:[`"']([a-z0-9][a-z0-9-]*)[`"'],(?=[^}]{0,1600}?customerPersonaPrompt)/g;

const args = process.argv.slice(2);
let deployDir = 'deploy';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--dir') {
    deployDir = args[++i] ?? deployDir;
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('ใช้: node scripts/verify-build.mjs [--dir deploy]');
    process.exit(0);
  }
}

const problems = [];
const publicDir = path.join(deployDir, 'public');
const metaPath = path.join(publicDir, 'build-meta.json');
const workerPath = path.join(deployDir, 'worker.js');

let meta;
try {
  meta = JSON.parse(await readFile(metaPath, 'utf8'));
} catch (error) {
  console.error(`ไม่พบ ${metaPath} ที่อ่านได้: ${error?.message ?? error}`);
  console.error('รัน scripts/build-deploy.sh เพื่อสร้าง build ที่ครบทั้งสองฝั่ง');
  process.exit(1);
}

const buildId = typeof meta?.buildId === 'string' ? meta.buildId.trim() : '';
const scenarioIds = Array.isArray(meta?.scenarioIds)
  ? meta.scenarioIds.filter((id) => typeof id === 'string' && id.length > 0)
  : [];

if (!buildId) problems.push('build-meta.json ไม่มี buildId');
if (scenarioIds.length === 0) problems.push('build-meta.json ไม่มี scenarioIds');

let workerJs = '';
try {
  workerJs = await readFile(workerPath, 'utf8');
} catch (error) {
  problems.push(`อ่าน ${workerPath} ไม่ได้: ${error?.message ?? error}`);
}

async function readAssetScripts(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
  const texts = [];
  for (const file of files) texts.push({ file, text: await readFile(file, 'utf8') });
  return texts;
}

const assetScripts = await readAssetScripts(publicDir);
const assetText = assetScripts.map((entry) => entry.text).join('\n');

if (assetScripts.length === 0) problems.push(`${publicDir} ไม่มีไฟล์ .js ของหน้าเว็บ`);
if (workerJs && buildId && !(workerJs.includes('buildId: BUILD_ID') && workerJs.includes(`"${buildId}"`))) {
  problems.push(`worker.js ไม่ได้ถูก build ด้วย build id ${buildId} (/api/health จะรายงาน build อื่น)`);
}

for (const id of scenarioIds) {
  if (workerJs && !workerJs.includes(id)) {
    problems.push(`worker.js ไม่รู้จัก scenarioId ${id}`);
  }
  if (assetText && !assetText.includes(id)) {
    problems.push(`asset ไม่มี scenarioId ${id}`);
  }
}

const assetIds = [...new Set([...assetText.matchAll(SCENARIO_ID_PATTERN)].map((match) => match[1]))];
if (assetIds.length > 0) {
  const missingInMeta = assetIds.filter((id) => !scenarioIds.includes(id));
  const missingInAssets = scenarioIds.filter((id) => !assetIds.includes(id));
  if (missingInMeta.length > 0) {
    problems.push(`asset มี scenarioId ที่ build-meta ไม่มี: ${missingInMeta.join(', ')}`);
  }
  if (missingInAssets.length > 0) {
    problems.push(`asset ขาด scenarioId ที่ build-meta มี: ${missingInAssets.join(', ')}`);
  }
}

if (problems.length > 0) {
  console.error('\nตรวจ build ก่อน deploy ไม่ผ่าน:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nworker กับ asset ต้องมาจาก build เดียวกัน — รัน scripts/build-deploy.sh ใหม่ทั้งชุด');
  process.exit(1);
}

console.log(`\n==> ตรวจ build ผ่าน: build=${buildId}`);
console.log(`    worker.js + asset มี scenarioId ครบ ${scenarioIds.length} ตัว: ${scenarioIds.join(', ')}`);
