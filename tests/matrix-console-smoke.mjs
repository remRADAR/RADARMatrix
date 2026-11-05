import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'apps', 'matrix-console');
const required = ['dist/index.html', 'dist/assets', 'public/manus-routes.json', 'src/App.tsx'];
for (const relative of required) {
  if (!existsSync(join(root, relative))) throw new Error(`missing Matrix Console artifact: ${relative}`);
}
const source = readFileSync(join(root, 'src/App.tsx'), 'utf8');
for (const marker of ['RADAR Chat', 'Agent Network', 'Skills Library', 'Knowledge Centre', 'Task Centre', 'Connections', 'DEMO MODE', 'MODEL OFFLINE']) {
  if (!source.includes(marker)) throw new Error(`missing required screen/truth marker: ${marker}`);
}
console.log('matrix console smoke passed: build artifacts, routes, screens, and truthfulness markers present');
