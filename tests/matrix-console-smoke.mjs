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
  'dist/assets/halo-stadium-wallpaper.webp',
  'dist/assets/halo-stadium-portrait.webp',
  'dist/THIRD-PARTY-NOTICES.txt',
  'src/vendor/icons8-liquid-glass-icons/LICENSE',
  'src/vendor/icons8-liquid-glass-icons/README.md',
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
for (const marker of ['checkInstallability', 'isStandaloneDisplay', 'PWA readiness checks', 'Add to Home Screen', 'Preview only — these controls', 'Host browser manages extensions', 'cannot install or manage extensions', 'RADARCharts stadium']) {
  if (!haloSource.includes(marker)) throw new Error(`missing Halo installability/truthfulness marker: ${marker}`);
}
const haloStyles = readFileSync(join(root, 'src/halo-os.css'), 'utf8');
for (const marker of ['halo-stadium-wallpaper.webp', 'halo-stadium-portrait.webp', 'orientation:portrait', 'prefers-reduced-motion', 'pointer:fine', '--halo-glow', 'repeat(8,124px)', 'min-aspect-ratio:16/9']) {
  if (!haloStyles.includes(marker)) throw new Error(`missing Halo wallpaper/icon responsiveness marker: ${marker}`);
}
const iconLicense = readFileSync(join(root, 'src/vendor/icons8-liquid-glass-icons/LICENSE'), 'utf8');
for (const marker of ['MIT License', 'Copyright (c) 2025 Icons8']) {
  if (!iconLicense.includes(marker)) throw new Error(`missing third-party icon attribution: ${marker}`);
}
const deployedNotices = readFileSync(join(root, 'dist/THIRD-PARTY-NOTICES.txt'), 'utf8');
for (const marker of ['Icons8 Liquid Glass Icons', 'Copyright (c) 2025 Icons8', 'MIT License']) {
  if (!deployedNotices.includes(marker)) throw new Error(`missing deployed third-party notice: ${marker}`);
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
for (const marker of ['manifest.webmanifest', 'apple-mobile-web-app-capable', 'apple-touch-icon', 'halo-stadium-wallpaper.webp', 'halo-stadium-portrait.webp', 'fetchpriority="high"']) {
  if (!html.includes(marker)) throw new Error(`missing PWA HTML metadata: ${marker}`);
}
const worker = readFileSync(join(root, 'dist/sw.js'), 'utf8');
for (const marker of ['CACHE_VERSION', 'v3', 'caches.delete', 'offline.html', "request.mode === 'navigate'", 'halo-stadium-wallpaper.webp', 'halo-stadium-portrait.webp']) {
  if (!worker.includes(marker)) throw new Error(`missing service-worker behavior marker: ${marker}`);
}
const offline = readFileSync(join(root, 'dist/offline.html'), 'utf8');
if (!offline.includes('Retry Halo')) throw new Error('missing offline fallback retry action');

console.log('matrix console smoke passed: build artifacts, routes, wallpaper, glass icon license, browser guidance, manifest/icons, service worker, and offline fallback');
