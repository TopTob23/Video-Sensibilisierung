// Export: nimmt jedes Bild über window.renderFrame(t) auf und setzt die Bilder mit ffmpeg
// zu einem MP4 zusammen (H.264, yuv420p, 30 fps, ohne Ton). Erzeugt zusätzlich die SRT mit dem Sprechertext.
//
// Aufruf:
//   node export/render.mjs                         → komplettes Video + SRT in output/
//   node export/render.mjs --ranges 0-12,56-88 --out output/muster/Muster.mp4 --nosrt
// Optionen: --workers N (parallele Render-Prozesse, Standard 3), --crf Q (Qualität, Standard 18),
//           --ohneton (ohne Sprachausgabe; sonst wird der Ton aus audio/timeline.json gemischt und als AAC 192 kbit/s eingebettet)
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { loadPlaywright, openVideo, renderAt, ROOT, BASENAME } from './lib.mjs';
import { mischen } from './audio.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const WORKERS = Number(opt('workers', 3));
const CRF = String(opt('crf', 18));
const OUT = path.resolve(ROOT, opt('out', `output/${BASENAME}.mp4`));
const SRT = OUT.replace(/\.mp4$/i, '.srt');
const ranges = opt('ranges', null);
const withSrt = !opt('nosrt', false);
const withTon = !opt('ohneton', false) && fs.existsSync(path.join(ROOT, 'audio', 'timeline.json'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmpDir = path.join(path.dirname(OUT), '.segmente');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const run = (cmd, args, stdio = ['ignore', 'inherit', 'inherit']) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio });
  p.on('error', rej);
  p.on('close', code => (code === 0 ? res() : rej(new Error(`${cmd} beendet mit Code ${code}`))));
});

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const probe = await openVideo(browser);
const { FPS, frames: TOTAL_FRAMES } = probe.info;
const cues = await probe.page.evaluate(() => window.VIDEO.CUES);
await probe.page.close();

// Bildliste
let list = [];
if (ranges) {
  for (const r of String(ranges).split(',')) {
    const [a, b] = r.split('-').map(Number);
    for (let i = Math.round(a * FPS); i < Math.round(b * FPS); i++) list.push(i);
  }
} else {
  for (let i = 0; i < TOTAL_FRAMES; i++) list.push(i);
}
console.log(`Render: ${list.length} Bilder (${(list.length / FPS).toFixed(2)} s) mit ${WORKERS} Prozessen …`);

// Gleichmäßig in zusammenhängende Abschnitte teilen
const chunks = [];
const per = Math.ceil(list.length / WORKERS);
for (let k = 0; k < WORKERS; k++) { const part = list.slice(k * per, (k + 1) * per); if (part.length) chunks.push(part); }

const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', CRF, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), '-g', String(FPS * 2)];
const t0 = Date.now();
let done = 0;
const errors = [];
await Promise.all(chunks.map(async (part, k) => {
  const { page, errors: errs } = await openVideo(browser);
  const cdp = await page.context().newCDPSession(page);
  const segFile = path.join(tmpDir, `seg_${String(k).padStart(2, '0')}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', ...x264, segFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg Segment ' + k)))));
  for (const i of part) {
    await renderAt(page, i / FPS);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    const buf = Buffer.from(shot.data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    done++;
    if (done % 150 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  ${done}/${list.length} Bilder · ${el.toFixed(0)} s · noch ca. ${((list.length - done) * el / done).toFixed(0)} s`);
    }
  }
  ff.stdin.end();
  await ffDone;
  errors.push(...errs);
  await page.close();
}));
await browser.close();
if (errors.length) { console.error('Fehler in der Seite:\n' + errors.join('\n')); process.exit(1); }

// Abschnitte ohne Neukodierung verbinden
const listFile = path.join(tmpDir, 'liste.txt');
fs.writeFileSync(listFile, fs.readdirSync(tmpDir).filter(f => f.endsWith('.mp4')).sort().map(f => `file '${path.join(tmpDir, f)}'`).join('\n'));
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
console.log(`✓ Video: ${path.relative(ROOT, OUT)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

// SRT aus denselben Cue-Daten wie die eingebrannten Untertitel
if (withSrt && !ranges) {
  const ts = sec => { const ms = Math.round(sec * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
  const body = cues.map((c, i) => `${i + 1}\r\n${ts(c.start)} --> ${ts(c.end)}\r\n${c.lines.join('\r\n')}\r\n`).join('\r\n');
  fs.writeFileSync(SRT, body, 'utf8');
  console.log(`✓ Untertitel: ${path.relative(ROOT, SRT)} (${cues.length} Einträge)`);
}
