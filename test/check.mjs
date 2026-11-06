import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every shipped JavaScript module, resolved from the repository root. */
const files = ['index.js', 'client.js'];

const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tmp') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (path.endsWith('.js')) files.push(path);
  }
};

walk('lib');
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log('syntax ok: ' + files.length + ' files');
