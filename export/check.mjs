// Prüfung des Videos gegen das Drehbuch (Standard: die neueste Drehbuch-Datei im Projektordner, derzeit V1_7).
//
// Aufruf:
//   node export/check.mjs                      → Gesamtprüfung aller Szenen
//   node export/check.mjs --scenes 0,3         → nur diese Szenen (übrige werden als „noch offen“ gemeldet)
//   node export/check.mjs --stills             → zusätzlich Standbilder bei 25/50/75 % je Szene + Kontaktbogen
// Weitere Optionen: --drehbuch <Datei>  --step <s> (Abtastung sichtbarer Texte, Standard 0,2 s)
//                   --mp4 <Datei> --srt <Datei> (Standard: output/<Basisname>.mp4/.srt, falls vorhanden)
// Ergebnis: Konsole + output/pruefung/Pruefbericht[_SzenenX].md; Exit-Code 1 bei Fehlern.
import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { loadPlaywright, openVideo, renderAt, ROOT, BASENAME, HTML } from './lib.mjs';
import { findDrehbuch, parseDrehbuch } from './drehbuch.mjs';
import { ERZAEHLER, EINSTELLUNGEN, MODELL, fragenStimmen, teile } from './tts-lib.mjs';
import { ERGAENZUNGEN, ergaenzungenFuer } from './ergaenzungen.mjs';
import { KONFIG } from './timeline.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const DREHBUCH = opt('drehbuch', null) ? path.resolve(ROOT, opt('drehbuch')) : findDrehbuch();
const SCOPE = opt('scenes', null) ? String(opt('scenes')).split(',').map(Number) : null;
const STEP = Number(opt('step', 0.2));
const MP4 = path.resolve(ROOT, opt('mp4', `output/${BASENAME}.mp4`));
const SRT = path.resolve(ROOT, opt('srt', `output/${BASENAME}.srt`));
const OUTDIR = path.join(ROOT, 'output', 'pruefung');
fs.mkdirSync(OUTDIR, { recursive: true });

// ---------------------------------------------------------------- Ergebnisliste
const R = [];
const add = (bereich, status, text) => R.push({ bereich, status, text });
const OK = (b, t) => add(b, 'OK', t), FEHLER = (b, t) => add(b, 'FEHLER', t), WARN = (b, t) => add(b, 'WARNUNG', t), INFO = (b, t) => add(b, 'INFO', t);
const fmt = sec => { const m = Math.floor(sec / 60), s = sec - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

// ---------------------------------------------------------------- Drehbuch einlesen
const md = fs.readFileSync(DREHBUCH, 'utf8');
const norm = s => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
const mdNorm = norm(md);
const dScenes = [...md.matchAll(/^### Szene (\d+) – (.+?) \((\d+):(\d\d)–(\d+):(\d\d)\)/gm)]
  .map(m => ({ n: +m[1], title: m[2], start: +m[3] * 60 + +m[4], end: +m[5] * 60 + +m[6] }));
const dSpeech = {};
for (const sec of md.split(/\n### /).slice(1)) {
  const n = +sec.match(/^Szene (\d+)/)[1];
  const m = sec.match(/\*\*Sprechertext(?: \(ab \d+:\d\d\))?:\*\*\s*„([\s\S]*?)“/);
  if (m) dSpeech[n] = m[1];
}
const DB = parseDrehbuch(DREHBUCH);
const dPress = (DB.scenes.find(s => s.press.length) || { press: [] }).press;
const TLFILE = path.join(ROOT, 'audio', 'timeline.json');
const TL = fs.existsSync(TLFILE) ? JSON.parse(fs.readFileSync(TLFILE, 'utf8')) : null;
// zeitlich festgelegte Einblendungen laut Drehbuch
const timed = [];
{ const m = md.match(/\*\*Hinweis-Einblendung \((\d+):(\d\d)–(\d+):(\d\d)\):\*\*/); if (m) timed.push({ key: 'hinweis', from: +m[1] * 60 + +m[2], to: +m[3] * 60 + +m[4] }); }
{ const m = md.match(/\*\*Schlusstafel \((\d+):(\d\d)–(\d+):(\d\d)\):\*\*/); if (m) timed.push({ key: 'schluss_titel', from: +m[1] * 60 + +m[2], to: +m[3] * 60 + +m[4] }); }
// Auftrag, Regel 3 (Bildbestandteile außerhalb des Drehbuchs)
const AUFTRAG_AUSNAHMEN = {
  fassade: { soll: 'Gemeinsam für ein lebenswertes Herne', grund: 'Auftrag Regel 3: Spruch an der Fassade wie in der Stilreferenz', gross: true },
  stele: { soll: 'Stadt Herne', grund: 'Auftrag Regel 3: Text „Stadt Herne“' },
  haltestelle: { soll: 'H', grund: 'Haltestellenzeichen (Verkehrszeichen, kein Text)' },
};
// abgeleitete Beschriftungen (im Drehbuch als Aufzählung notiert)
const ABGELEITET = { woche_1: 'Woche 1, 2, 3, 4', woche_2: 'Woche 1, 2, 3, 4', woche_3: 'Woche 1, 2, 3, 4', woche_4: 'Woche 1, 2, 3, 4' };

// ---------------------------------------------------------------- Seite öffnen
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const { page, errors } = await openVideo(browser);
const V = await page.evaluate(() => window.VIDEO);
const inScope = n => !SCOPE || SCOPE.includes(n);
// Entwurfszeit d in Szene sc → absolute Videozeit (wie toActual in der HTML-Datei; Funktionen kommen nicht aus der Seite mit)
const toActual = (sc, d) => {
  const P = sc.anker || [];
  let x = d;
  if (P.length) {
    if (d <= P[0][0]) x = P[0][1] + (d - P[0][0]);
    else { x = null; for (let i = 1; i < P.length; i++) if (d <= P[i][0]) { x = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (d - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); break; } if (x === null) { const L = P[P.length - 1]; x = L[1] + (d - L[0]) / sc.tail; } }
  }
  return sc.start + x;
};
const sceneOf = t => V.SCENES.find(s => t >= s.start && t < s.end) || V.SCENES[V.SCENES.length - 1];

// ================================================================ A  Szenen und Zeiten
// Zeiten laut Drehbuch sind Richtwerte. Eine Szene dauert so lange, bis die Stimme fertig ist (plus Nachlauf) und das Bild
// seinen letzten Vorgang samt Haltezeit gezeigt hat (BILDENDE); stehende Bilder ohne Sprache werden nicht künstlich verlängert.
{
  const B = 'Szenen und Zeiten';
  let ok = true;
  const TLS = TL ? Object.fromEntries(TL.szenen.map(S => [S.n, S])) : {};
  if (dScenes.length !== V.SCENES.length) { FEHLER(B, `Anzahl Szenen: Drehbuch ${dScenes.length}, Video ${V.SCENES.length}`); ok = false; }
  for (const d of dScenes) {
    const v = V.SCENES.find(s => s.n === d.n);
    if (!v) { FEHLER(B, `Szene ${d.n} fehlt im Video`); ok = false; continue; }
    if (v.title !== d.title) { FEHLER(B, `Szene ${d.n}: Titel „${v.title}“ ≠ „${d.title}“`); ok = false; }
    const lv = v.end - v.start, ld = d.end - d.start;
    const S = TLS[d.n], be = V.BILDENDE && V.BILDENDE[d.n];
    // Bild vollständig: Die Szene dauert mindestens bis zur Entwurfszeit „Bild fertig“ plus Haltezeit
    if (be) {
      const fertig = toActual(v, be[0]) - v.start + be[1];
      if (lv + 1e-3 < fertig - 1 / 30) { FEHLER(B, `Szene ${d.n}: endet nach ${lv.toFixed(2)} s, das Bild ist erst nach ${fertig.toFixed(2)} s fertig`); ok = false; }
    } else { FEHLER(B, `Szene ${d.n}: kein Bildende (BILDENDE) festgelegt`); ok = false; }
    if (Math.abs(lv - ld) > 1e-6) INFO(B, `Szene ${d.n} „${d.title}“: ${fmt(v.start)}–${fmt(v.end)} (${lv.toFixed(2)} s) statt ${fmt(d.start)}–${fmt(d.end)} (${ld} s), ${lv > ld ? '+' : '−'}${Math.abs(lv - ld).toFixed(2)} s${S && S.audioEnde ? ` · Sprechende ${S.audioEnde.toFixed(2)} s, Bild fertig ${S.bildende ? S.bildende.ist.toFixed(2) + ' s' : '–'}` : ''}`);
  }
  for (let i = 1; i < V.SCENES.length; i++) if (Math.abs(V.SCENES[i].start - V.SCENES[i - 1].end) > 1e-6) { FEHLER(B, `Lücke/Überlappung zwischen Szene ${V.SCENES[i - 1].n} und ${V.SCENES[i].n}`); ok = false; }
  if (V.frames !== Math.round(V.TOTAL * V.FPS)) { FEHLER(B, `Bildanzahl ${V.frames} passt nicht zu ${V.TOTAL} s`); ok = false; }
  if (V.SCHLUSS_DAUER !== KONFIG.schlussDauer) { FEHLER(B, `Schlusstafel: HTML ${V.SCHLUSS_DAUER} s, Zeitplan ${KONFIG.schlussDauer} s`); ok = false; }
  if (ok) OK(B, `${dScenes.length} Szenen, Titel und Reihenfolge wie Drehbuch; jede Szene zeigt ihr Bild vollständig (Bildende + Haltezeit); Gesamtdauer ${fmt(V.TOTAL)} (${V.frames} Bilder bei ${V.FPS} fps; Richtwert Drehbuch ${fmt(dScenes[dScenes.length - 1].end)}, Drehbuchzeiten sind Richtwerte)`);
}

// ================================================================ B  Sprechertext
{
  const B = 'Sprechertext';
  for (const n of Object.keys(dSpeech).map(Number)) {
    if (V.SPRECHERTEXT[n] === dSpeech[n]) OK(B, `Szene ${n}: wortgleich (${dSpeech[n].length} Zeichen)`);
    else FEHLER(B, `Szene ${n}: weicht vom Drehbuch ab`);
  }
  for (const n of Object.keys(V.SPRECHERTEXT).map(Number)) if (!(n in dSpeech)) FEHLER(B, `Szene ${n}: Sprechertext im Video, aber nicht im Drehbuch`);
  if (dPress.length) {
    const same = JSON.stringify(V.PRESSEFRAGEN || []) === JSON.stringify(dPress);
    (same ? OK : FEHLER)(B, `Pressefragen (Szene 8): ${same ? `${dPress.length} Fragen wortgleich` : 'weichen vom Drehbuch ab'}`);
  }
  // Ergänzungen auf Wunsch des Auftraggebers (export/ergaenzungen.mjs): nur ganze, ruhige Sätze ohne Zahlen, Fragen oder Ortsnamen
  for (const e of ERGAENZUNGEN) {
    const probs = [];
    if (!dScenes.some(d => d.n === e.szene)) probs.push('Szene gibt es nicht');
    if (!['vor', 'nach', 'schluss'].includes(e.stelle)) probs.push(`unbekannte Stelle „${e.stelle}“`);
    if (/\d/.test(e.text)) probs.push('enthält Ziffern');
    if (/\?/.test(e.text)) probs.push('enthält eine Frage');
    if (/herne/i.test(e.text)) probs.push('nennt den Ortsnamen');
    if (!/[.]$/.test(e.text)) probs.push('endet nicht mit einem Satz');
    if (!mdNorm.includes(norm(e.text))) probs.push('steht nicht im Drehbuch');
    if (probs.length) FEHLER(B, `Ergänzung Szene ${e.szene}: ${probs.join(', ')}`);
    else OK(B, `Ergänzung Szene ${e.szene} (im Drehbuch festgehalten, ${e.stelle === 'vor' ? 'vor dem Sprechertext' : e.stelle === 'nach' ? 'nach dem Sprechertext' : 'Schlusssatz auf der Schlusstafel'}): „${e.text}“ – ${e.grund}; Grundlage: ${e.grundlage}`);
  }
}

// ================================================================ C  Untertitel (Cues)
const cueMetrics = [];
{
  const B = 'Untertitel';
  const cues = V.CUES.map((c, i) => ({ ...c, i }));
  // erwarteter Text je Szene: Pressefragen, Ergänzung vor, Sprechertext (Drehbuch), Ergänzung nach, Schlusssatz
  const sollText = n => { const dsc = DB.scenes.find(s => s.n === n); return [...(dsc && dsc.press.length ? dsc.press : []), ...ergaenzungenFuer(n, 'vor'), dSpeech[n], ...ergaenzungenFuer(n, 'nach'), ...ergaenzungenFuer(n, 'schluss')].filter(Boolean).join(' '); };
  for (const n of dScenes.map(d => d.n).filter(n => sollText(n))) {
    const sc = V.SCENES.find(s => s.n === n);
    const cs = cues.filter(c => c.scene === n);
    if (!cs.length) { (inScope(n) ? FEHLER : INFO)(B, `Szene ${n}: noch keine Untertitel`); continue; }
    const joined = cs.map(c => c.lines.join(' ')).join(' ');
    const dsc = DB.scenes.find(s => s.n === n);
    const soll = sollText(n);
    const erg = ['vor', 'nach', 'schluss'].some(st => ergaenzungenFuer(n, st).length);
    if (joined === soll) OK(B, `Szene ${n}: ${cs.length} Untertitel, zusammen wortgleich und vollständig${dsc && dsc.press.length ? ' (Pressefragen und Sprechertext)' : ''}${erg ? (dSpeech[n] ? ' (Drehbuch + freigegebene Ergänzung)' : ' (freigegebene Ergänzung)') : ''}`);
    else FEHLER(B, `Szene ${n}: Untertitel ergeben nicht den Sprechertext${dsc && dsc.press.length ? ' mit den Pressefragen' : ''}${erg ? ' und den Ergänzungen' : ''}`);
    cs.forEach((c, k) => {
      const dur = c.end - c.start, chars = c.lines.join(' ').length, cps = chars / dur;
      cueMetrics.push({ n, i: c.i, start: c.start, end: c.end, dur, chars, cps, lines: c.lines });
      if (c.start < sc.start || c.end > sc.end) FEHLER(B, `Cue ${c.i + 1} liegt außerhalb von Szene ${n}`);
      if (c.lines.length > 2) FEHLER(B, `Cue ${c.i + 1}: mehr als zwei Zeilen`);
      if (dur < 1.0) WARN(B, `Cue ${c.i + 1}: nur ${dur.toFixed(1)} s sichtbar`);
      // Die Untertitel folgen der Stimme; das Lesetempo ergibt sich aus dem Sprechtempo
      if (cps > 20) FEHLER(B, `Cue ${c.i + 1}: Lesetempo ${cps.toFixed(1)} Zeichen/s (> 20)`);
      else if (cps > 17) WARN(B, `Cue ${c.i + 1}: Lesetempo ${cps.toFixed(1)} Zeichen/s (> 17, folgt dem Sprechtempo)`);
      if (k > 0 && c.start < cs[k - 1].end) FEHLER(B, `Cue ${c.i + 1} überlappt Cue ${c.i}`);
      if (k > 0 && c.start - cs[k - 1].end < 0.06) WARN(B, `Cue ${c.i + 1}: Abstand zum Vorgänger < 2 Bilder`);
    });
  }
  // Sichtbarkeit, Wortlaut und Lage im Bild zur Cue-Mitte
  let geomOK = 0, geomTotal = 0;
  for (const c of cues) {
    if (!inScope(c.scene)) continue;
    const t = Math.round(((c.start + c.end) / 2) * V.FPS) / V.FPS;
    await renderAt(page, t);
    const els = await page.evaluate(() => [...document.querySelectorAll('#stage text[data-k="sub"]')].map(e => { const r = e.getBoundingClientRect(); return { cue: +e.dataset.cue, i: +e.dataset.i, text: e.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; }));
    geomTotal++;
    const mine = els.filter(e => e.cue === c.i).sort((a, b) => a.i - b.i);
    const probs = [];
    if (mine.map(e => e.text).join('|') !== c.lines.join('|')) probs.push('angezeigter Text weicht ab');
    for (const e of mine) {
      if (e.x < 40 || e.x + e.w > 1880) probs.push(`Zeile „${e.text.slice(0, 30)}…“ zu breit (${Math.round(e.w)} px)`);
      if (e.y < 0 || e.y + e.h > 1060) probs.push('Zeile außerhalb des Bildes');
    }
    if (probs.length) FEHLER(B, `Cue ${c.i + 1} bei ${fmt(t)}: ${probs.join('; ')}`); else geomOK++;
  }
  if (geomTotal) (geomOK === geomTotal ? OK : FEHLER)(B, `${geomOK} von ${geomTotal} Untertiteln zur Cue-Mitte korrekt angezeigt, vollständig im Bild, max. 2 Zeilen`);
  // Synchron zur Stimme: jeder Untertitel beginnt kurz vor seinem ersten gesprochenen Wort und steht bis nach dem letzten
  if (TL) {
    const worte = [];
    for (const S of TL.szenen) for (const st of S.saetze) for (const [w, a, b] of st.worte) worte.push({ w, a: S.start + a, b: S.start + b, n: S.n });
    let pos = 0, schlecht = 0, maxVor = 0;
    for (const c of V.CUES) {
      const anz = c.lines.join(' ').split(' ').length, ws = worte.slice(pos, pos + anz);
      pos += anz;
      if (ws.length !== anz || ws.map(x => x.w).join(' ') !== c.lines.join(' ')) { schlecht++; FEHLER(B, `Cue „${c.lines.join(' ').slice(0, 40)}…“ passt nicht zu den Wörtern der Sprachaufnahme`); continue; }
      const vor = ws[0].a - c.start, nach = c.end - ws[ws.length - 1].b;
      maxVor = Math.max(maxVor, vor);
      // bei dicht folgenden Wörtern liegt die Grenze mittig in der Wortlücke (± 1 Bild)
      if (vor < -0.05 || vor > 0.3 || nach < -0.05) { schlecht++; if (inScope(c.scene)) FEHLER(B, `Cue „${c.lines.join(' ').slice(0, 40)}…“ nicht synchron zur Stimme (Beginn ${vor.toFixed(2)} s vor dem ersten Wort, Ende ${nach.toFixed(2)} s nach dem letzten)`); }
    }
    if (!schlecht && pos === worte.length) OK(B, `alle ${V.CUES.length} Untertitel synchron zur Stimme: Beginn höchstens ${maxVor.toFixed(2)} s vor dem ersten Wort, Ende nach dem letzten Wort; SRT und Bild aus denselben Zeitmarken`);
    else if (pos !== worte.length) FEHLER(B, `Untertitel decken ${pos} von ${worte.length} gesprochenen Wörtern ab`);
  } else INFO(B, 'Zeitplan der Sprachaufnahmen (audio/timeline.json) fehlt – Synchronität nicht geprüft');
}

// ================================================================ D  Synchronpunkte
{
  const B = 'Synchronpunkte';
  for (const s of V.SYNC || []) {
    const sc = sceneOf(s.t);
    if (!inScope(sc.n)) continue;
    // Zeitpunkt des ersten Wortes der Phrase in der Sprachaufnahme
    const nw = x => x.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '');
    const pw = s.phrase.split(' ').map(nw);
    const worte = TL ? TL.szenen.flatMap(S => S.saetze.flatMap(st => st.worte.map(([w, a]) => ({ w: nw(w), a: S.start + a })))) : [];
    const i = worte.findIndex((_, k) => pw.every((p, q) => worte[k + q] && worte[k + q].w === p));
    if (i < 0) { FEHLER(B, `${s.label}: „${s.phrase}“ nicht in der Sprachaufnahme gefunden`); continue; }
    const d = worte[i].a - s.t;
    if (Math.abs(d) <= 0.1) OK(B, `${s.label} bei ${fmt(s.t)} – die Stimme sagt „${s.phrase}“ ab ${fmt(worte[i].a)} (Abweichung ${d.toFixed(2)} s)`);
    else FEHLER(B, `${s.label} bei ${fmt(s.t)}, die Stimme sagt „${s.phrase}“ erst/schon ab ${fmt(worte[i].a)}`);
  }
}

// ================================================================ E  Sichtbare Texte
const visibleTexts = new Map();   // Schlüssel → { text, von, bis, quelle }
{
  const B = 'Sichtbare Texte';
  // 1) Verzeichnis TEXTE: jeder Eintrag wörtlich im Drehbuch
  let regOK = 0;
  for (const [k, v] of Object.entries(V.TEXTE)) {
    if (ABGELEITET[k]) { if (mdNorm.includes(ABGELEITET[k])) INFO(B, `„${v}“ (${k}) abgeleitet aus Bildbeschreibung „${ABGELEITET[k]}“`); else FEHLER(B, `${k}: Grundlage „${ABGELEITET[k]}“ fehlt im Drehbuch`); continue; }
    if (mdNorm.includes(norm(v))) regOK++; else FEHLER(B, `Textverzeichnis: „${v}“ (${k}) steht so nicht im Drehbuch`);
  }
  OK(B, `${regOK} Einträge im Textverzeichnis wörtlich im Drehbuch enthalten`);
  for (const [k, v] of Object.entries(V.TEXTE_AUSNAHMEN)) {
    const a = AUFTRAG_AUSNAHMEN[k];
    if (!a) FEHLER(B, `Ausnahme ${k} („${v}“) ist nicht durch den Auftrag gedeckt`);
    else if ((a.gross ? v.toLowerCase() : v) !== (a.gross ? a.soll.toLowerCase() : a.soll)) FEHLER(B, `Ausnahme ${k}: „${v}“ ≠ „${a.soll}“`);
    else INFO(B, `Bildbestandteil „${v}“ – ${a.grund}`);
  }
  // 2) Abtastung: alle im Bild vorhandenen Texte tragen eine Kennung und ergeben wortgleich ihren Eintrag
  const expect = k => (k in V.TEXTE ? V.TEXTE[k] : k in V.TEXTE_AUSNAHMEN ? V.TEXTE_AUSNAHMEN[k] : null);
  const issues = new Map();
  const note = (key, msg) => { if (!issues.has(key)) issues.set(key, msg); };
  const checkGroup = (els, t) => {
    // Gruppierung je Vorkommen: aufeinanderfolgende Zeilen (data-i 0, 1, 2 …) desselben Schlüssels bilden einen Textblock
    const groups = [];
    const open = {};
    for (const e of els) {
      if (e.op <= 0.001) continue;   // unsichtbar (ausgeblendet)
      if (!e.k) { note('ohne:' + e.text, `Text ohne Kennung „${e.text}“ (${fmt(t)})`); continue; }
      if (e.k === 'sub') continue;   // Untertitel separat geprüft
      if (e.k === 'platzhalter') { note('ph:' + sceneOf(t).n, `Platzhalter sichtbar in Szene ${sceneOf(t).n} („${e.text}“)`); continue; }
      const g = open[e.k];
      if (g && e.i === g[g.length - 1].i + 1) g.push(e);
      else { const ng = [e]; groups.push([e.k, ng]); open[e.k] = ng; }
    }
    for (const [k, list] of groups) {
      const joined = list.map(e => e.text).join(' ');
      const soll = expect(k);
      if (soll === null) note('unbek:' + k, `unbekannter Textschlüssel ${k}: „${joined}“`);
      else if (joined !== soll) note('abw:' + k + joined, `„${joined}“ (${k}) ≠ Drehbuch „${soll}“ (${fmt(t)})`);
      const vis = Math.max(...list.map(e => e.op));
      if (vis > 0.05) {
        const r = visibleTexts.get(k) || { text: soll, von: t, bis: t, opMax: 0, times: [] };
        r.von = Math.min(r.von, t); r.bis = Math.max(r.bis, t); r.opMax = Math.max(r.opMax, vis);
        if (r.times[r.times.length - 1] !== t) r.times.push(t);
        visibleTexts.set(k, r);
      }
    }
  };
  // statische Bildtexte in den Vorlagen (Fassade, Stele, Zeichen …)
  const defsEls = await page.evaluate(() => [...document.querySelectorAll('#defs text')].map(e => ({ k: e.dataset.k || null, i: +(e.dataset.i || 0), text: e.textContent, op: 1 })));
  checkGroup(defsEls, 0);
  for (const e of defsEls) if (e.k) { const r = visibleTexts.get(e.k); if (r) { r.statisch = true; } }
  // zeitliche Abtastung
  const ranges = [];
  for (const sc of V.SCENES) if (inScope(sc.n)) ranges.push(SCOPE ? [Math.max(0, sc.start + 0.5), Math.min(V.TOTAL, sc.end - 0.5)] : [sc.start, sc.end]);
  if (SCOPE && SCOPE.includes(0)) ranges[0][0] = 0;
  let samples = 0;
  const timedSeen = {};
  const ueberdeckt = new Map();
  const vermerkUeberdeckt = new Map();
  for (const [a, b] of ranges) {
    for (let t = a; t < b - 1e-6; t += STEP) {
      const tt = Math.round(t * V.FPS) / V.FPS;
      await renderAt(page, tt);
      const { els, marke, rahmen } = await page.evaluate(() => {
        const opOf = e => { let op = 1, n = e; while (n && n.id !== 'stage') { const cs = getComputedStyle(n); if (cs.display === 'none') return 0; op *= parseFloat(cs.opacity || '1'); n = n.parentElement; } return op; };
        const brand = document.querySelector('#stage svg.brand');
        const img = brand && brand.querySelector('image');
        const marke = img ? { op: opOf(img), rahmen: markeRahmen() } : null;
        const els = [...document.querySelectorAll('#stage text')].map(e => {
          const r = e.getBoundingClientRect();
          return { k: e.dataset.k || null, i: +(e.dataset.i || 0), text: e.textContent, op: opOf(e), marke: !!e.closest('svg.brand'), box: [r.x, r.y, r.width, r.height] };
        });
        const rahmen = [...document.querySelectorAll('#stage rect[data-rahmen]')].map(e => { const r = e.getBoundingClientRect(); return { k: e.dataset.rahmen, op: opOf(e), box: [r.x, r.y, r.width, r.height] }; });
        return { els, marke, rahmen };
      });
      checkGroup(els, tt);
      // Marke oben rechts darf Titelkarte, Einblendungen und Untertitel nicht überdecken
      if (marke && marke.op > 0.05) {
        const m = marke.rahmen;
        for (const e of els) {
          if (e.marke || e.op <= 0.05 || !e.k) continue;
          const [x, y, w, h] = e.box;
          if (x < m.x + m.w && x + w > m.x && y < m.y + m.h && y + h > m.y) {
            const bild = e.k in V.TEXTE_AUSNAHMEN;
            ueberdeckt.set(e.k + (bild ? ':bild' : ''), { k: e.k, text: e.text, t: tt, bild });
          }
        }
      }
      // Untertitelband und Vertraulich-Vermerk: mindestens 8 px Abstand (gemessen an den Rahmen im Bild)
      const bänder = rahmen.filter(r => r.k === 'sub' && r.op > 0.05), verm = rahmen.filter(r => r.k === 'vertraulich' && r.op > 0.05);
      for (const b of bänder) for (const v of verm) {
        const [x, y, w, h] = b.box, [vx, vy, vw, vh] = v.box, A = 8;
        if (x - A < vx + vw && x + w + A > vx && y - A < vy + vh && y + h + A > vy) vermerkUeberdeckt.set((els.find(e => e.k === 'sub') || { text: '' }).text, tt);
      }
      for (const tm of timed) { const vis = Math.max(0, ...els.filter(e => e.k === tm.key).map(e => e.op)); (timedSeen[tm.key] = timedSeen[tm.key] || []).push([tt, vis]); }
      samples++;
    }
  }
  if (issues.size) for (const m of issues.values()) (m.startsWith('Platzhalter') ? (SCOPE ? INFO : FEHLER) : FEHLER)(B, m);
  const hard = [...issues.values()].filter(m => !m.startsWith('Platzhalter')).length;
  if (!hard) OK(B, `${samples} Zeitpunkte abgetastet (alle ${STEP} s${SCOPE ? ', Szenen ' + SCOPE.join(', ') : ''}): jeder Text trägt eine Kennung und ist wortgleich`);
  // Einblendezeiten laut Drehbuch, umgerechnet auf die Videozeit: am Szenenende ausgerichtet (Schlusstafel) oder ab Szenenbeginn
  for (const tm of timed) {
    const d = dScenes.find(x => tm.from >= x.start && tm.from < x.end), v = d && V.SCENES.find(x => x.n === d.n);
    if (d && v) {
      const len = tm.to - tm.from, amEnde = tm.key === 'schluss_titel';   // Schlusstafel am Videoende, alles andere ab Szenenbeginn
      const von = amEnde ? v.end - len : v.start + (tm.from - d.start);
      if (Math.abs(von - tm.from) > 1e-6) INFO(B, `Einblendung „${tm.key}“: laut Drehbuch ${fmt(tm.from)}–${fmt(tm.to)}, im Video ${fmt(von)}–${fmt(von + len)} (Szene ${d.n} verschoben)`);
      tm.from = von; tm.to = von + len;
    }
    if (!inScope(sceneOf(tm.from).n)) { INFO(B, `Einblendung „${tm.key}“ (${fmt(tm.from)}–${fmt(tm.to)}): Szene ${sceneOf(tm.from).n} nicht im Prüfumfang`); continue; }
    const seen = timedSeen[tm.key];
    if (!seen) continue;
    const inside = seen.filter(([t]) => t >= tm.from + 0.4 && t <= tm.to - 0.4);
    const outside = seen.filter(([t]) => t < tm.from - 0.05 || t > tm.to + 0.05);
    const inOK = inside.length && inside.every(([, v]) => v > 0.5), outOK = outside.every(([, v]) => v < 0.05);
    if (inOK && outOK) OK(B, `Einblendung „${tm.key}“ sichtbar ${fmt(tm.from)}–${fmt(tm.to)} wie im Drehbuch`);
    else FEHLER(B, `Einblendung „${tm.key}“: Sichtbarkeit weicht von ${fmt(tm.from)}–${fmt(tm.to)} ab`);
  }
  // Marke: Überdeckung
  for (const u of ueberdeckt.values()) (u.bild ? WARN : FEHLER)('Marke', `Marke oben rechts überdeckt ${u.bild ? 'den Bildtext' : 'die Einblendung'} „${u.text}“ (${u.k}) bei ${fmt(u.t)}`);
  if (!ueberdeckt.size) OK('Marke', `Marke oben rechts überdeckt an keinem der ${samples} Zeitpunkte eine Titelkarte, Einblendung oder einen Untertitel`);
  for (const [text, t] of vermerkUeberdeckt) FEHLER('Untertitel', `Untertitel „${text.slice(0, 40)}…“ berührt bei ${fmt(t)} den Vertraulich-Vermerk`);
  if (!vermerkUeberdeckt.size) OK('Untertitel', `Untertitel und Vertraulich-Vermerk (Titelkarte, Schlusstafel) berühren sich an keinem der ${samples} Zeitpunkte`);
  // „Woche 5“ darf nicht mehr vorkommen (V1.2: Kalenderblätter nur bis Woche 4)
  const html = fs.readFileSync(HTML, 'utf8');
  if (/Woche 5/.test(html)) FEHLER(B, '„Woche 5“ kommt im Video vor (V1.2: nur bis Woche 4)'); else OK(B, '„Woche 5“ kommt nicht vor (V1.2: Kalenderblätter bis Woche 4)');
}

// ================================================================ F  Verbotene Inhalte (Textsuche)
{
  const B = 'Verbotsliste';
  const PRODUKTE = ['Microsoft', 'Windows', 'Outlook', 'Exchange', 'Office 365', 'Microsoft 365', 'Azure', 'Entra', 'Active Directory', 'Intune', 'SharePoint', 'Teams',
    'VMware', 'vSphere', 'ESXi', 'Hyper-V', 'Citrix', 'NetScaler', 'Cisco', 'Fortinet', 'FortiGate', 'Palo Alto', 'Sophos', 'Check Point', 'Juniper', 'SonicWall', 'Ivanti',
    'Veeam', 'Commvault', 'Acronis', 'Synology', 'QNAP', 'Linux', 'Ubuntu', 'Debian', 'Red Hat', 'SUSE', 'Oracle', 'SAP', 'Apache', 'nginx', 'IIS', 'Tomcat', 'OpenSSH', 'OpenSSL',
    'Kerberos', 'LDAP', 'NTLM', 'RDP', 'SMB', 'VPN', 'Mimikatz', 'Cobalt Strike', 'Metasploit', 'Nmap', 'PsExec', 'BloodHound', 'LockBit', 'Conti', 'BlackCat', 'ALPHV', 'Akira', 'Ryuk',
    'Emotet', 'Qakbot', 'TrickBot', 'Log4j', 'ProxyShell', 'ProxyLogon', 'Zero-Day', 'Darknet', 'Dark Web', 'Tor-Netzwerk', 'Bitcoin', 'Kryptowährung'];
  // Werkzeuge und Schriften, die der Auftrag selbst vorgibt: im Code erklärbar, im Bild verboten
  const WERKZEUGE = ['Playwright', 'Puppeteer', 'Chromium', 'Chrome', 'ffmpeg', 'ffprobe', 'libx264', 'x264', 'H.264', 'Node', 'npm'];
  const SCHRIFTEN = ['Arial', 'Liberation Sans', 'Helvetica'];
  const BEFEHLE = ['cmd.exe', 'powershell', 'sudo ', 'ssh ', 'net user', 'whoami', 'ipconfig', 'nslookup', 'wget ', 'curl ', 'chmod ', 'rm -rf', 'regedit', 'mstsc'];
  const MUSTER = [
    ['IPv4-Adresse', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
    ['IPv6-Adresse', /\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){4,}\b/gi],
    ['Versionsnummer', /\b[vV]?\d+\.\d+\.\d+(?:\.\d+)?\b/g],
    ['Versionsangabe', /\bVersion\s*\d/g],
    ['Port', /\b[Pp]ort\s*\d{2,5}\b|:\d{2,5}\/(?:tcp|udp)\b/g],
    ['URL', /https?:\/\/[^\s'"<>)]+/g],
    ['Schwachstellen-ID', /\bCVE-\d{4}-\d+/gi],
  ];
  const wordRe = w => new RegExp('(?<![\\wÄÖÜäöüß])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\wÄÖÜäöüß])', 'gi');
  const scan = (label, content, strict) => {
    const hits = [];
    for (const w of PRODUKTE) for (const m of content.matchAll(wordRe(w))) hits.push(['Produkt/Begriff', m[0], m.index]);
    for (const w of WERKZEUGE) for (const m of content.matchAll(wordRe(w))) hits.push(['Werkzeug', m[0], m.index]);
    for (const w of SCHRIFTEN) for (const m of content.matchAll(wordRe(w))) hits.push(['Schrift', m[0], m.index]);
    for (const w of BEFEHLE) { let i = -1; const lc = content.toLowerCase(); while ((i = lc.indexOf(w.toLowerCase(), i + 1)) >= 0) hits.push(['Befehl', w.trim(), i]); }
    for (const [name, re] of MUSTER) for (const m of content.matchAll(re)) hits.push([name, m[0], m.index]);
    return hits.map(([typ, wort, idx]) => ({ typ, wort, ctx: content.slice(Math.max(0, idx - 40), idx + wort.length + 40).replace(/\s+/g, ' ') , strict, label }));
  };
  // sichtbare Texte und Untertitel: streng (jeder Treffer = Fehler)
  const visible = [...Object.values(V.TEXTE), ...Object.values(V.TEXTE_AUSNAHMEN), ...V.CUES.map(c => c.lines.join(' '))].join('\n');
  const vHits = scan('sichtbare Texte/Untertitel', visible, true);
  if (vHits.length) vHits.forEach(h => FEHLER(B, `sichtbarer Text: ${h.typ} „${h.wort}“ in „…${h.ctx}…“`));
  else OK(B, 'Sichtbare Texte und Untertitel: keine Produkt-/Herstellernamen, Versionen, IP-Adressen, Ports, Befehle oder URLs');
  if (fs.existsSync(SRT)) {
    const sHits = scan('SRT', fs.readFileSync(SRT, 'utf8'), true);
    if (sHits.length) sHits.forEach(h => FEHLER(B, `SRT: ${h.typ} „${h.wort}“`)); else OK(B, `SRT (${path.basename(SRT)}): keine Treffer`);
  } else INFO(B, 'SRT noch nicht erzeugt – wird beim Export mitgeprüft');
  // Sprechtexte, die an die Sprachausgabe gehen (audio/tts/*.txt und die gesendeten Texte in audio/*.json)
  {
    const tdir = path.join(ROOT, 'audio', 'tts'), adir = path.join(ROOT, 'audio');
    const quellen = [];
    if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir).filter(f => f.endsWith('.txt'))) quellen.push([`audio/tts/${f}`, fs.readFileSync(path.join(tdir, f), 'utf8')]);
    if (fs.existsSync(adir)) for (const f of fs.readdirSync(adir).filter(f => /^szene_.*\.json$/.test(f))) { const j = JSON.parse(fs.readFileSync(path.join(adir, f), 'utf8')); quellen.push([`audio/${f}`, [j.text, j.kontext?.vorher, j.kontext?.nachher].filter(Boolean).join('\n')]); }
    const tHits = quellen.flatMap(([f, t]) => scan(f, t, true).map(h => ({ ...h, f })));
    if (tHits.length) tHits.forEach(h => FEHLER(B, `Sprechtext ${h.f}: ${h.typ} „${h.wort}“`)); else OK(B, `Sprechtexte für die Sprachausgabe (${quellen.length} Dateien): keine Treffer`);
    const ort = quellen.filter(([, t]) => /herne/i.test(t));
    if (ort.length) ort.forEach(([f]) => FEHLER(B, `Ortsname in einem Text für die Sprachausgabe: ${f} (Vorgabe: die Stimme sagt „die Stadt“)`));
    else OK(B, `Ortsname kommt in keinem Text für die Sprachausgabe vor (Vorgabe des Auftraggebers)`);
  }
  // Code: Treffer mit Einordnung
  const files = [HTML, ...fs.readdirSync(path.join(ROOT, 'export')).filter(f => /\.(mjs|py)$/.test(f)).map(f => path.join(ROOT, 'export', f)), path.join(ROOT, 'package.json')];
  const known = [
    [/^URL$/, /w3\.org\/2000\/svg/, 'SVG-Namensraum (technisch notwendig, nicht im Bild)'],
    [/^URL$/, /api\.elevenlabs\.io/, 'Schnittstelle der Sprachausgabe (nur im Skript, nicht im Bild)'],
    [/^Werkzeug$/, /./, 'Export-Werkzeug laut Auftrag (Node, Playwright, ffmpeg/H.264), nur in Skripten'],
    [/^Schrift$/, /./, 'Schriftangabe laut Auftrag (Arial bzw. maßgleiche Ersatzschrift)'],
    [/^Versionsnummer$/, /"(version|playwright)"\s*:/, 'Paketversion in package.json (Build-Werkzeug, nicht im Video)'],
  ];
  const codeHits = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    // Die Prüfliste in check.mjs selbst enthält die Suchbegriffe – nicht als Treffer werten
    const body = f.endsWith('check.mjs') ? txt.replace(/const (PRODUKTE|WERKZEUGE|SCHRIFTEN|BEFEHLE|MUSTER|known) = \[[\s\S]*?\n  \];|const (WERKZEUGE|SCHRIFTEN) = \[.*?\];/g, '') : txt;
    for (const h of scan(path.relative(ROOT, f), body, false)) {
      const k = known.find(([typ, re]) => typ.test(h.typ) && re.test(h.ctx));
      codeHits.push({ ...h, file: path.relative(ROOT, f), einordnung: k ? k[2] : null });
    }
  }
  const unklar = codeHits.filter(h => !h.einordnung);
  const erklärt = codeHits.filter(h => h.einordnung);
  if (erklärt.length) {
    const byReason = {};
    for (const h of erklärt) (byReason[h.einordnung] = byReason[h.einordnung] || new Set()).add(`${h.wort} [${h.file}]`);
    for (const [grund, set] of Object.entries(byReason)) INFO(B, `Code, eingeordnet: ${grund} – ${[...set].join(', ')}`);
  }
  if (unklar.length) unklar.forEach(h => WARN(B, `Code ${h.file}: ${h.typ} „${h.wort}“ – „…${h.ctx}…“`));
  else OK(B, `Code (${files.length} Dateien): keine Produktnamen, Versionen, IP-Muster, Ports oder Befehle außer erklärten Stellen`);
}

// ================================================================ G  Zahlen
{
  const B = 'Zahlen';
  const sources = [];
  for (const [k, v] of Object.entries(V.TEXTE)) sources.push([`Text ${k}`, v]);
  for (const c of V.CUES) sources.push([`Untertitel ${fmt(c.start)}`, c.lines.join(' ')]);
  const found = [];
  for (const [src, txt] of sources) for (const m of txt.matchAll(/\d+(?:[.,:]\d+)*/g)) found.push({ src, num: m[0], ctx: txt.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25) });
  let bad = 0;
  for (const f of found) if (!mdNorm.includes(f.num)) { bad++; FEHLER(B, `Zahl „${f.num}“ (${f.src}) steht nicht im Drehbuch`); }
  // Zahlen mit Kontext wörtlich im Drehbuch?
  for (const f of found) { const key = f.src.replace('Text ', ''); if (ABGELEITET[key]) continue; const ctx = norm(f.ctx.trim()); if (!mdNorm.includes(ctx) && !f.src.startsWith('Untertitel')) WARN(B, `Kontext von „${f.num}“ nicht wörtlich gefunden: „${ctx}“`); }
  if (!bad) OK(B, `${found.length} Zahlen in Texten/Untertiteln, alle wörtlich im Drehbuch: ${[...new Set(found.map(f => f.num))].join(', ') || '–'}`);
}

// ================================================================ H  Dauer, SRT, MP4
{
  const B = 'Dauer und Dateien';
  const rows = V.SCENES.map(s => `Szene ${s.n} ${fmt(s.start)}–${fmt(s.end)} (${(s.end - s.start).toFixed(2)} s)`).join(' · ');
  INFO(B, rows);
  if (fs.existsSync(SRT)) {
    const srt = fs.readFileSync(SRT, 'utf8').replace(/\r/g, '').trim().split(/\n\n+/);
    const parsed = srt.map(b => { const l = b.split('\n'); const m = l[1].match(/(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/); const ts = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000; return { start: ts(m[1], m[2], m[3], m[4]), end: ts(m[5], m[6], m[7], m[8]), text: l.slice(2) }; });
    const same = parsed.length === V.CUES.length && parsed.every((p, i) => Math.abs(p.start - V.CUES[i].start) < 0.002 && Math.abs(p.end - V.CUES[i].end) < 0.002 && p.text.join('|') === V.CUES[i].lines.join('|'));
    (same ? OK : FEHLER)(B, `SRT: ${parsed.length} Einträge, ${same ? 'Text und Zeiten identisch mit den eingebrannten Untertiteln' : 'weicht von den Untertiteln ab'}`);
  }
  if (fs.existsSync(MP4)) {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_frames,codec_type,sample_rate,channels,bit_rate,duration:format=duration,size', '-of', 'json', MP4]).toString());
    const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
    const okV = v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1' && +v.nb_read_frames === V.frames;
    (okV ? OK : FEHLER)(B, `MP4 Bild: ${v.codec_name} ${v.profile}, ${v.width}×${v.height}, ${v.pix_fmt}, ${v.r_frame_rate} fps, ${v.nb_read_frames} Bilder (Soll ${V.frames}), ${(+j.format.duration).toFixed(3)} s, ${(j.format.size / 1e6).toFixed(1)} MB`);
    if (!a) FEHLER(B, 'MP4 ohne Tonspur');
    else {
      const kbit = Math.round(+a.bit_rate / 1000), vd = +v.nb_read_frames / 30, ad = +a.duration;
      // Bitrate während der Sprache (in Pausen braucht AAC kaum Daten, der Mittelwert liegt deshalb niedriger)
      let kbitSprache = null;
      if (TL) {
        const sp = TL.szenen.flatMap(S => S.saetze.map(x => [S.start + x.beginn, S.start + x.ende]));
        const pk = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time,size', '-of', 'csv=p=0', MP4], { maxBuffer: 1 << 26 }).toString().split('\n').map(l => l.split(',').filter(Boolean).map(Number)).filter(f => f.length === 2);
        let bytes = 0; for (const [t, sz] of pk) if (sp.some(([x, y]) => t >= x && t < y)) bytes += sz;
        kbitSprache = Math.round(bytes * 8 / sp.reduce((q, [x, y]) => q + y - x, 0) / 1000);
      }
      const okA = a.codec_name === 'aac' && +a.sample_rate === 48000 && +a.channels === 2 && (kbitSprache ?? kbit) >= 180 && (kbitSprache ?? kbit) <= 200;
      (okA ? OK : FEHLER)(B, `MP4 Ton: ${a.codec_name}, ${a.sample_rate} Hz, ${a.channels} Kanäle, ${kbitSprache !== null ? `${kbitSprache} kbit/s während der Sprache (Soll 192), ${kbit} kbit/s im Mittel über das ganze Video` : `${kbit} kbit/s (Soll 192)`}`);
      (Math.abs(ad - vd) <= 0.05 ? OK : FEHLER)(B, `Länge Ton ${ad.toFixed(3)} s, Länge Bild ${vd.toFixed(3)} s (Abweichung ${(ad - vd).toFixed(3)} s)`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', MP4, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
      const z = (r.stderr || '').slice((r.stderr || '').lastIndexOf('Summary:'));
      const lufs = +(z.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1], tp = +(z.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1];
      (Math.abs(lufs + 16) <= 0.5 && tp <= -1.0 ? OK : FEHLER)(B, `Lautheit ${lufs} LUFS integriert (Soll −16), True Peak ${tp} dBTP (Soll ≤ −1)`);
    }
  } else INFO(B, 'MP4 noch nicht exportiert');
}

// ================================================================ J  Ton (Sprachausgabe)
{
  const B = 'Ton';
  if (!TL) INFO(B, 'Noch keine Sprachaufnahmen (audio/timeline.json fehlt)');
  else {
    // Aufnahmen aktuell: gesendeter Text und Kontext = heutiger Stand, Stimme und Einstellungen wie vorgegeben
    const st = fragenStimmen();
    const alle = teile(DB);
    let aktuell = 0, fehlt = [];
    for (const t of alle) {
      const jf = path.join(ROOT, 'audio', t.id + '.json');
      if (!fs.existsSync(jf) || !fs.existsSync(path.join(ROOT, 'audio', t.id + '.mp3'))) { fehlt.push(t.id); continue; }
      const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
      const stimmeSoll = t.rolle === 'Erzähler' ? ERZAEHLER.id : st && st[t.rolle] && st[t.rolle].id;
      const probs = [];
      if (j.text !== t.text) probs.push('Text veraltet');
      if (JSON.stringify(j.kontext || null) !== JSON.stringify(t.kontext || null)) INFO(B, `${t.id}: aufgenommen mit dem damaligen Text davor/danach; Aufnahme bleibt (nur der Kontext hat sich geändert)`);
      if (j.stimme.id !== stimmeSoll) probs.push('andere Stimme');
      if (j.modell !== MODELL || JSON.stringify(j.einstellungen) !== JSON.stringify(EINSTELLUNGEN)) probs.push('Modell/Einstellungen abweichend');
      if (probs.length) FEHLER(B, `${t.id}: ${probs.join(', ')}`); else aktuell++;
    }
    const szFehlt = fehlt.map(id => +id.slice(6, 8));
    if (fehlt.length) (szFehlt.some(n => inScope(n)) && !SCOPE ? FEHLER : INFO)(B, `Noch keine Aufnahme für: ${fehlt.join(', ')}${st ? '' : ' (Stimmen der Pressefragen noch nicht freigegeben)'}`);
    const mitKontext = alle.filter(t => t.kontext).length;
    OK(B, `${aktuell} Aufnahmen aktuell: Text wie Sprachtext, Stimme ${ERZAEHLER.name} (${MODELL}; stability ${EINSTELLUNGEN.stability}, similarity_boost ${EINSTELLUNGEN.similarity_boost}, style ${EINSTELLUNGEN.style}, speaker boost an, Geschwindigkeit ${EINSTELLUNGEN.speed})${st ? `; Pressefragen: ${st.A.name} / ${st.B.name}` : ''}; ${mitKontext} Erzählerteile mit dem gesprochenen Text davor/danach als Kontext`);
    // Sprechfluss: jeder Erzählerteil läuft als durchgehende Aufnahme (ein Segment, keine eingefügten Pausen)
    const zerteilt = [];
    for (const S of TL.szenen) for (const tp of S.teile || []) if (tp.art !== 'fragen' && S.segmente.filter(g => g.id === tp.id).length !== 1) zerteilt.push(tp.id);
    (zerteilt.length ? FEHLER : OK)(B, zerteilt.length ? `Erzählerteile zerschnitten: ${zerteilt.join(', ')}` : 'Sprechfluss: jeder Erzählerteil läuft als durchgehende Aufnahme mit seinen natürlichen Pausen (keine eingefügten Pausen, nichts zerschnitten)');
    // Pausen: Sprechbeginn nach Szenenbeginn, Nachlauf bis Szenenende, Pausen zwischen den Szenen
    let pOK = true;
    const pausen = [];
    let letztes = null;
    for (const S of TL.szenen) {
      if (!S.saetze.length) continue;
      const haupt = S.saetze.filter(x => x.art !== 'schluss');
      const erst = Math.min(...haupt.map(x => x.beginn)), letzt = Math.max(...haupt.map(x => x.ende)), L = S.ende - S.start;
      if (letztes !== null) pausen.push({ n: S.n, p: S.start + erst - letztes });
      letztes = S.start + Math.max(...S.saetze.map(x => x.ende));
      if (!inScope(S.n)) continue;
      const minVor = S.n === 0 ? 1.0 : KONFIG.vorlaufMin;
      if (erst < minVor - 0.01) { pOK = false; FEHLER(B, `Szene ${S.n}: Sprechbeginn ${erst.toFixed(2)} s nach Szenenbeginn (Soll ≥ ${minVor} s)`); }
      const bisEnde = (S.schlusstafel ?? L) - letzt;
      if (bisEnde < KONFIG.nachlauf - 0.01) { pOK = false; FEHLER(B, `Szene ${S.n}: nach dem letzten Wort nur ${bisEnde.toFixed(2)} s bis ${S.schlusstafel ? 'zur Schlusstafel' : 'Szenenende'} (Soll ≥ ${KONFIG.nachlauf} s)`); }
      const schluss = S.saetze.filter(x => x.art === 'schluss');
      if (schluss.length) {
        const sa = Math.min(...schluss.map(x => x.beginn)), se = Math.max(...schluss.map(x => x.ende));
        if (Math.abs(sa - (S.schlusstafel + KONFIG.schlussVorlauf)) > 0.02 || L - se < 1.5) { pOK = false; FEHLER(B, `Szene ${S.n}: Schlusssatz ${sa.toFixed(2)}–${se.toFixed(2)} s liegt nicht auf der Schlusstafel (${S.schlusstafel} s bis ${L.toFixed(2)} s)`); }
        else OK(B, `Schlusssatz auf der Schlusstafel: beginnt ${KONFIG.schlussVorlauf} s nach dem Einblenden, endet ${(L - se).toFixed(1)} s vor dem Videoende`);
      }
      // Pausen innerhalb der Szene (zwischen Sprechteilen, z. B. nach den Pressefragen)
      const reihe = [...S.saetze].sort((a, b) => a.beginn - b.beginn);
      for (let i = 1; i < reihe.length; i++) {
        const g = reihe[i].beginn - reihe[i - 1].ende;
        if (reihe[i].art === 'schluss') continue;
        if (g > 2.0) { pOK = false; FEHLER(B, `Szene ${S.n}: ${g.toFixed(2)} s Pause vor „${reihe[i].text.slice(0, 30)}…“ (Soll ≤ 2 s innerhalb einer Szene)`); }
      }
    }
    for (const x of pausen) if (x.p > 8) { pOK = false; FEHLER(B, `Pause vor Szene ${x.n}: ${x.p.toFixed(2)} s ohne Sprache (Soll ≤ 8 s)`); } else if (x.p > 5) WARN(B, `Pause vor Szene ${x.n}: ${x.p.toFixed(2)} s ohne Sprache`);
    if (EINSTELLUNGEN.speed !== 1.0) { pOK = false; FEHLER(B, 'Stimme beschleunigt (speed ≠ 1,0)'); }
    if (pOK) OK(B, `Pausen: Sprechbeginn ≥ ${KONFIG.vorlaufMin} s nach Szenenbeginn (Titel ≥ 1 s), ≥ ${KONFIG.nachlauf} s nach dem letzten Wort; zwischen den Szenen ${Math.min(...pausen.map(x => x.p)).toFixed(1)}–${Math.max(...pausen.map(x => x.p)).toFixed(1)} s (${pausen.map(x => `vor ${x.n}: ${x.p.toFixed(1)}`).join(', ')}); Stimme nicht beschleunigt`);
  }
}

// ================================================================ L  Musik
{
  const B = 'Musik';
  const mj = path.join(ROOT, 'output', '.ton', 'Musik.json'), stempel = path.join(ROOT, 'output', '.ton', 'Musik.stempel');
  if (!TL) INFO(B, 'Noch keine Zeitachse – Musik nicht geprüft');
  else if (!fs.existsSync(mj)) INFO(B, 'Musik noch nicht erzeugt (entsteht beim Export über export/audio.mjs)');
  else {
    const m = JSON.parse(fs.readFileSync(mj, 'utf8'));
    const crypto = await import('crypto');
    const soll = crypto.createHash('sha1').update(fs.readFileSync(TLFILE)).update(fs.readFileSync(path.join(ROOT, 'export', 'musik.py'))).digest('hex');
    const aktuell = fs.existsSync(stempel) && fs.readFileSync(stempel, 'utf8') === soll;
    (aktuell ? OK : FEHLER)(B, aktuell ? 'Musik passt zur aktuellen Zeitachse und Komposition (export/musik.py, eigene Komposition, synthetisch erzeugt – keine Rechte Dritter)' : 'Musik ist veraltet (Zeitachse oder Komposition geändert) – Export neu starten');
    // Abschnitte: je Szene einer, dazu die Schlusstafel; jeder beginnt auf einer Szenengrenze
    const grenzen = new Set(V.SCENES.map(sc => sc.start.toFixed(2)));
    grenzen.add((V.TOTAL - V.SCHLUSS_DAUER).toFixed(2));
    const falsch = m.abschnitte.filter(a => ![...grenzen].some(g => Math.abs(+g - a.von) < 0.02));
    (m.abschnitte.length === V.SCENES.length + 1 && !falsch.length ? OK : FEHLER)(B, `${m.abschnitte.length} Abschnitte, jeder beginnt auf einem Szenenwechsel bzw. mit der Schlusstafel: ${m.abschnitte.map(a => `${a.name} (${a.name === 'Schlusstafel' ? 'Schlussakkord' : Math.round(a.bpm) + ' BPM'})`).join(' · ')}`);
    // Pegel: in Pausen hörbar, unter der Stimme deutlich zurück
    const abstand = -16 - m.sprache_lufs;
    (m.pause_lufs >= -28 && m.pause_lufs <= -22 ? OK : FEHLER)(B, `Musik in Sprechpausen ${m.pause_lufs} LUFS (Soll −28 … −22)`);
    (abstand >= 17 ? OK : FEHLER)(B, `Musik unter der Stimme ${m.sprache_lufs} LUFS, ${abstand.toFixed(1)} LU unter der Sprache (−16 LUFS; Soll ≥ 17 LU), Absenkung ${m.absenkung_db} dB`);
    // Endprodukt: keine Tonlöcher (Musik trägt durch alle Pausen), Musik in den Szenenpausen tatsächlich zu hören
    if (fs.existsSync(MP4)) {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', MP4, '-map', '0:a', '-af', 'silencedetect=noise=-60dB:d=0.4', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
      const loecher = [...(r.stderr || '').matchAll(/silence_start: ([\d.]+)/g)].map(x => +x[1]).filter(t => t > 0.3 && t < V.TOTAL - 1.0);
      (loecher.length ? FEHLER : OK)(B, loecher.length ? `Tonlöcher (Stille > 0,4 s) bei ${loecher.map(fmt).join(', ')}` : 'Endprodukt ohne Tonlöcher: Musik trägt durch alle Pausen (keine Stille > 0,4 s unter −60 dBFS außer am Anfang und beim Ausblenden)');
      const e = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'verbose', '-i', MP4, '-map', '0:a', '-af', 'ebur128=framelog=verbose', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });   // Einzelwerte nur mit -v verbose
      const Mw = [...(e.stderr || '').matchAll(/t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.inf]+)/g)].map(x => [+x[1], +x[2]]);
      const mitten = [];
      let le = null;
      for (const S of TL.szenen) {
        if (!S.saetze.length) continue;
        const erst = S.start + Math.min(...S.saetze.map(x => x.beginn));
        if (le !== null && erst - le >= 1.8) mitten.push((le + erst) / 2);
        le = S.start + Math.max(...S.saetze.map(x => x.ende));
      }
      const werte = mitten.map(t => { const k = Mw.reduce((b, x) => Math.abs(x[0] - t - 0.2) < Math.abs(b[0] - t - 0.2) ? x : b, Mw[0]); return k ? k[1] : -Infinity; });
      const leise = werte.filter(v => v < -36), laut = werte.filter(v => v > -18);
      (mitten.length && !leise.length && !laut.length ? OK : FEHLER)(B, `Musik in ${mitten.length} Szenenpausen hörbar: momentan ${Math.min(...werte).toFixed(1)} bis ${Math.max(...werte).toFixed(1)} LUFS (Soll −36 … −18)`);
    }
  }
}

// ================================================================ K  Marke (SITS-Logo)
{
  const B = 'Marke';
  const bilder = await page.evaluate(() => [...document.querySelectorAll('image')].map(e => ({ href: (e.getAttribute('href') || '').slice(0, 22), w: +e.getAttribute('width'), h: +e.getAttribute('height') })));
  const extern = [...fs.readFileSync(HTML, 'utf8').matchAll(/(?:src|href)=["'](?!data:|#|https?:\/\/www\.w3\.org)([^"']+\.(?:png|jpe?g|gif|webp|svg))/gi)].map(m => m[1]);
  const logoOK = bilder.every(b => b.href.startsWith('data:image/png;base64') && b.w === V.LOGO.w && b.h === V.LOGO.h);
  (logoOK && !extern.length ? OK : FEHLER)(B, `Logo als Data-URI eingebettet, einzige Bilddatei, Originalgröße ${V.LOGO.w} × ${V.LOGO.h} px (nicht hochskaliert)${extern.length ? '; externe Bilder: ' + extern.join(', ') : ''}`);
  // sichtbar in allen Szenen außer der Schlusstafel; auf der Schlusstafel mittig unter dem Stadt-Herne-Text
  const fehlt = [], mehrzeilig = [];
  for (const sc of V.SCENES) {
    if (!inScope(sc.n)) continue;
    const t = Math.round((sc.start + Math.min(3, (sc.end - sc.start) / 2)) * V.FPS) / V.FPS;
    await renderAt(page, t);
    const r = await page.evaluate(() => {
      const i = document.querySelector('#stage svg.brand image'); if (!i) return null;
      const b = i.getBoundingClientRect(); let op = 1, n = i; while (n && n.id !== 'stage') { op *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; }
      // Zeile unter dem Logo: Anzahl der Textzeilen und ihre Ausdehnung (muss ganz im Bild liegen)
      const z = [...document.querySelectorAll('#stage svg.brand text[data-k="marke_zeile"]')];
      const zb = z.map(t => t.getBoundingClientRect());
      return { op, w: b.width, h: b.height, x: b.x, y: b.y, zeilen: z.map(t => t.textContent), links: Math.min(...zb.map(q => q.x)), rechts: Math.max(...zb.map(q => q.x + q.width)) };
    });
    if (!r || r.op < 0.9 || Math.abs(r.w - V.LOGO.w) > 0.5 || r.x + r.w < 1700 || r.y > 60) fehlt.push(sc.n);
    else if (r.zeilen.length !== 1 || r.zeilen[0] !== V.TEXTE.marke_zeile || r.links < 0 || r.rechts > V.W) mehrzeilig.push(`${sc.n} (${r.zeilen.length} Zeilen: „${r.zeilen.join(' / ')}“)`);
  }
  if (fehlt.length) FEHLER(B, `Logo oben rechts fehlt oder ist verändert in Szene ${fehlt.join(', ')}`);
  else OK(B, `Logo oben rechts in Originalgröße mit der Zeile „${V.TEXTE.marke_zeile}“ sichtbar${SCOPE ? ' (geprüfte Szenen)' : ' in allen Szenen'}`);
  if (mehrzeilig.length) FEHLER(B, `Zeile unter dem Logo oben rechts nicht einzeilig oder nicht wortgleich in Szene ${mehrzeilig.join('; ')}`);
  else if (!fehlt.length) OK(B, `Zeile unter dem Logo oben rechts einzeilig, wortgleich und ganz im Bild${SCOPE ? ' (geprüfte Szenen)' : ' in allen Szenen'}`);
  if (inScope(V.SCENES[V.SCENES.length - 1].n)) {
    await renderAt(page, V.TOTAL - 1);
    const e = await page.evaluate(() => {
      const oben = document.querySelector('#stage svg.brand image');
      const imgs = [...document.querySelectorAll('#stage image')].filter(i => !i.closest('svg.brand')).map(i => { const b = i.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y, w: b.width }; });
      const klein = [...document.querySelectorAll('#stage text[data-k="schluss_klein"]')].map(t => t.getBoundingClientRect())[0];
      const zeile = [...document.querySelectorAll('#stage text[data-k="marke_zeile"]')].filter(t => !t.closest('svg.brand')).map(t => t.textContent);
      return { oben: !!oben, imgs, kleinUnten: klein ? klein.y + klein.height : null, zeile };
    });
    const mittig = e.imgs.length === 1 && Math.abs(e.imgs[0].x - 960) < 1.5 && e.kleinUnten !== null && e.imgs[0].y > e.kleinUnten && Math.abs(e.imgs[0].w - V.LOGO.w) < 0.5;
    (mittig && !e.oben && e.zeile.join(' ') === V.TEXTE.marke_zeile ? OK : FEHLER)(B, `Schlusstafel: Logo oben rechts ${e.oben ? 'noch sichtbar' : 'ausgeblendet'}; Logo ${mittig ? 'mittig unter dem Stadt-Herne-Text' : 'nicht mittig unter dem Stadt-Herne-Text'} mit der Zeile „${e.zeile.join(' ')}“`);
  }
}

// ================================================================ I  Skriptfehler, Standbilder
{
  const B = 'Technik';
  if (errors.length) errors.forEach(e => FEHLER(B, `Fehler in der Seite: ${e}`)); else OK(B, 'keine Skriptfehler beim Rendern');
}
let stillList = [];
if (opt('stills', false)) {
  const dir = path.join(OUTDIR, 'standbilder');
  fs.mkdirSync(dir, { recursive: true });
  for (const sc of V.SCENES) {
    if (!inScope(sc.n)) continue;
    for (const f of [0.25, 0.5, 0.75]) {
      const t = Math.round((sc.start + (sc.end - sc.start) * f) * V.FPS) / V.FPS;
      await renderAt(page, t);
      const file = path.join(dir, `Szene${sc.n}_${Math.round(f * 100)}pct.png`);
      await page.screenshot({ path: file });
      stillList.push({ n: sc.n, f, t, file });
    }
  }
  // Kontaktbogen als HTML-Raster, per Screenshot zusammengesetzt
  const cols = 3, tw = 640, th = 360, rows = Math.ceil(stillList.length / cols);
  const grid = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1F292D;font:16px Arial,sans-serif;color:#fff"><div style="display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:0">`
    + stillList.map(s => `<div style="position:relative;width:${tw}px;height:${th}px"><img src="${pathToFileURL(s.file).href}" style="width:${tw}px;height:${th}px;display:block"><span style="position:absolute;left:0;top:0;background:rgba(0,0,0,.7);padding:3px 8px">Szene ${s.n} · ${Math.round(s.f * 100)} % · ${fmt(s.t)}</span></div>`).join('') + '</div></body>';
  const gridFile = path.join(dir, '_kontaktbogen.html');
  fs.writeFileSync(gridFile, grid);
  const gp = await browser.newPage({ viewport: { width: cols * tw, height: rows * th } });
  await gp.goto(pathToFileURL(gridFile).href);
  await gp.waitForLoadState('load');
  await gp.screenshot({ path: path.join(OUTDIR, `Kontaktbogen${SCOPE ? '_Szenen' + SCOPE.join('') : ''}.png`) });
  fs.rmSync(gridFile);
  INFO('Standbilder', `${stillList.length} Standbilder (25/50/75 %) in ${path.relative(ROOT, dir)}, Kontaktbogen in ${path.relative(ROOT, OUTDIR)}`);
}
await browser.close();

// ---------------------------------------------------------------- Bericht
const counts = s => R.filter(r => r.status === s).length;
const bereiche = [...new Set(R.map(r => r.bereich))];
const icon = { OK: '✅', FEHLER: '❌', WARNUNG: '⚠️', INFO: 'ℹ️' };
let rep = `# Prüfbericht „Ein ganz normaler Montag“\n\n`;
rep += `Drehbuch: ${path.basename(DREHBUCH)} · Video: ${path.basename(HTML)} · Umfang: ${SCOPE ? 'Szenen ' + SCOPE.join(', ') : 'alle Szenen'}\n\n`;
rep += `**Ergebnis:** ${counts('FEHLER')} Fehler · ${counts('WARNUNG')} Warnungen · ${counts('OK')} bestandene Prüfungen · ${counts('INFO')} Hinweise\n\n`;
for (const b of bereiche) {
  rep += `## ${b}\n\n`;
  for (const r of R.filter(r => r.bereich === b)) rep += `- ${icon[r.status]} ${r.text}\n`;
  rep += '\n';
}
if (cueMetrics.length) {
  rep += `## Untertitel im Einzelnen\n\n| Nr. | Szene | von | bis | Dauer | Zeichen | Zeichen/s | Text |\n|---|---|---|---|---|---|---|---|\n`;
  for (const c of cueMetrics) rep += `| ${c.i + 1} | ${c.n} | ${fmt(c.start)} | ${fmt(c.end)} | ${c.dur.toFixed(1)} s | ${c.chars} | ${c.cps.toFixed(1)} | ${c.lines.join(' / ')} |\n`;
  rep += '\n';
}
if (visibleTexts.size) {
  rep += `## Sichtbare Texte (Abtastung)\n\n| Schlüssel | Text | sichtbar |\n|---|---|---|\n`;
  // Sichtbarkeit als Intervalle (Lücke > 2 Abtastschritte = neues Intervall)
  const intervals = times => { const out = []; for (const t of times) { const last = out[out.length - 1]; if (last && t - last[1] <= STEP * 2 + 1e-6) last[1] = t; else out.push([t, t]); } return out.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', '); };
  for (const [k, r] of [...visibleTexts.entries()].sort((a, b) => a[1].von - b[1].von)) rep += `| ${k} | ${r.text} | ${r.statisch && r.times.length <= 1 ? 'Bildbestandteil (Szene 0, 1, 8)' : intervals([...new Set(r.times)].sort((a, b) => a - b).filter(t => !(r.statisch && t === 0)))} |\n`;
  rep += '\n';
}
const repFile = path.join(OUTDIR, `Pruefbericht${SCOPE ? '_Szenen' + SCOPE.join('') : ''}.md`);
fs.writeFileSync(repFile, rep);
for (const r of R) console.log(`${icon[r.status]} [${r.bereich}] ${r.text}`);
console.log(`\nErgebnis: ${counts('FEHLER')} Fehler, ${counts('WARNUNG')} Warnungen, ${counts('OK')} OK, ${counts('INFO')} Hinweise → ${path.relative(ROOT, repFile)}`);
process.exitCode = counts('FEHLER') ? 1 : 0;
