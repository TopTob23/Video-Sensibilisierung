// Anonyme Fassung: erzeugt aus dem aktuellen Stand den Ordner anonym/ (Drehbuch, Videodatei, Sprachaufnahmen) ohne Ortsnamen.
//  · „Herne“ in Bild und Untertiteln → neutrale Angaben („in der Stadt“, „eine Stadtverwaltung“, „Rathaus“, „Stadtverwaltung“);
//    die Stimme sagt schon im Original „die Stadt“, die Aufnahmen bleiben daher dieselben
//  · ohne den Einschub zur Schulung in Szene 9 (Aufnahme ohne Einschub aus audio/varianten/, wie in Fassung 5)
//  · Projektzahlen, Belege und alle übrigen Texte bleiben unverändert (Vorgabe des Auftraggebers)
// Jede Ersetzung muss genau einmal passen, sonst bricht das Skript ab – Änderungen am Original fallen so sofort auf.
//
// Aufruf:  node export/anonym.mjs                         → anonym/ neu erzeugen
//          VIDEO_ROOT=anonym node export/tts-text.mjs     → Sprachtexte (muss dieselben Texte ergeben wie die Aufnahmen)
//          VIDEO_ROOT=anonym node export/sync.mjs         → Zeitachse und Untertitel
//          VIDEO_ROOT=anonym node export/render.mjs       → anonym/output/…mp4 und …srt
//          VIDEO_ROOT=anonym node export/check.mjs        → Prüfung, zusätzlich „kein Ortsname“ in Bild, Untertiteln und Stimme
import fs from 'fs';
import path from 'path';
import { EXPORT_DIR } from './lib.mjs';
import { findDrehbuch } from './drehbuch.mjs';

const QUELLE = path.resolve(EXPORT_DIR, '..');
const ZIEL = path.join(QUELLE, 'anonym');
const HTML_NAME = 'Ein_ganz_normaler_Montag_V1_0.html';

// Ortsname in Texten, die im Bild oder in den Untertiteln erscheinen (Drehbuch und Videodatei)
const ORT = [
  ['In Herne lässt sich', 'In der Stadt lässt sich'],
  ['Für die Menschen in Herne hieße das', 'Für die Menschen in der Stadt hieße das'],
  ['Was ein Cyberangriff für Herne bedeuten würde', 'Was ein Cyberangriff für eine Stadtverwaltung bedeuten würde'],
  ['Gemeinsam für ein sicheres Herne', 'Gemeinsam für eine sichere Stadt'],
  ['Stadt Herne · Informationssicherheit · Stand September 2026', 'Stadtverwaltung · Informationssicherheit · Stand September 2026'],
];
// Szene 9 ohne Einschub (Sprechertext wie in Drehbuch V1_7)
const OHNE_EINSCHUB = [
  ['sich regelmäßig schulen lassen. Dafür wird im heutigen Termin ja bereits der erste Stein gesetzt. Freuen Sie sich auf eine spannende Schulung durch die werten Kollegen von neam. Weiter zum nächsten Punkt: die Risiken kennen und verantworten',
   'sich regelmäßig schulen lassen und die Risiken kennen und verantworten'],
];
const NUR_DREHBUCH = [
  ['Erklärvideo für die Verwaltungsführung der Stadt Herne ·', 'Erklärvideo für die Verwaltungsführung einer Stadt (anonymisierte Fassung) ·'],
  ['unter dem Stadt-Herne-Text', 'unter dem Text'],
];
const NUR_HTML = [
  ['für die Verwaltungsführung der Stadt Herne', 'für die Verwaltungsführung einer Stadt (anonymisierte Fassung, erzeugt von export/anonym.mjs)'],
  ['unter dem Stadt-Herne-Text', 'unter dem Text'],
  ['[1.6, "In Herne lässt"]', '[1.6, "In der Stadt lässt"]'],
  ["  fassade: 'GEMEINSAM FÜR EIN LEBENSWERTES HERNE',   // Spruch an der Fassade wie in der Stilreferenz (Auftrag, Regel 3)",
   "  fassade: 'RATHAUS',                               // anonyme Fassung: neutrale Beschriftung statt Spruch mit Ortsnamen"],
  ["  stele: 'Stadt Herne',                             // Text „Stadt Herne“ (Auftrag, Regel 3)",
   "  stele: 'Rathaus',                                 // anonyme Fassung: neutrale Beschriftung statt Ortsnamen"],
  ["const FASSADE_ZEILEN = ['GEMEINSAM', 'FÜR EIN LEBENSWERTES', 'HERNE'];", "const FASSADE_ZEILEN = ['RATHAUS'];"],
  ["const STELE_ZEILEN = ['Stadt', 'Herne'];", "const STELE_ZEILEN = ['Rathaus'];"],
  // Szene 9 ohne Einschub: Bild-Ton-Anker, Symbolzeiten und Bildende wie in Fassung 5
  ['[46.2, "schulen lassen. Dafür"], [58.6, "Risiken kennen und"], [61.5, "Unterschrift unter die"]]',
   '[46.2, "schulen lassen und"], [47.6, "Risiken kennen und"], [50.5, "Unterschrift unter die"]]'],
  ["{ key: 'symbol_verantworten', t: 58.6, anim: 61.5 }],", "{ key: 'symbol_verantworten', t: 47.6, anim: 50.5 }],"],
  ['  einschub: [47.4, 56.7],', '  einschub: null,         '],
  ['9: [63.0, 0.6], 10:', '9: [52.0, 0.6], 10:'],
];

function ersetzen(text, liste, wo) {
  for (const [alt, neu] of liste) {
    const n = text.split(alt).length - 1;
    if (n < 1) throw new Error(`${wo}: „${alt.slice(0, 60)}…“ nicht gefunden – Original geändert? Ersetzungsliste in export/anonym.mjs anpassen`);
    text = text.split(alt).join(neu);
  }
  return text;
}
const ortsname = /hern(e|er|es)\b/i;

// ---------------------------------------------------------------- Drehbuch
const dQuelle = findDrehbuch(QUELLE);
const version = path.basename(dQuelle).match(/_(V\d+_\d+)\.md$/)[1];
let md = fs.readFileSync(dQuelle, 'utf8');
md = ersetzen(md, [...ORT, ...OHNE_EINSCHUB, ...NUR_DREHBUCH], 'Drehbuch');
// Änderungsnotiz zum Einschub entfällt; stattdessen ein Vermerk zur anonymen Fassung
const notiz = /## Änderungen gegenüber V1_7\n[\s\S]*?(?=\n## )/;
if (!notiz.test(md)) throw new Error('Drehbuch: Änderungsnotiz „gegenüber V1_7“ nicht gefunden');
md = md.replace(notiz, `## Anonymisierte Fassung

- Abgeleitet aus Drehbuch ${version} (erzeugt von export/anonym.mjs). Der Ortsname erscheint weder im Bild noch in den Untertiteln noch in der Stimme: „in der Stadt“ statt des Ortsnamens im Sprechertext, Titelkarte „Was ein Cyberangriff für eine Stadtverwaltung bedeuten würde“, Schlusstafel „Gemeinsam für eine sichere Stadt“ und „Stadtverwaltung · Informationssicherheit · Stand September 2026“, an Fassade und Stele „Rathaus“.
- Szene 9 ohne den Einschub zur Schulung (Sprechertext wie in V1_7). Projektzahlen und Belege bleiben unverändert.
`);
if (ortsname.test(md)) throw new Error('Drehbuch: Ortsname noch enthalten: ' + md.match(new RegExp('.{0,40}' + ortsname.source + '.{0,40}', 'i'))[0]);

// ---------------------------------------------------------------- Videodatei
let html = fs.readFileSync(path.join(QUELLE, HTML_NAME), 'utf8');
html = ersetzen(html, [...ORT, ...OHNE_EINSCHUB, ...NUR_HTML], 'Videodatei');
// Zeitachse und Untertitel erzeugt export/sync.mjs neu aus den Aufnahmen
html = html.replace(/\/\* TIMELINE-BEGIN[\s\S]*?\/\* TIMELINE-END \*\//, '/* TIMELINE-BEGIN (erzeugt von export/sync.mjs aus den Audiodateien – nicht von Hand ändern) */\nconst TIMELINE = null;\n/* TIMELINE-END */');
if (ortsname.test(html)) throw new Error('Videodatei: Ortsname noch enthalten: ' + html.match(new RegExp('.{0,60}' + ortsname.source + '.{0,40}', 'i'))[0]);

// ---------------------------------------------------------------- schreiben
fs.mkdirSync(ZIEL, { recursive: true });
for (const f of fs.readdirSync(ZIEL)) if (/^Drehbuch_.*\.md$/.test(f)) fs.unlinkSync(path.join(ZIEL, f));
fs.writeFileSync(path.join(ZIEL, `Drehbuch_Video_Angriffsszenario_Anonym_${version}.md`), md);
fs.writeFileSync(path.join(ZIEL, HTML_NAME), html);
fs.copyFileSync(path.join(QUELLE, 'SITS_Logo.png'), path.join(ZIEL, 'SITS_Logo.png'));
// Sprachaufnahmen: dieselben wie im Original, Szene 9 ohne Einschub; Zeitachse und Sprachtexte werden neu erzeugt
const aZiel = path.join(ZIEL, 'audio');
fs.rmSync(aZiel, { recursive: true, force: true });
fs.mkdirSync(aZiel, { recursive: true });
for (const f of fs.readdirSync(path.join(QUELLE, 'audio'))) if (/^(szene_.*\.(mp3|json)|stimmen\.json)$/.test(f)) fs.copyFileSync(path.join(QUELLE, 'audio', f), path.join(aZiel, f));
for (const e of ['mp3', 'json']) fs.copyFileSync(path.join(QUELLE, 'audio', 'varianten', `szene_09_ohne_einschub.${e}`), path.join(aZiel, `szene_09.${e}`));
// gesprochener Text aller Aufnahmen (auch der Kontext davor/danach) ohne Ortsnamen
for (const f of fs.readdirSync(aZiel).filter(f => /^szene_.*\.json$/.test(f))) {
  const j = JSON.parse(fs.readFileSync(path.join(aZiel, f), 'utf8'));
  if (ortsname.test(j.text) || ortsname.test(JSON.stringify(j.kontext || {}))) throw new Error(`${f}: Ortsname im gesprochenen Text oder Kontext`);
}
console.log(`✓ anonym/: Drehbuch_Video_Angriffsszenario_Anonym_${version}.md, ${HTML_NAME}, ${fs.readdirSync(aZiel).length} Aufnahmedateien – kein Ortsname in Drehbuch, Videodatei und Stimme`);
console.log('  weiter: VIDEO_ROOT=anonym node export/tts-text.mjs && VIDEO_ROOT=anonym node export/sync.mjs && VIDEO_ROOT=anonym node export/render.mjs');
