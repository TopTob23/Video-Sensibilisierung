// Standbilder für Abnahme und Prüfung.
// Beispiele:
//   node export/stills.mjs --t 4.5,76.2 --out output/muster --prefix Muster
//   node export/stills.mjs --scenes 0,3 --at 0.25,0.5,0.75 --out output/pruefung
import fs from 'fs';
import path from 'path';
import { loadPlaywright, openVideo, renderAt, ROOT } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const outDir = path.resolve(ROOT, args.out || 'output/stills');
fs.mkdirSync(outDir, { recursive: true });

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const { page, errors, info } = await openVideo(browser);

const jobs = [];
if (args.t) {
  for (const t of args.t.split(',').map(Number)) jobs.push({ t, name: `${args.prefix || 'Bild'}_t${t.toFixed(2).replace('.', '_')}s.png` });
}
if (args.scenes) {
  const fr = (args.at || '0.25,0.5,0.75').split(',').map(Number);
  for (const n of args.scenes.split(',').map(Number)) {
    const sc = info.SCENES.find(s => s.n === n);
    for (const f of fr) {
      const t = Math.round((sc.start + (sc.end - sc.start) * f) * info.FPS) / info.FPS;
      jobs.push({ t, name: `Szene${n}_${Math.round(f * 100)}pct_t${t.toFixed(2).replace('.', '_')}s.png` });
    }
  }
}
for (const j of jobs) {
  await renderAt(page, j.t);
  await page.screenshot({ path: path.join(outDir, j.name) });
  console.log('✓', j.name);
}
if (errors.length) { console.error('Fehler in der Seite:\n' + errors.join('\n')); process.exitCode = 1; }
await browser.close();
