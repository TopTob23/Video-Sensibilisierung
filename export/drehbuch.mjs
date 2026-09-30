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
