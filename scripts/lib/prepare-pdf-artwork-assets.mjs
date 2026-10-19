import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Only trusted, pinned PDF.js runtime files; no viewer, document scripts or CDN. */
export function preparePdfArtworkAssets(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const { version } = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const destination = path.join(root, 'public/assets/pdfjs', version);
  mkdirSync(destination, { recursive: true });
  const copy = (from, to) => {
    const target = path.join(destination, to);
    // Avoid touching assets every time Next reloads its config.
    if (!existsSync(target)) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(source, from), target);
    }
  };
  copy('legacy/build/pdf.worker.min.mjs', 'pdf.worker.legacy.min.mjs');
  copy('LICENSE', 'LICENSE');
  for (const directory of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
    for (const name of readdirSync(path.join(source, directory))) {
      // The viewer's QuickJS document-scripting runtime is deliberately absent.
      if (!name.startsWith('quickjs-')) {
        copy(`${directory}/${name}`, `${directory}/${name}`);
      }
    }
  }
  return destination;
}
