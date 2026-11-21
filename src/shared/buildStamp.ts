// The deploy build injects __BUILD_ID__ through `esbuild --define`
// (scripts/build-deploy.sh). The same id is written to deploy/public/build-meta.json,
// and the worker reports it from /api/health, so a smoke check can prove the worker
// and the served frontend assets come from the same build.
declare const __BUILD_ID__: string;

export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
