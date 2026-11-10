import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve('apps/matrix-console/dist');
const output = resolve('apps/matrix-console/cloudflare-assets-manifest.json');
const files = [];

async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) {
      const bytes = await readFile(full);
      const rel = relative(root, full).replaceAll('\\', '/');
      const extension = extname(rel).replace(/^\./, '');
      const hash = createHash('sha256')
        .update(bytes.toString('base64') + extension)
        .digest('hex')
        .slice(0, 32);
      files.push({
        path: `/${rel}`,
        hash,
        size: bytes.length,
      });
    }
  }
}

await walk(root);
const manifest = Object.fromEntries(files.map(({ path, hash, size }) => [path, { hash, size }]));
await writeFile(output, `${JSON.stringify({
  format: 'cloudflare-workers-static-assets-manifest-v1',
  source_directory: 'apps/matrix-console/dist',
  files,
  manifest,
}, null, 2)}\n`);
console.log(`Wrote ${files.length} asset entries to ${output}`);
