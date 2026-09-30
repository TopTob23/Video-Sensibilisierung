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

// Alle Sprechteile: ein Teil = ein API-Aufruf = eine Rohdatei
export function teile(db) {
  const liste = [];
  const st = fragenStimmen();
  for (const e of sprachtexte(db)) {
    e.teile.forEach((t, i) => {
      const id = e.art === 'fragen' ? `szene_${pad(e.szene)}_frage_${i + 1}` : `szene_${pad(e.szene)}`;
      const stimme = t.stimme === 'Erzähler' ? ERZAEHLER : st && st[t.stimme];
      liste.push({ id, szene: e.szene, art: e.art, index: i, stimme, rolle: t.stimme, text: t.text, tokens: t.tokens, quelle: t.quelle });
    });
  }
  return liste;
}

export const seedFor = t => 4000 + t.szene * 10 + t.index;
export const schluessel = t => crypto.createHash('sha1').update(JSON.stringify({ text: t.text, voice: t.stimme.id, model: MODELL, s: EINSTELLUNGEN, seed: seedFor(t) })).digest('hex');
