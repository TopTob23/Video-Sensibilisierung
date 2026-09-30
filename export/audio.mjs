// Tonmischung: setzt die Sprachsegmente laut audio/timeline.json auf die Zeitachse und normalisiert die Lautheit.
// Ziel: −16 LUFS integriert, True Peak höchstens −1 dBTP (EBU R128); Ausgabe 48 kHz, zwei Kanäle. Keine Musik.
//
// Aufruf: node export/audio.mjs                          → output/.ton/Ton.wav für das ganze Video
//         node export/audio.mjs --ranges 224-268 --out output/.ton/Szene8.wav   → nur ein Ausschnitt (Sekunden)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { ROOT } from './lib.mjs';

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

export function mischen({ ranges = null, out = path.join(ROOT, 'output', '.ton', 'Ton.wav'), log = () => {} } = {}) {
  const tl = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio', 'timeline.json'), 'utf8'));
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
  const vor = messen(roh);
  log(`Mischung: ${segmente.length} Segmente, ${gesamt.toFixed(2)} s, vor der Normalisierung ${vor.lufs} LUFS, True Peak ${vor.truePeak} dBTP`);

  // Verstärkung auf −16 LUFS; True Peak begrenzen (Begrenzer knapp unter dem Ziel), dann nachmessen und ggf. nachstellen
  let gain = ZIEL_LUFS - vor.lufs, grenze = -1.6, ergebnis = null;
  for (let versuch = 1; versuch <= 4; versuch++) {
    const lim = Math.pow(10, grenze / 20).toFixed(4);
    ff(['-i', roh, '-af', `volume=${gain.toFixed(3)}dB,alimiter=limit=${lim}:attack=3:release=40:level=false`, '-c:a', 'pcm_s16le', '-ar', '48000', out]);
    ergebnis = messen(out);
    log(`  Versuch ${versuch}: ${ergebnis.lufs} LUFS, True Peak ${ergebnis.truePeak} dBTP, LRA ${ergebnis.lra} LU`);
    const fehlerL = ergebnis.lufs - ZIEL_LUFS;
    if (Math.abs(fehlerL) <= 0.3 && ergebnis.truePeak <= ZIEL_TP) break;
    if (ergebnis.truePeak > ZIEL_TP) grenze -= (ergebnis.truePeak - ZIEL_TP) + 0.3;
    if (Math.abs(fehlerL) > 0.3) gain -= fehlerL;
  }
  fs.rmSync(roh, { force: true });
  return { datei: out, dauer: gesamt, segmente: segmente.length, ...ergebnis };
}

// ---------------------------------------------------------------- Aufruf
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
  const ranges = opt('ranges', null) ? String(opt('ranges')).split(',').map(r => r.split('-').map(Number)) : null;
  const out = path.resolve(ROOT, opt('out', 'output/.ton/Ton.wav'));
  const r = mischen({ ranges, out, log: console.log });
  console.log(`✓ ${path.relative(ROOT, r.datei)}: ${r.dauer.toFixed(2)} s, ${r.lufs} LUFS integriert, True Peak ${r.truePeak} dBTP`);
}
