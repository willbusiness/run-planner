// Pre-generate a route bank for a start point so the app opens with routes already there (also on a new phone).
// Usage: node scripts/seed.mjs <lat> <lng> [surface=mixed]
// Output: public/seed/<lat>_<lng>_<surface>.json  (resumable: run it again to fill gaps)
import fs from 'fs';
import { makeRoute } from '../src/loops.js';

const [lat, lng, surface = 'mixed'] = process.argv.slice(2);
if (!lat || !lng) { console.error('usage: node scripts/seed.mjs <lat> <lng> [surface]'); process.exit(1); }
const start = [+lat, +lng];
const file = `public/seed/${start[0].toFixed(3)}_${start[1].toFixed(3)}_${surface}.json`;
const items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
const LADDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 33, 36, 39, 42];
const OB = [5, 8, 10, 12, 15, 18, 21, 25, 30];
const prefs = { surface, hills: 'any', quiet: false, green: false, avoidStairs: true, background: true };
const near = (r, kind, km) => r.kind === kind && Math.abs(r.dist - km * 1000) < Math.max(400, km * 60);
const save = () => fs.writeFileSync(file, JSON.stringify(items));
let seed = 90210;
const todo = [
  ...LADDER.flatMap((km) => Array.from({ length: Math.max(0, 4 - items.filter((r) => near(r, 'loop', km)).length) }, () => ['loop', km])),
  ...OB.flatMap((km) => Array.from({ length: Math.max(0, 2 - items.filter((r) => near(r, 'out&back', km)).length) }, () => ['out&back', km])),
];
console.log(`${items.length} routes saved, ${todo.length} to make`);
let fails = 0;
for (const [kind, km] of todo) {
  try {
    const rec = await makeRoute({ start, kind, target: km * 1000, prefs, seed: (seed += 7919) });
    if (rec) { items.push(rec); save(); process.stdout.write(`${kind[0]}${km} `); } else process.stdout.write('. ');
    fails = 0;
  } catch (e) {
    process.stdout.write('! ');
    if (++fails >= 4) { console.log('\nserver busy, pausing 30s'); await new Promise((r) => setTimeout(r, 30000)); fails = 0; }
  }
}
save();
console.log(`\ndone: ${items.length} routes -> ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
