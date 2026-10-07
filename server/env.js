// Load KEY=value pairs from a local .env file (dev only; hosts like Render set real env vars).
import fs from 'fs';
import path from 'path';

const file = path.resolve('.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.TZ = process.env.TZ || 'Asia/Bangkok';
