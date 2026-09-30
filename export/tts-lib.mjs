// Gemeinsame Angaben zur Sprachausgabe: Stimmen, Einstellungen, Sprechteile (ohne Nebenwirkungen, wird auch von sync.mjs benutzt).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ROOT } from './lib.mjs';
import { sprachtexte } from './tts-text.mjs';

export const ERZAEHLER = { id: 'kkJxCnlRCckmfFvzDW5Q', name: 'Alexander – Deep TV Narrator' };
export const MODELL = 'eleven_multilingual_v2';
export const EINSTELLUNGEN = { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 };
export const DIR = path.join(ROOT, 'audio');   // je Sprechteil audio/<id>.mp3 und audio/<id>.json (Zeitmarken)

// Stimmen der Pressefragen (nach Freigabe): { "A": { id, name }, "B": { id, name } }
export function fragenStimmen() {
  const f = path.join(ROOT, 'audio', 'stimmen.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

const pad = n => String(n).padStart(2, '0');

// Kontext für den Sprechfluss: Der Erzähler bekommt den Text davor und danach mit (previous_text / next_text),
// damit Satzanfänge und -enden wie in einer durchgehenden Aufnahme betont werden. Gesprochen wird nur der eigene Text.
const KONTEXT_MAX = 600;
function kuerzen(text, vonHinten) {
  if (text.length <= KONTEXT_MAX) return text;
  const saetze = text.match(/[^.!?]+[.!?]+["“”]?\s*/g) || [text];
  const out = [];
  let n = 0;
  for (const s of vonHinten ? saetze.reverse() : saetze) { if (n + s.length > KONTEXT_MAX && out.length) break; out.push(s.trim()); n += s.length; }
  return (vonHinten ? out.reverse() : out).join(' ');
}

// Alle Sprechteile in Reihenfolge des Videos: ein Teil = ein API-Aufruf = eine Rohdatei
export function teile(db) {
  const liste = [];
  const st = fragenStimmen();
  for (const e of sprachtexte(db)) {
    e.teile.forEach((t, i) => {
      const id = e.art === 'fragen' ? `szene_${pad(e.szene)}_frage_${i + 1}` : e.art === 'schluss' ? `szene_${pad(e.szene)}_schluss` : `szene_${pad(e.szene)}`;
      const stimme = t.stimme === 'Erzähler' ? ERZAEHLER : st && st[t.stimme];
      liste.push({ id, szene: e.szene, art: e.art, index: i, stimme, rolle: t.stimme, text: t.text, tokens: t.tokens, quelle: t.quelle });
    });
  }
  // Kontext: gesprochener Text unmittelbar davor und danach (Pressefragen zusammengefasst); die Pressefragen selbst ohne Kontext
  const bloecke = [];
  for (const t of liste) {
    const letzter = bloecke[bloecke.length - 1];
    if (t.art === 'fragen' && letzter && letzter.fragen && letzter.szene === t.szene) letzter.text += ' ' + t.text;
    else bloecke.push({ szene: t.szene, fragen: t.art === 'fragen', text: t.text, teil: t });
  }
  bloecke.forEach((b, i) => {
    if (b.fragen) return;
    const vorher = bloecke[i - 1] && kuerzen(bloecke[i - 1].text, true);
    const nachher = bloecke[i + 1] && kuerzen(bloecke[i + 1].text, false);
    if (vorher || nachher) b.teil.kontext = { ...(vorher ? { vorher } : {}), ...(nachher ? { nachher } : {}) };
  });
  return liste;
}

export const seedFor = t => 4000 + t.szene * 10 + t.index + (t.art === 'schluss' ? 5 : 0);
export const schluessel = t => crypto.createHash('sha1').update(JSON.stringify({ text: t.text, voice: t.stimme.id, model: MODELL, s: EINSTELLUNGEN, seed: seedFor(t), kontext: t.kontext })).digest('hex');
