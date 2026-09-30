// Übernimmt den Zeitplan aus den Audiodateien in die HTML-Datei und schreibt audio/timeline.json.
//
// Aufruf: node export/sync.mjs
// Liest:  Drehbuch (neueste Fassung), audio/szene_* (Rohdateien der Sprachausgabe), den Block ANKER aus der HTML-Datei
// Schreibt: audio/timeline.json (Sätze, Wortzeiten, Segmente für die Tonmischung, Untertitel)
//           den Block TIMELINE in der HTML-Datei (Szenenzeiten, Bild-Ton-Anker, Untertitel)
import fs from 'fs';
import path from 'path';
import { ROOT, HTML } from './lib.mjs';
import { findDrehbuch, parseDrehbuch } from './drehbuch.mjs';
import { planen, fuerHtml } from './timeline.mjs';

const html = fs.readFileSync(HTML, 'utf8');
const ankerText = html.match(/\/\* ANKER-BEGIN[^*]*\*\/\s*const ANKER = (\{[\s\S]*?\n\});\s*\/\* ANKER-END \*\//);
if (!ankerText) throw new Error('Block ANKER nicht in der HTML-Datei gefunden');
const ANKER = new Function('return ' + ankerText[1])();

const db = parseDrehbuch(findDrehbuch());
const tl = planen(db, ANKER);

// ---------------------------------------------------------------- audio/timeline.json
const dir = path.join(ROOT, 'audio');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ drehbuch: path.basename(db.file), gesamt: tl.gesamt, szenen: tl.szenen, cues: tl.cues }, null, 1) + '\n');

// ---------------------------------------------------------------- Block TIMELINE in der HTML-Datei
const h = fuerHtml(tl);
let block = '/* TIMELINE-BEGIN (erzeugt von export/sync.mjs aus den Audiodateien – nicht von Hand ändern) */\nconst TIMELINE = {\n  szenen: {\n';
block += Object.entries(h.szenen).map(([n, s]) => `    ${n}: ${JSON.stringify(s)}`).join(',\n') + '\n  },\n  cues: [\n';
block += h.cues.map(c => `    ${JSON.stringify(c)}`).join(',\n') + '\n  ],\n};\n/* TIMELINE-END */';
const neu = html.replace(/\/\* TIMELINE-BEGIN[\s\S]*?\/\* TIMELINE-END \*\//, () => block);
if (neu === html && !html.includes(block)) throw new Error('Block TIMELINE nicht in der HTML-Datei gefunden');
fs.writeFileSync(HTML, neu);

// ---------------------------------------------------------------- Bericht
const f = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
console.log('Szene  Drehbuch      Video          Länge  Sprechende  Verlängerung  Anker-Tempo (Bild/Ton)');
for (const S of tl.szenen) {
  const sl = [];
  for (let i = 1; i < S.anker.length; i++) sl.push(((S.anker[i][0] - S.anker[i - 1][0]) / (S.anker[i][1] - S.anker[i - 1][1])).toFixed(2));
  console.log(String(S.n).padStart(4), ' ', `${f(S.nominal[0])}–${f(S.nominal[1])}`.padEnd(12), `${f(S.start)}–${f(S.ende)}`.padEnd(13), String(S.ende - S.start).padStart(4) + ' s', String(S.audioEnde ?? '—').padStart(9), String(S.verlaengert ? '+' + S.verlaengert + ' s' : '–').padStart(12), '  ', sl.join(' '), S.fehlend.length ? `  (fehlt: ${S.fehlend.join(', ')})` : '');
}
console.log(`Gesamtlänge ${f(tl.gesamt)} (${tl.gesamt} s), ${tl.cues.length} Untertitel`);
for (const t of tl.hinweise) console.log('Hinweis:', t);
