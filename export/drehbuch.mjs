// Liest das Drehbuch (Markdown): Szenen mit Zeiten, Sprechertext und Pressefragen.
// Wird von check.mjs und den Skripten für die Sprachausgabe gemeinsam benutzt.
import fs from 'fs';
import path from 'path';
import { ROOT } from './lib.mjs';

const version = f => { const m = f.match(/_V(\d+)_(\d+)\.md$/); return m ? +m[1] * 1000 + +m[2] : -1; };

// Neueste Drehbuch-Datei im Projektordner (Drehbuch_*_V<Haupt>_<Neben>.md)
export function findDrehbuch(dir = ROOT) {
  const files = fs.readdirSync(dir).filter(f => /^Drehbuch_.*_V\d+_\d+\.md$/.test(f)).sort((a, b) => version(a) - version(b));
  if (!files.length) throw new Error('Kein Drehbuch im Projektordner gefunden');
  return path.join(dir, files[files.length - 1]);
}

const sec = (m, s) => +m * 60 + +s;

export function parseDrehbuch(file = findDrehbuch()) {
  const md = fs.readFileSync(file, 'utf8');
  const body = md.split(/\n## Quellen/)[0];                       // der Quellenabschnitt gehört nicht zu den Szenen
  const scenes = body.split(/\n(?=### Szene )/).slice(1).map(p => {
    const h = p.match(/^### Szene (\d+) – (.+?) \((\d+):(\d\d)–(\d+):(\d\d)\)/);
    if (!h) throw new Error('Szenenüberschrift nicht lesbar: ' + p.split('\n')[0]);
    const s = { n: +h[1], title: h[2], start: sec(h[3], h[4]), end: sec(h[5], h[6]), text: p };
    const sp = p.match(/\*\*Sprechertext(?: \(ab (\d+):(\d\d)\))?:\*\*\s*„([^“]*)“/);
    s.speech = sp ? sp[3] : null;
    s.speechFrom = sp && sp[1] !== undefined ? sec(sp[1], sp[2]) : null;   // nur wenn das Drehbuch einen späteren Beginn nennt
    const pr = p.match(/\*\*Fragen der Presse \((\d+):(\d\d)–(\d+):(\d\d)[^)]*\):\*\*\n((?:[ \t]+- „[^“]*“\n?)+)/);
    s.press = pr ? [...pr[5].matchAll(/- „([^“]*)“/g)].map(x => x[1]) : [];
    s.pressWindow = pr ? [sec(pr[1], pr[2]), sec(pr[3], pr[4])] : null;
    return s;
  });
  return { file, md, scenes, total: scenes[scenes.length - 1].end };
}

// Einblendetexte der Szenen 8–12 und die Markenzeile, wörtlich aus dem Drehbuch
export function einblendungen(db) {
  const md = db.md;
  const szene = n => db.scenes.find(s => s.n === n).text;
  const zitate = t => [...t.matchAll(/„([^“]*)“/g)].map(m => m[1]);
  const feld = (t, label) => { const m = t.match(new RegExp(`\\*\\*${label}[^\\n]*?:\\*\\*\\s*([^\\n]*)`)); return m ? m[1] : null; };
  const liste = (t, label) => {                                  // Aufzählung unter „- **Spalte „X“:**“ (Unterpunkte mit „  - “)
    const i = t.indexOf(`**${label}:**`);
    if (i < 0) return null;
    const rest = t.slice(i).split('\n').slice(1);
    const out = [];
    for (const l of rest) { const m = l.match(/^\s{2,}- (.*)$/); if (!m) break; out.push(m[1].trim()); }
    return out;
  };
  const s8 = szene(8), s9 = szene(9), s10 = szene(10), s11 = szene(11), s12 = szene(12);
  const e = {};
  e.schlagzeilen = zitate(s8.split('Schlagzeilen ohne reale Medienlogos:')[1].split('\n')[0]);
  e.tafeln = zitate(s9.split('nacheinander:')[1].split('\n')[0].split('Dann drei Symbole')[0]);
  e.symbole = zitate(s9.split(/Dann \S+ Symbole/)[1].split('\n')[0])[0].split(', ');
  e.investitionen = feld(s10, 'Text-Einblendung „Investitionen“').split(' · ');
  e.personal = feld(s10, 'Text-Einblendung „Personal“').split(' · ');
  e.warnmarken = [...s11.matchAll(/^\s+(\d+)\. (.*)$/gm)].map(m => m[2].trim());
  e.spalten = {
    erreicht: { titel: 'Erreicht', punkte: liste(s12, 'Spalte „Erreicht“') },
    vorbereitet: { titel: 'Vorbereitet', punkte: liste(s12, 'Spalte „Vorbereitet“').map(p => p.split(' → ')[0]), rollen: liste(s12, 'Spalte „Vorbereitet“').map(p => p.split(' → ')[1] || null) },
    offen: { titel: 'Offen – nächste Schritte', punkte: liste(s12, 'Spalte „Offen – nächste Schritte“') },
  };
  e.offeneAnforderungen = zitate(feld(s12, 'Einblendung darunter \\(klein\\)'))[0];
  e.marke = zitate(md.split('## Branding')[1].split('\n## ')[0])[0];
  return e;
}
