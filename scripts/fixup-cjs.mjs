import { writeFileSync } from 'node:fs';

// The package is "type": "module", so Node would read dist/cjs/*.js as ESM.
// A nested package.json flips that one directory back to CommonJS.
writeFileSync(
  new URL('../dist/cjs/package.json', import.meta.url),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);
