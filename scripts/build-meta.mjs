#!/usr/bin/env bun
// Writes deploy/public/build-meta.json: the build id the worker was bundled with
// plus the scenario ids this build's data file really contains.
// Runs under bun so it can import the TypeScript source of the scenario catalog.
//
//   BUILD_ID=<id> bun scripts/build-meta.mjs
//
// scripts/build-deploy.sh calls this and scripts/verify-build.mjs then checks the
// worker bundle and the assets against this file before anything is published.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRAINING_SCENARIOS } from '../src/data/playbookData.ts';

const buildId = (process.env.BUILD_ID ?? '').trim();
if (!buildId) {
  console.error('ไม่พบ BUILD_ID: ต้องรันผ่าน scripts/build-deploy.sh');
  process.exit(1);
}

const scenarioIds = TRAINING_SCENARIOS.map((scenario) => scenario.id);
if (scenarioIds.length === 0) {
  console.error('ไม่พบ scenario ใน src/data/playbookData.ts');
  process.exit(1);
}

const deployPublic = fileURLToPath(new URL('../deploy/public/', import.meta.url));
const target = path.join(deployPublic, 'build-meta.json');
await mkdir(deployPublic, { recursive: true });
await writeFile(target, `${JSON.stringify({ buildId, scenarioIds }, null, 2)}\n`, 'utf8');

console.log(`==> build-meta.json: build=${buildId}, scenarios=${scenarioIds.length}`);
