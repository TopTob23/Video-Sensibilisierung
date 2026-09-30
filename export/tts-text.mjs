// Sprachtexte für die Sprachausgabe.
// Die Untertitel bleiben wortgleich mit dem Drehbuch (plus den freigegebenen Ergänzungen aus ergaenzungen.mjs);
// hier entsteht nur der Text für die Stimme:
// Abkürzungen und Zahlen werden ausgeschrieben. Jedes Drehbuch-Wort wird einzeln umgesetzt, damit die
// Zeitmarken der Stimme später den Untertitelwörtern zugeordnet werden können (Wort → gesprochene Form → Zeichenbereich).
//
// Aufruf: node export/tts-text.mjs   → schreibt audio/tts/szene_XX.txt, audio/tts/ERSETZUNGEN.md und audio/tts/ERGAENZUNGEN.md
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ROOT } from './lib.mjs';
import { findDrehbuch, parseDrehbuch } from './drehbuch.mjs';
import { ERGAENZUNGEN, ergaenzungenFuer } from './ergaenzungen.mjs';

// ---------------------------------------------------------------- Zahlen als Wort (0–9999)
const EINER = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const ZEHNER = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
const ZIFFER = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
function unter100(n, endstellung) {
  if (n < 20) return n === 1 && endstellung ? 'eins' : EINER[n];
  const z = Math.floor(n / 10), e = n % 10;
  return e ? EINER[e] + 'und' + ZEHNER[z] : ZEHNER[z];
}
export function zahlWort(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error('Zahl außerhalb von 0–9999: ' + n);
  if (n === 0) return 'null';
  const t = Math.floor(n / 1000), h = Math.floor((n % 1000) / 100), r = n % 100;
  let s = '';
  if (t) s += (t === 1 ? 'ein' : EINER[t]) + 'tausend';
  if (h) s += (h === 1 ? 'ein' : EINER[h]) + 'hundert';
  if (r) s += unter100(r, !t && !h);
  return s;
}

// ---------------------------------------------------------------- Regeln (Reihenfolge wichtig: NIS-2 vor den Zahlen)
export const REGELN = [
  { id: 'NIS-2', re: /\bNIS-2\b/g, nach: 'Nis-zwei' },
  { id: 'BSI', re: /\bBSI\b/g, nach: 'B-S-I' },
  { id: 'NRW', re: /\bNRW\b/g, nach: 'N-R-W' },
  { id: 'EU', re: /\bEU\b/g, nach: 'E-U' },
  { id: 'KI', re: /\bKI\b/g, nach: 'K-I' },
  { id: 'ISMS', re: /\bISMS\b/g, nach: 'I-S-M-S' },
  { id: 'IT', re: /\bIT\b/g, nach: 'I-T' },
  { id: 'Dezimalzahl', re: /\b\d+,\d+\b/g, nach: m => { const [a, b] = m.split(','); return `${zahlWort(+a)} Komma ${[...b].map(d => ZIFFER[+d]).join(' ')}`; } },
  { id: 'Zahl', re: /\b\d+\b/g, nach: m => zahlWort(+m) },
];

// Ortsname: Die Stimme nennt Herne nicht; „Stadt Herne“ → „Stadt“, „in Herne“ → „in der Stadt“ (Vorgabe des Auftraggebers).
// Im Bild und in den Untertiteln bleibt der Name stehen. Jede andere Stellung von „Herne“ bricht ab, damit nichts unbemerkt gesprochen wird.
const ORT = /^Herne([.,;:!?]*)$/;
function ortsname(wort, vorher) {
  const m = wort.match(ORT);
  if (!m) return null;
  const v = (vorher || '').replace(/[^\p{L}]/gu, '');
  if (/^stadt$/i.test(v)) return { nach: m[1], anzeige: 'Stadt Herne → Stadt' };
  if (/^in$/i.test(v)) return { nach: 'der Stadt' + m[1], anzeige: 'in Herne → in der Stadt' };
  throw new Error(`„Herne“ im Sprechertext ohne Regel: „${vorher || ''} ${wort}“ (Regel in ortsname() ergänzen)`);
}

function umsetzen(wort, vorher) {
  const ort = ortsname(wort, vorher);
  if (ort) return { gesprochen: ort.nach, treffer: [{ regel: 'Ortsname', von: wort, nach: ort.nach }] };
  let g = wort;
  const treffer = [];
  for (const r of REGELN) g = g.replace(r.re, m => { const nach = typeof r.nach === 'function' ? r.nach(m) : r.nach; treffer.push({ regel: r.id, von: m, nach }); return nach; });
  // Sicherung: nichts Ungeklärtes darf ins Audio (Ziffern, Buchstabenkürzel)
  if (/\d/.test(g) || /[A-ZÄÖÜ]{2,}/.test(g) || /Herne/.test(g)) throw new Error(`Ungeklärte Zahl oder Abkürzung im Sprechertext: „${wort}“ → „${g}“ (Regel in REGELN ergänzen)`);
  return { gesprochen: g, treffer };
}

// Text → gesprochene Form; tokens[i] = { wort, gesprochen, von, bis } mit Zeichenbereich [von, bis) im gesprochenen Text
export function sprechen(text) {
  const tokens = [];
  let out = '';
  const woerter = [...text.matchAll(/\S+/g)].map(m => m[0]);
  woerter.forEach((wort, i) => {
    const { gesprochen, treffer } = umsetzen(wort, woerter[i - 1]);
    if (out && !/^[.,;:!?]*$/.test(gesprochen)) out += ' ';     // entfallenes Wort: nur sein Satzzeichen bleibt, ohne Leerzeichen
    tokens.push({ wort, gesprochen, von: out.length, bis: out.length + gesprochen.length, treffer });
    out += gesprochen;
  });
  return { text: out, tokens };
}

// ---------------------------------------------------------------- Sprachtexte je Szene
const pad = n => String(n).padStart(2, '0');
export const STIMME_FRAGEN = ['A', 'B'];   // abwechselnd: A = weiblich, B = männlich

// Reihenfolge je Szene: Pressefragen, Erzähler (Ergänzung vor + Drehbuch + Ergänzung nach), Schlusssatz (eigener Teil)
export function sprachtexte(db) {
  const liste = [];
  for (const s of db.scenes) {
    if (s.press.length) liste.push({ szene: s.n, art: 'fragen', datei: `szene_${pad(s.n)}_fragen.txt`, teile: s.press.map((q, i) => ({ stimme: STIMME_FRAGEN[i % 2], ...sprechen(q), quelle: q })) });
    const text = [...ergaenzungenFuer(s.n, 'vor'), s.speech, ...ergaenzungenFuer(s.n, 'nach')].filter(Boolean).join(' ');
    if (text) liste.push({ szene: s.n, art: 'erzaehler', datei: `szene_${pad(s.n)}.txt`, teile: [{ stimme: 'Erzähler', ...sprechen(text), quelle: text }] });
    const schluss = ergaenzungenFuer(s.n, 'schluss').join(' ');
    if (schluss) liste.push({ szene: s.n, art: 'schluss', datei: `szene_${pad(s.n)}_schluss.txt`, teile: [{ stimme: 'Erzähler', ...sprechen(schluss), quelle: schluss }] });
  }
  return liste;
}

export function ergaenzungenMarkdown(db) {
  const wo = { vor: 'vor dem Sprechertext', nach: 'nach dem Sprechertext', schluss: 'auf der Schlusstafel (eigener Sprechteil)' };
  let md = `# Ergänzungen zum Sprechertext\n\nAuf Wunsch des Auftraggebers (Rückmeldung zum fertigen Video) spricht die Stimme zusätzlich zum Drehbuch (${path.basename(db.file)}) diese Sätze. `
    + 'Sie erscheinen auch in den Untertiteln. Der Drehbuchtext bleibt wortgleich; check.mjs lässt nur diese Ergänzungen an dieser Stelle zu.\n\n';
  md += '| Szene | Stelle | Text | Grund | Grundlage im Drehbuch |\n|---|---|---|---|---|\n';
  for (const e of ERGAENZUNGEN) md += `| ${e.szene} | ${wo[e.stelle]} | ${e.text} | ${e.grund} | ${e.grundlage} |\n`;
  md += '\nRegeln: Inhalt nur aus dem Drehbuch abgeleitet, keine neuen Zahlen, Fälle oder Belege; Sprachregeln des Drehbuchs; die Stimme nennt den Ortsnamen nicht.\n';
  return md;
}

const tokVorher = (e, t, tok) => { const i = t.tokens.indexOf(tok); return i > 0 ? t.tokens[i - 1].wort : ''; };
const anzeige = w => w.replace(/^[„“"(–]+|[.,;:!?“”)–]+$/g, '');

function ersetzungsListe(liste) {
  const zeilen = new Map();
  for (const e of liste) for (const t of e.teile) for (const tok of t.tokens) {
    if (!tok.treffer.length) continue;
    const ort = tok.treffer.some(r => r.regel === 'Ortsname');
    const von = ort ? `${anzeige(tokVorher(e, t, tok))} ${anzeige(tok.wort)}` : anzeige(tok.wort);
    const nach = ort ? `${anzeige(tokVorher(e, t, tok))} ${anzeige(tok.gesprochen)}`.trim() : anzeige(tok.gesprochen);
    const k = von + '\u0000' + nach;
    const z = zeilen.get(k) || { von, nach, regeln: new Set(), szenen: new Map() };
    tok.treffer.forEach(r => z.regeln.add(r.regel));
    z.szenen.set(e.szene, (z.szenen.get(e.szene) || 0) + 1);
    zeilen.set(k, z);
  }
  return [...zeilen.values()].sort((a, b) => Math.min(...a.szenen.keys()) - Math.min(...b.szenen.keys()) || a.von.localeCompare(b.von));
}

export function ersetzungenMarkdown(liste, db) {
  const z = ersetzungsListe(liste);
  let md = `# Aussprache: Ersetzungen im Sprachtext\n\nGrundlage: ${path.basename(db.file)}. Die Untertitel bleiben wortgleich mit dem Drehbuch, nur der Text für die Stimme wird angepasst.\n\n`;
  md += '## Angewendete Ersetzungen\n\n| Drehbuch | Sprachtext | Regel | Szene (Anzahl) |\n|---|---|---|---|\n';
  for (const r of z) md += `| ${r.von} | ${r.nach} | ${[...r.regeln].join(', ')} | ${[...r.szenen].map(([s, n]) => n > 1 ? `${s} (${n}×)` : s).join(', ')} |\n`;
  md += `\nInsgesamt ${z.length} verschiedene Wörter, ${z.reduce((a, r) => a + [...r.szenen.values()].reduce((x, y) => x + y, 0), 0)} Stellen.\n`;
  md += '\n## Regeln\n\n| Regel | Ersetzung |\n|---|---|\n';
  md += '| Ortsname | „Stadt Herne“ → „Stadt“, „in Herne“ → „in der Stadt“ (die Stimme nennt den Ortsnamen nicht; Bild und Untertitel zeigen ihn) |\n';
  md += '| NIS-2 | Nis-zwei |\n| BSI | B-S-I |\n| NRW | N-R-W |\n| EU | E-U |\n| KI | K-I |\n| ISMS | I-S-M-S |\n| IT | I-T |\n| Dezimalzahl | Ganzzahl als Wort, „Komma“, Ziffern einzeln (2,5 → zwei Komma fünf) |\n| Zahl | ausgeschrieben (2025 → zweitausendfünfundzwanzig) |\n';
  md += '\nEine Sicherung bricht ab, wenn im Sprachtext noch eine Ziffer oder ein Buchstabenkürzel steht, das keine Regel abdeckt.\n';
  md += '\n## Nicht ersetzt\n\n- „7:30 Uhr“ steht nur als Einblendung (Szene 6), nicht im Sprechertext.\n- „E-Mail“, „Sicherheitsupdates“, „Grundschutz-Checks“, „Audit“ und „Budget“ bleiben unverändert; sie werden beim Hörtest geprüft.\n- „neam“ (Szene 9, Firmenname der Kollegen, die die Schulung halten) bleibt unverändert; die Aussprache wird beim Hörtest geprüft.\n';
  return md;
}

function dateiInhalt(e) {
  if (e.art === 'fragen') return e.teile.map(t => `Stimme ${t.stimme} (${t.stimme === 'A' ? 'weiblich' : 'männlich'}): ${t.text}`).join('\n') + '\n';
  return e.teile.map(t => t.text).join('\n') + '\n';
}

// ---------------------------------------------------------------- Aufruf
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = parseDrehbuch(findDrehbuch());
  const liste = sprachtexte(db);
  const dir = path.join(ROOT, 'audio', 'tts');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^szene_\d+.*\.txt$/.test(f)) fs.rmSync(path.join(dir, f));
  for (const e of liste) fs.writeFileSync(path.join(dir, e.datei), dateiInhalt(e));
  fs.writeFileSync(path.join(dir, 'ERSETZUNGEN.md'), ersetzungenMarkdown(liste, db));
  fs.writeFileSync(path.join(dir, 'ERGAENZUNGEN.md'), ergaenzungenMarkdown(db));
  const zeichen = liste.reduce((a, e) => a + e.teile.reduce((x, t) => x + t.text.length, 0), 0);
  console.log(`${liste.length} Sprachtexte (${zeichen} Zeichen) nach audio/tts/, Ersetzungsliste in audio/tts/ERSETZUNGEN.md, Ergänzungen in audio/tts/ERGAENZUNGEN.md`);
}
