import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'apps', 'matrix-console');
const required = [
  'dist/index.html',
  'dist/assets',
  'public/manus-routes.json',
  'src/App.tsx',
  'src/HaloDesktop.tsx',
  'dist/manifest.webmanifest',
  'dist/sw.js',
  'dist/offline.html',
  'dist/icons/halo-180.png',
  'dist/icons/halo-192.png',
  'dist/icons/halo-512.png',
  'dist/icons/halo-maskable-512.png',
];
for (const relative of required) {
  if (!existsSync(join(root, relative))) throw new Error(`missing Matrix Console artifact: ${relative}`);
}

const source = readFileSync(join(root, 'src/App.tsx'), 'utf8');
for (const marker of ['RADAR Chat', 'Agent Network', 'Skills Library', 'Knowledge Centre', 'Task Centre', 'Connections', 'DEMO MODE', 'MODEL OFFLINE']) {
  if (!source.includes(marker)) throw new Error(`missing required screen/truth marker: ${marker}`);
}
for (const marker of ["screen === 'halo'", 'screenFromLocation', "pushState"]) {
  if (!source.includes(marker)) throw new Error(`missing Halo route integration marker: ${marker}`);
}
const haloSource = readFileSync(join(root, 'src/HaloDesktop.tsx'), 'utf8');
for (const marker of ['checkInstallability', 'isStandaloneDisplay', 'PWA readiness checks', 'Add to Home Screen', 'Preview only — these controls']) {
  if (!haloSource.includes(marker)) throw new Error(`missing Halo installability/truthfulness marker: ${marker}`);
}

const manifest = JSON.parse(readFileSync(join(root, 'dist/manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== '/?screen=halo' || manifest.scope !== '/' || manifest.display !== 'standalone') {
  throw new Error('PWA manifest must start in Halo at origin root in standalone mode');
}
for (const icon of manifest.icons) {
  if (!existsSync(join(root, 'dist', icon.src.replace(/^\//, '')))) throw new Error(`missing manifest icon: ${icon.src}`);
}
for (const relative of ['dist/icons/halo-180.png', 'dist/icons/halo-192.png', 'dist/icons/halo-512.png', 'dist/icons/halo-maskable-512.png']) {
  const png = readFileSync(join(root, relative));
  if (png.length < 32 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`invalid PNG icon: ${relative}`);
}

const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
for (const marker of ['manifest.webmanifest', 'apple-mobile-web-app-capable', 'apple-touch-icon']) {
  if (!html.includes(marker)) throw new Error(`missing PWA HTML metadata: ${marker}`);
}
const worker = readFileSync(join(root, 'dist/sw.js'), 'utf8');
for (const marker of ['CACHE_VERSION', 'caches.delete', 'offline.html', "request.mode === 'navigate'", 'halo']) {
  if (!worker.includes(marker)) throw new Error(`missing service-worker behavior marker: ${marker}`);
}
const offline = readFileSync(join(root, 'dist/offline.html'), 'utf8');
if (!offline.includes('Retry Halo')) throw new Error('missing offline fallback retry action');

console.log('matrix console smoke passed: build artifacts, existing routes, Halo integration, manifest/icons, service worker, and offline fallback');
