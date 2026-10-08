// Tonmischung: setzt die Sprachsegmente laut audio/timeline.json auf die Zeitachse, legt die Hintergrundmusik darunter
// (export/musik.py, unter der Stimme abgesenkt) und normalisiert die Lautheit.
// Ziel: Sprache −16 LUFS, Gesamtmischung −16 LUFS integriert, True Peak höchstens −1 dBTP (EBU R128); 48 kHz, Stereo.
//
// Aufruf: node export/audio.mjs                          → output/.ton/Ton.wav für das ganze Video
//         node export/audio.mjs --ranges 224-268 --out output/.ton/Szene8.wav   → nur ein Ausschnitt (Sekunden)
//         --ohnemusik                                     → nur Sprache
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import crypto from 'crypto';
import { ROOT, EXPORT_DIR } from './lib.mjs';

export const ZIEL_LUFS = -16, ZIEL_TP = -1;

const ff = (args, opt = {}) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opt });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').split('\n').slice(-8).join('\n'));
  return r;
};

// Lautheit und True Peak einer Datei (ebur128)
export function messen(datei) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', datei, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const t = r.stderr || '';
  const z = t.slice(t.lastIndexOf('Summary:'));
  const num = re => { const m = z.match(re); return m ? Number(m[1]) : null; };
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

// Segmente (absolute Zeit im Video) für einen oder mehrere Ausschnitte [a, b]
function segmenteFuer(tl, ranges) {
  const alle = tl.szenen.flatMap(s => s.segmente);
  if (!ranges) return { segmente: alle, gesamt: tl.gesamt };
  const out = [];
  let versatz = 0;
  for (const [a, b] of ranges) {
    for (const s of alle) {
      const dauer = s.bis - s.von, ende = s.bei + dauer;
      if (ende <= a || s.bei >= b) continue;
      const kuerzAnfang = Math.max(0, a - s.bei), kuerzEnde = Math.max(0, ende - b);
      out.push({ ...s, von: s.von + kuerzAnfang, bis: s.bis - kuerzEnde, bei: s.bei + kuerzAnfang - a + versatz });
    }
    versatz += b - a;
  }
  return { segmente: out, gesamt: versatz };
}

export function mischen({ ranges = null, out = path.join(ROOT, 'output', '.ton', 'Ton.wav'), log = () => {}, musik = true } = {}) {
  const tlDatei = path.join(ROOT, 'audio', 'timeline.json');
  const tl = JSON.parse(fs.readFileSync(tlDatei, 'utf8'));
  const { segmente, gesamt } = segmenteFuer(tl, ranges);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const roh = out.replace(/\.wav$/i, '.roh.wav');
  const dateien = [...new Set(segmente.map(s => s.datei))];
  let graph = '';
  segmente.forEach((s, i) => {
    const d = s.bis - s.von, F = 0.008;
    graph += `[${dateien.indexOf(s.datei)}:a]atrim=start=${s.von}:end=${s.bis},asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:st=0:d=${F},afade=t=out:st=${Math.max(0, d - F).toFixed(3)}:d=${F},adelay=${Math.round(s.bei * 1000)}:all=1[s${i}];\n`;
  });
  if (segmente.length) graph += segmente.map((_, i) => `[s${i}]`).join('') + `amix=inputs=${segmente.length}:normalize=0:dropout_transition=0:duration=longest,apad=whole_dur=${gesamt},atrim=end=${gesamt},pan=stereo|c0=c0|c1=c0[m]`;
  else graph += `anullsrc=r=48000:cl=stereo,atrim=end=${gesamt}[m]`;
  const skript = out.replace(/\.wav$/i, '.filter.txt');
  fs.writeFileSync(skript, graph);
  ff([...dateien.flatMap(d => ['-i', path.join(ROOT, d)]), '-filter_complex_script', skript, '-map', '[m]', '-c:a', 'pcm_f32le', '-ar', '48000', roh]);
  const sprache = messen(roh);
  const gainSprache = ZIEL_LUFS - sprache.lufs;
  log(`Sprache: ${segmente.length} Segmente, ${gesamt.toFixed(2)} s, ${sprache.lufs} LUFS → Verstärkung ${gainSprache.toFixed(2)} dB auf ${ZIEL_LUFS} LUFS`);

  // Hintergrundmusik: für das ganze Video komponiert (Zeiten aus der Zeitachse), bei Ausschnitten passend geschnitten
  let musikDatei = null, musikStats = null;
  if (musik) {
    const voll = path.join(ROOT, 'output', '.ton', 'Musik.wav'), statsDatei = path.join(ROOT, 'output', '.ton', 'Musik.json');
    const stempel = path.join(ROOT, 'output', '.ton', 'Musik.stempel');
    const soll = crypto.createHash('sha1').update(fs.readFileSync(tlDatei)).update(fs.readFileSync(path.join(EXPORT_DIR, 'musik.py'))).digest('hex');
    if (!fs.existsSync(voll) || !fs.existsSync(stempel) || fs.readFileSync(stempel, 'utf8') !== soll) {
      log('Musik: wird komponiert (export/musik.py) …');
      const r = spawnSync('python3', [path.join(EXPORT_DIR, 'musik.py'), '--timeline', tlDatei, '--out', voll, '--stats', statsDatei], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('musik.py: ' + (r.stderr || '').split('\n').slice(-6).join('\n'));
      fs.writeFileSync(stempel, soll);
    }
    musikStats = JSON.parse(fs.readFileSync(statsDatei, 'utf8'));
    log(`Musik: ${musikStats.abschnitte.length} Abschnitte, in Sprechpausen ${musikStats.pause_lufs} LUFS, unter der Stimme ${musikStats.sprache_lufs} LUFS (Absenkung ${musikStats.absenkung_db} dB)`);
    musikDatei = voll;
    if (ranges) {
      musikDatei = out.replace(/\.wav$/i, '.musik.wav');
      const teile = ranges.map(([a, b], i) => `[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[m${i}]`).join(';');
      ff(['-i', voll, '-filter_complex', `${teile};${ranges.map((_, i) => `[m${i}]`).join('')}concat=n=${ranges.length}:v=0:a=1[m]`, '-map', '[m]', '-c:a', 'pcm_f32le', musikDatei]);
    }
  }

  // Summe: Sprache auf −16 LUFS, Musik darunter; danach Gesamtlautheit auf −16 LUFS und True Peak begrenzen
  const summe = out.replace(/\.wav$/i, '.summe.wav');
  if (musikDatei) ff(['-i', roh, '-i', musikDatei, '-filter_complex', `[0:a]volume=${gainSprache.toFixed(3)}dB[s];[1:a]aresample=48000,atrim=end=${gesamt},apad=whole_dur=${gesamt}[mu];[s][mu]amix=inputs=2:normalize=0:duration=first[m]`, '-map', '[m]', '-c:a', 'pcm_f32le', '-ar', '48000', summe]);
  else ff(['-i', roh, '-af', `volume=${gainSprache.toFixed(3)}dB`, '-c:a', 'pcm_f32le', '-ar', '48000', summe]);
  const vor = messen(summe);
  log(`Mischung vor der Normalisierung: ${vor.lufs} LUFS, True Peak ${vor.truePeak} dBTP`);
  let gain = ZIEL_LUFS - vor.lufs, grenze = -1.6, ergebnis = null;
  for (let versuch = 1; versuch <= 4; versuch++) {
    const lim = Math.pow(10, grenze / 20).toFixed(4);
    ff(['-i', summe, '-af', `volume=${gain.toFixed(3)}dB,alimiter=limit=${lim}:attack=3:release=40:level=false`, '-c:a', 'pcm_s16le', '-ar', '48000', out]);
    ergebnis = messen(out);
    log(`  Versuch ${versuch}: ${ergebnis.lufs} LUFS, True Peak ${ergebnis.truePeak} dBTP, LRA ${ergebnis.lra} LU`);
    const fehlerL = ergebnis.lufs - ZIEL_LUFS;
    if (Math.abs(fehlerL) <= 0.3 && ergebnis.truePeak <= ZIEL_TP) break;
    if (ergebnis.truePeak > ZIEL_TP) grenze -= (ergebnis.truePeak - ZIEL_TP) + 0.3;
    if (Math.abs(fehlerL) > 0.3) gain -= fehlerL;
  }
  const bericht = { sprache_lufs_roh: sprache.lufs, gain_sprache_db: +gainSprache.toFixed(3), gain_gesamt_db: +gain.toFixed(3), musik: musikStats ? { pause_lufs: musikStats.pause_lufs, sprache_lufs: musikStats.sprache_lufs, absenkung_db: musikStats.absenkung_db, abschnitte: musikStats.abschnitte.length } : null, ...ergebnis };
  fs.writeFileSync(out.replace(/\.wav$/i, '.json'), JSON.stringify(bericht, null, 1));
  for (const f of [roh, summe, ...(ranges && musikDatei ? [musikDatei] : [])]) fs.rmSync(f, { force: true });
  return { datei: out, dauer: gesamt, segmente: segmente.length, musik: musikStats, ...ergebnis };
}

// ---------------------------------------------------------------- Aufruf
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
  const ranges = opt('ranges', null) ? String(opt('ranges')).split(',').map(r => r.split('-').map(Number)) : null;
  const out = path.resolve(ROOT, opt('out', 'output/.ton/Ton.wav'));
  const r = mischen({ ranges, out, log: console.log, musik: !opt('ohnemusik', false) });
  console.log(`✓ ${path.relative(ROOT, r.datei)}: ${r.dauer.toFixed(2)} s, ${r.lufs} LUFS integriert, True Peak ${r.truePeak} dBTP`);
}
