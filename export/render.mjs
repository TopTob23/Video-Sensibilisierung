// Export: nimmt jedes Bild über window.renderFrame(t) auf und setzt die Bilder mit ffmpeg zu einem MP4 zusammen
// (H.264, yuv420p, 30 fps). Der Ton wird aus audio/timeline.json gemischt (−16 LUFS, True Peak ≤ −1 dBTP) und als
// AAC 192 kbit/s eingebettet. Erzeugt zusätzlich die SRT mit den Untertiteln.
//
// Der Export ist fortsetzbar: gerendert wird in Stücken (Standard 10 s), jedes fertige Stück wird markiert.
// Ein abgebrochener oder mit --budget begrenzter Lauf setzt beim nächsten Aufruf an derselben Stelle fort.
// Ändert sich die HTML-Datei, der Zeitplan oder eine Einstellung, werden vorhandene Stücke verworfen.
//
// Aufruf:
//   node export/render.mjs                         → komplettes Video + SRT in output/
//   node export/render.mjs --budget 1300           → höchstens ca. 1300 s rendern, dann anhalten (Exit-Code 3 = noch offen)
//   node export/render.mjs --ranges 0-12,56-88 --out output/muster/Muster.mp4 --nosrt
// Optionen: --workers N (parallele Render-Prozesse, Standard 3), --crf Q (Qualität, Standard 18),
//           --stueck S (Sekunden je Stück, Standard 10), --neu (vorhandene Stücke verwerfen),
//           --ohneton (ohne Sprachausgabe)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFileSync } from 'child_process';
import { loadPlaywright, openVideo, renderAt, ROOT, BASENAME, HTML } from './lib.mjs';
import { mischen } from './audio.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const WORKERS = Number(opt('workers', 3));
const CRF = String(opt('crf', 18));
const OUT = path.resolve(ROOT, opt('out', `output/${BASENAME}.mp4`));
const SRT = OUT.replace(/\.mp4$/i, '.srt');
const ranges = opt('ranges', null);
const withSrt = !opt('nosrt', false);
const TLFILE = path.join(ROOT, 'audio', 'timeline.json');
const withTon = !opt('ohneton', false) && fs.existsSync(TLFILE);
const STUECK = Number(opt('stueck', 10));
const BUDGET = Number(opt('budget', 0));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const run = (cmd, args, stdio = ['ignore', 'inherit', 'inherit']) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio });
  p.on('error', rej);
  p.on('close', code => (code === 0 ? res() : rej(new Error(`${cmd} beendet mit Code ${code}`))));
});
const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', CRF, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30', '-g', '60'];

// ---------------------------------------------------------------- Stücke und Stempel
const tmpDir = path.join(path.dirname(OUT), '.segmente', path.basename(OUT, '.mp4'));
const stempel = crypto.createHash('sha1').update(fs.readFileSync(HTML)).update(fs.existsSync(TLFILE) ? fs.readFileSync(TLFILE) : '')
  .update(JSON.stringify({ CRF, STUECK, ranges, x264 })).digest('hex');
const stempelDatei = path.join(tmpDir, 'STEMPEL');
if (opt('neu', false) || !fs.existsSync(stempelDatei) || fs.readFileSync(stempelDatei, 'utf8') !== stempel) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(stempelDatei, stempel);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const probe = await openVideo(browser);
const { FPS, frames: TOTAL_FRAMES } = probe.info;
const cues = await probe.page.evaluate(() => window.VIDEO.CUES);
await probe.page.close();

let list = [];
if (ranges) {
  for (const r of String(ranges).split(',')) {
    const [a, b] = r.split('-').map(Number);
    for (let i = Math.round(a * FPS); i < Math.round(b * FPS); i++) list.push(i);
  }
} else {
  for (let i = 0; i < TOTAL_FRAMES; i++) list.push(i);
}
const per = Math.max(1, Math.round(STUECK * FPS));
const stuecke = [];
for (let k = 0; k * per < list.length; k++) {
  const bilder = list.slice(k * per, (k + 1) * per);
  const name = `s_${String(k).padStart(4, '0')}.mp4`;
  stuecke.push({ k, bilder, datei: path.join(tmpDir, name), ok: path.join(tmpDir, name + '.ok') });
}
const offen = stuecke.filter(s => !fs.existsSync(s.ok));
for (const s of offen) fs.rmSync(s.datei, { force: true });            // halbfertige Stücke verwerfen
const fertigBilder = stuecke.filter(s => fs.existsSync(s.ok)).reduce((a, s) => a + s.bilder.length, 0);
console.log(`Render: ${list.length} Bilder (${(list.length / FPS).toFixed(2)} s) in ${stuecke.length} Stücken; ${stuecke.length - offen.length} fertig, ${offen.length} offen; ${WORKERS} Prozesse${BUDGET ? `, Budget ${BUDGET} s` : ''}`);

// ---------------------------------------------------------------- offene Stücke rendern
const t0 = Date.now();
let done = 0, abgeschlossen = 0;
const errors = [];
const queue = offen.slice();
const dauerJeStueck = [];
await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
  const { page, errors: errs } = await openVideo(browser);
  const cdp = await page.context().newCDPSession(page);
  while (queue.length) {
    const el = (Date.now() - t0) / 1000;
    const erwartet = dauerJeStueck.length ? Math.max(...dauerJeStueck) : 0;
    if (BUDGET && el + erwartet > BUDGET) break;                     // keine neuen Stücke mehr, die das Budget sprengen
    const s = queue.shift();
    const ts = Date.now();
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', ...x264, s.datei], { stdio: ['pipe', 'inherit', 'inherit'] });
    const ffDone = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg Stück ' + s.k)))));
    for (const i of s.bilder) {
      await renderAt(page, i / FPS);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true, optimizeForSpeed: true });
      const buf = Buffer.from(shot.data, 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      done++;
      if (done % 300 === 0) {
        const e = (Date.now() - t0) / 1000, rest = list.length - fertigBilder - done;
        console.log(`  ${fertigBilder + done}/${list.length} Bilder · ${e.toFixed(0)} s · noch ca. ${(rest * e / done).toFixed(0)} s`);
      }
    }
    ff.stdin.end();
    await ffDone;
    // vollständig? Anzahl der Bilder im Stück prüfen, dann als fertig markieren
    const n = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', s.datei]).toString().trim());
    if (n !== s.bilder.length) throw new Error(`Stück ${s.k}: ${n} statt ${s.bilder.length} Bilder`);
    fs.writeFileSync(s.ok, String(n));
    abgeschlossen++;
    dauerJeStueck.push((Date.now() - ts) / 1000);
  }
  errors.push(...errs);
  await page.close();
}));
await browser.close();
if (errors.length) { console.error('Fehler in der Seite:\n' + errors.join('\n')); process.exit(1); }
const nochOffen = stuecke.filter(s => !fs.existsSync(s.ok)).length;
if (nochOffen) {
  console.log(`Unterbrochen nach Budget: ${abgeschlossen} Stücke in diesem Lauf, noch ${nochOffen} von ${stuecke.length} offen – erneut aufrufen, es geht hier weiter.`);
  process.exit(3);
}

// ---------------------------------------------------------------- zusammensetzen, Ton, SRT
const listFile = path.join(tmpDir, 'liste.txt');
fs.writeFileSync(listFile, stuecke.map(s => `file '${s.datei}'`).join('\n'));
const stumm = path.join(tmpDir, 'video_ohne_ton.mp4');
await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', stumm]);
if (withTon) {
  const bereiche = ranges ? String(ranges).split(',').map(r => r.split('-').map(Number)) : null;
  const ton = mischen({ ranges: bereiche, out: path.join(ROOT, 'output', '.ton', path.basename(OUT).replace(/\.mp4$/i, '') + '.wav'), log: m => console.log('  Ton: ' + m) });
  console.log(`  Ton: ${ton.lufs} LUFS integriert, True Peak ${ton.truePeak} dBTP, ${ton.dauer.toFixed(2)} s`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', stumm, '-i', ton.datei, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT]);
} else {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', stumm, '-c', 'copy', '-movflags', '+faststart', OUT]);
}
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`✓ Video: ${path.relative(ROOT, OUT)} (${((Date.now() - t0) / 1000).toFixed(0)} s in diesem Lauf)`);

if (withSrt && !ranges) {
  const ts = sec => { const ms = Math.round(sec * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
  const body = cues.map((c, i) => `${i + 1}\r\n${ts(c.start)} --> ${ts(c.end)}\r\n${c.lines.join('\r\n')}\r\n`).join('\r\n');
  fs.writeFileSync(SRT, body, 'utf8');
  console.log(`✓ Untertitel: ${path.relative(ROOT, SRT)} (${cues.length} Einträge)`);
}
