// Zeitplan aus den Audiodateien.
//
// Aus den Rohdateien der Sprachausgabe (audio/szene_*.mp3 + *.json mit Zeichen-Zeitmarken) entstehen:
//  · die Platzierung der Sprechteile: Jeder Teil läuft als durchgehende Aufnahme mit seinen natürlichen Pausen –
//    nie beschleunigt, nie zerschnitten, keine eingefügten Pausen zwischen den Sätzen.
//  · die Szenenlängen: Die Szene endet, sobald die Stimme fertig ist (plus Nachlauf) und das Bild seinen letzten
//    Vorgang gezeigt hat (BILDENDE in der HTML-Datei: Entwurfszeit + Mindesthaltezeit). Drehbuchzeiten sind Richtwerte.
//    Nach dem letzten Bild-Ton-Anker läuft das Bild im Echtzeitmaß; reines Stehenbleiben am Szenenende entfällt.
//  · der Schlusssatz (eigener Sprechteil) beginnt kurz nach dem Einblenden der Schlusstafel
//  · die Bild-Ton-Anker (Entwurfszeit ↔ tatsächliche Zeit), mit denen die Bilder der Stimme folgen
//  · die Untertitel (Zeitmarken der Wörter, höchstens zwei Zeilen, Satzgrenzen bevorzugt)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ROOT } from './lib.mjs';
import { DIR, teile } from './tts-lib.mjs';

export const KONFIG = {
  vorlaufMin: 0.5,      // Pause am Szenenanfang (mindestens)
  vorlaufTitel: 1.5,    // Szene 0: die Musik setzt vor der Begrüßung ein
  nachlauf: 1.0,        // Pause nach dem letzten Wort einer Szene (mindestens)
  lueckeTeile: 0.45,    // Pause zwischen zwei Sprechteilen derselben Szene (außer Pressefragen)
  frageLuecke: 0.7,     // Pause zwischen den Pressefragen
  frageNachlauf: 1.0,   // Pause zwischen der letzten Pressefrage und dem Sprechertext
  schlussDauer: 6,      // Schlusstafel am Ende der letzten Szene (wie SCHLUSS_DAUER in der HTML-Datei)
  schlussVorlauf: 0.8,  // der Schlusssatz beginnt so lange nach dem Einblenden der Schlusstafel
  zeileMax: 54,         // Zeichen je Untertitelzeile
  zeileEinzeln: 52,     // Untertitel bis zu dieser Länge stehen in einer Zeile
  cueMax: 100,          // Zeichen je Untertitel (zwei Zeilen)
  cueZiel: 84,          // angestrebte Länge beim Teilen langer Sätze
  cueVorlauf: 0.10,     // Untertitel erscheint kurz vor dem ersten Wort
  cueNachhall: 0.45,    // und bleibt kurz nach dem letzten Wort stehen
  cueMinDauer: 1.0,
};

const r3 = x => Math.round(x * 1000) / 1000;
const hatBuchstaben = s => /[\p{L}\p{N}]/u.test(s);
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '');

// ---------------------------------------------------------------- Rohdaten
export function rohLaden(id) {
  const jf = path.join(DIR, id + '.json'), mf = path.join(DIR, id + '.mp3');
  if (!fs.existsSync(jf) || !fs.existsSync(mf)) return null;
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  return { ...j, datei: path.relative(ROOT, mf).split(path.sep).join('/'), pfad: mf };
}

// Stille-Abschnitte einer Datei (ffmpeg silencedetect)
export function stille(pfad, noise = '-40dB', d = 0.08) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', pfad, '-af', `silencedetect=noise=${noise}:d=${d}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const out = [];
  let von = null;
  for (const l of (r.stderr || '').split('\n')) {
    let m;
    if ((m = l.match(/silence_start: ([\d.]+)/))) von = +m[1];
    else if ((m = l.match(/silence_end: ([\d.]+)/)) && von !== null) { out.push({ von, bis: +m[1] }); von = null; }
  }
  if (von !== null) out.push({ von, bis: Infinity });
  return out;
}
export function dauerVon(pfad) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', pfad], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

// ---------------------------------------------------------------- Wörter und Sätze eines Sprechteils
function woerter(teil, roh) {
  return teil.tokens.map(t => {
    const leer = t.bis <= t.von, vor = roh.ende[Math.max(0, t.von - 1)];   // entfallenes Wort: Zeit des vorigen Zeichens
    return { w: t.wort, s: leer ? vor : roh.start[t.von], e: leer ? vor : roh.ende[t.bis - 1], sprech: hatBuchstaben(t.gesprochen) };
  });
}
function saetzeVon(w) {
  const out = [];
  let cur = [];
  for (const x of w) {
    cur.push(x);
    if (/[.?!]["“”)]*$/.test(x.w)) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- Untertitel
// Wörter, nach denen weder ein Zeilenumbruch noch ein Untertitelwechsel stehen soll
const FUNKTION = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|und|oder|aber|sowie|im|in|am|an|auf|für|mit|von|zu|zur|zum|bei|nach|aus|über|unter|vor|als|ob|dass|wie|wenn|weil|sich|nicht|noch|auch|nur|ist|sind|wird|werden|kann|ohne|durch|um|bis|seit|dann|so|es|zwischen|beide)$/i;
const funktionswort = t => FUNKTION.test(t.replace(/[^\p{L}-]/gu, ''));

// Text → höchstens zwei ausgewogene Zeilen (null: passt nicht)
function zeilen(text) {
  if (text.length <= KONFIG.zeileEinzeln) return [text];
  const w = text.split(' ');
  let best = null;
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i).join(' '), b = w.slice(i).join(' ');
    if (a.length > KONFIG.zeileMax || b.length > KONFIG.zeileMax) continue;
    let score = Math.abs(a.length - b.length);
    if (/[,;:–]$/.test(w[i - 1])) score -= 8;
    if (funktionswort(w[i - 1])) score += 12;
    if (/[,;:]$/.test(w[i]) && i < w.length - 1) score += 10;   // kein einzelnes Wort vor einem Komma am Zeilenanfang
    if (b.length > a.length) score += 3;
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best ? best.lines : null;
}

// Ein Satz (Wörter mit Zeiten) → Untertitel-Gruppen: wenige, an Satzzeichen getrennte Gruppen, nie nach Füllwörtern
function schneiden(w) {
  const text = arr => arr.map(x => x.w).join(' ');
  if (text(w).length <= KONFIG.cueMax && zeilen(text(w))) return [w];
  const n = w.length;
  const schnitt = i => {                                     // Kosten für einen Schnitt nach dem i-ten Wort (i Wörter davor)
    const t = w[i - 1].w;
    if (/[,;:]$/.test(t) || t === '–') return 0;
    return (funktionswort(t) ? 2500 : 900) + (i < n && /[,;:]$/.test(w[i].w) ? 600 : 0);
  };
  const best = Array(n + 1).fill(Infinity), von = Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 1; i <= n; i++) for (let p = 0; p < i; p++) {
    if (best[p] === Infinity) continue;
    const t = text(w.slice(p, i));
    if (t.length > KONFIG.cueMax || !zeilen(t)) continue;
    const c = best[p] + 300 + ((t.length - 66) / 8) ** 2 + (i < n ? schnitt(i) : 0);
    if (c < best[i]) { best[i] = c; von[i] = p; }
  }
  if (best[n] === Infinity) throw new Error('Satz lässt sich nicht in Untertitel teilen: ' + text(w));
  const gruppen = [];
  for (let i = n; i > 0; i = von[i]) gruppen.unshift(w.slice(von[i], i));
  return gruppen;
}

// ---------------------------------------------------------------- Planung
// Entwurfszeit d → Szenenzeit über die Anker; vor dem ersten und nach dem letzten Anker im Echtzeitmaß (wie toActual in der HTML-Datei)
export function entwurfZuIst(P, d) {
  if (!P.length) return d;
  if (d <= P[0][0]) return P[0][1] + (d - P[0][0]);
  for (let i = 1; i < P.length; i++) if (d <= P[i][0]) return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (d - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
  const L = P[P.length - 1];
  return L[1] + (d - L[0]);
}

// db: Drehbuch; anker: { n: [[Entwurfszeit, "erste Wörter"], …] }; bildende: { n: [Entwurfszeit Bild fertig, Haltezeit s] }
export function planen(db, anker = {}, bildende = {}, optionen = {}) {
  const K = { ...KONFIG, ...optionen };
  const alleTeile = teile(db);
  const ergebnis = { szenen: [], cues: [], hinweise: [] };
  const bild = x => Math.ceil(x * 30 - 1e-6) / 30;           // auf ganze Bilder (1/30 s) aufrunden
  let start = 0;
  db.scenes.forEach((dsz, szIndex) => {
    const n = dsz.n, letzteSzene = szIndex === db.scenes.length - 1;
    const nominal = dsz.end - dsz.start;
    const meine = alleTeile.filter(t => t.szene === n).map(t => ({ ...t, roh: rohLaden(t.id) })).filter(t => t.roh);
    const fehlend = alleTeile.filter(t => t.szene === n && !meine.some(m => m.id === t.id)).map(t => t.id);
    const S = { n, titel: dsz.title, nominal: [dsz.start, dsz.end], start, ende: start + nominal, entwurf: nominal, anker: [], tail: 1, teile: [], saetze: [], segmente: [], fehlend };
    if (!meine.length) { ergebnis.szenen.push(S); start = S.ende; return; }

    // Sätze aller Teile in Reihenfolge; jeder Satz kennt seinen Teil und seine Zeiten (Rohzeit der Datei)
    const saetze = [];
    for (const teil of meine) {
      const w = woerter(teil, teil.roh);
      const stille_ = stille(teil.roh.pfad);
      const dateiDauer = dauerVon(teil.roh.pfad);
      S.teile.push({ id: teil.id, datei: teil.roh.datei, stimme: teil.stimme.name, rolle: teil.rolle, art: teil.art, dauer: r3(dateiDauer) });
      const sl = saetzeVon(w);
      sl.forEach((sw, idx) => {
        const buch = sw.filter(x => x.sprech);
        saetze.push({ teil, w: sw, t0: buch[0].s, t1: buch[buch.length - 1].e, erster: idx === 0, letzter: idx === sl.length - 1, stille: stille_, dateiDauer });
      });
    }
    saetze.forEach((s, i) => { s.i = i; s.text = s.w.map(x => x.w).join(' '); s.dauer = s.t1 - s.t0; });

    // Ziele: Bild-Ton-Anker auf dem ersten Wort der Szene; späterer Sprechbeginn laut Drehbuch („ab 4:00“)
    const ank = anker[n] || [];
    const ziel = new Map();
    const alleW = [];
    saetze.forEach(s => s.w.forEach((x, k) => alleW.push({ satz: s, k, x })));
    let suchab = 0;
    const ankerTreffer = ank.map(([entwurf, phrase]) => {
      const pw = phrase.split(/\s+/).map(norm).filter(Boolean);
      for (let i = suchab; i + pw.length <= alleW.length; i++) {
        if (pw.every((p, q) => norm(alleW[i + q].x.w) === p)) { suchab = i + 1; return { entwurf, phrase, ref: alleW[i] }; }
      }
      if (fehlend.length) { ergebnis.hinweise.push(`Szene ${n}: Anker „${phrase}“ übersprungen (Aufnahme fehlt noch)`); return null; }
      throw new Error(`Szene ${n}: Anker „${phrase}“ nicht im Sprechtext gefunden`);
    }).filter(Boolean);
    for (const a of ankerTreffer) if (a.ref.k === 0 && a.ref.satz.i === 0) ziel.set(0, a.entwurf);
    const istFrage = s => s.teil.art === 'fragen', istSchluss = s => s.teil.art === 'schluss';
    const sprechAb = dsz.speechFrom !== null && dsz.speechFrom !== undefined ? dsz.speechFrom - dsz.start : null;
    if (sprechAb !== null) { const e = saetze.find(s => !istFrage(s) && !istSchluss(s)); if (e && !ziel.has(e.i)) ziel.set(e.i, sprechAb); }

    // Einheiten: ein Sprechteil = eine durchgehende Aufnahme (getrennt wird nur vor einem Satz mit eigenem Ziel)
    const einheiten = [];
    for (const s of saetze) {
      const last = einheiten[einheiten.length - 1];
      if (last && last.teil === s.teil && !ziel.has(s.i)) last.saetze.push(s);
      else einheiten.push({ teil: s.teil, saetze: [s] });
    }
    einheiten.forEach(u => {
      u.t0 = u.saetze[0].t0; u.t1 = u.saetze[u.saetze.length - 1].t1; u.dauer = u.t1 - u.t0;
      u.ziel = ziel.has(u.saetze[0].i) ? ziel.get(u.saetze[0].i) : null;
      // Schnittstelle zur nächsten Einheit desselben Teils: Mitte der längsten Stille zwischen den Sätzen
      u.schnittNach = null;
    });
    einheiten.forEach((u, i) => {
      const nxt = einheiten[i + 1];
      if (!nxt || nxt.teil !== u.teil) return;
      let best = null;
      for (const iv of u.saetze[0].stille) {
        const a = Math.max(iv.von, u.t1), b = Math.min(iv.bis, nxt.t0);
        if (b - a >= 0.06 && (!best || b - a > best.b - best.a)) best = { a, b };
      }
      u.schnittNach = best ? (best.a + best.b) / 2 : (u.t1 + nxt.t0) / 2;
    });

    // Platzierung (Szenenzeit) – der Schlusssatz wird erst nach der Szenenlänge gesetzt
    const haupt = einheiten.filter(u => !istSchluss(u.saetze[0])), schluss = einheiten.filter(u => istSchluss(u.saetze[0]));
    let ende = -Infinity;
    haupt.forEach((u, i) => {
      const vorher = haupt[i - 1];
      let luecke = 0;
      if (vorher) {
        const frageV = istFrage(vorher.saetze[0]), frageU = istFrage(u.saetze[0]);
        if (frageV && frageU) luecke = K.frageLuecke;
        else if (frageV && !frageU) luecke = K.frageNachlauf;
        else luecke = vorher.teil === u.teil ? u.t0 - vorher.t1 : K.lueckeTeile;   // natürliche Pause der Stimme
      }
      const fruehestens = !vorher ? (n === 0 ? K.vorlaufTitel : K.vorlaufMin) : ende + luecke;
      u.bei = Math.max(u.ziel !== null ? u.ziel : fruehestens, fruehestens);
      if (u.ziel !== null && u.bei > u.ziel + 0.01) ergebnis.hinweise.push(`Szene ${n}: Satz „${u.saetze[0].text.slice(0, 40)}…“ beginnt ${r3(u.bei - u.ziel)} s nach seinem Entwurfszeitpunkt (${u.ziel} s)`);
      ende = u.bei + u.dauer;
    });
    const audioEnde = ende;
    const wortzeiten = u => { for (const s of u.saetze) for (const x of s.w) { x.a = r3(u.bei + (x.s - u.t0)); x.b = r3(u.bei + (x.e - u.t0)); } };
    haupt.forEach(wortzeiten);

    // Anker: Entwurfszeit ↔ tatsächliche Zeit
    S.anker = ankerTreffer.map(a => [a.entwurf, a.ref.x.a]);
    for (let i = 1; i < S.anker.length; i++) if (S.anker[i][0] <= S.anker[i - 1][0] || S.anker[i][1] <= S.anker[i - 1][1]) throw new Error(`Szene ${n}: Anker nicht monoton (${JSON.stringify(S.anker.slice(i - 1, i + 1))})`);

    // Szenenlänge: Sprechende + Nachlauf, mindestens bis das Bild fertig ist und seine Haltezeit gezeigt hat
    const be = bildende[n];
    const bildFertig = be ? entwurfZuIst(S.anker, be[0]) + be[1] : nominal;
    S.bildende = be ? { entwurf: be[0], halten: be[1], ist: r3(bildFertig) } : null;
    let L;
    if (schluss.length) {
      if (!letzteSzene) throw new Error(`Szene ${n}: Schlusssatz nur in der letzten Szene möglich`);
      const E = bild(Math.max(audioEnde + K.nachlauf, bildFertig));      // Schlusstafel blendet hier ein
      let bei = E + K.schlussVorlauf;
      schluss.forEach(u => { u.bei = bei; bei += u.dauer + K.lueckeTeile; wortzeiten(u); });
      const sEnde = schluss[schluss.length - 1].bei + schluss[schluss.length - 1].dauer;
      L = Math.max(E + K.schlussDauer, bild(sEnde + 2.0));
      S.schlusstafel = r3(L - K.schlussDauer);
      if (Math.abs(S.schlusstafel - E) > 0.01) ergebnis.hinweise.push(`Szene ${n}: Schlusssatz länger als vorgesehen, Schlusstafel ${r3(L - K.schlussDauer - E)} s später`);
    } else {
      L = bild(Math.max(audioEnde + K.nachlauf, bildFertig));
    }
    L = Math.round(L * 30) / 30;
    S.ende = Math.round((start + L) * 30) / 30;
    S.audioEnde = r3(audioEnde);
    S.aenderung = r3(L - nominal);
    S.tail = 1;                                                    // nach dem letzten Anker läuft das Bild im Echtzeitmaß

    // Segmente für die Tonmischung (absolute Zeit): je Einheit ein Stück der Rohdatei, samt Atem davor und Ausklang danach
    einheiten.forEach((u, i) => {
      const vorU = einheiten[i - 1], nachU = einheiten[i + 1];
      const gleichVor = vorU && vorU.teil === u.teil, gleichNach = nachU && nachU.teil === u.teil;
      const von = gleichVor ? vorU.schnittNach : Math.max(0, u.t0 - 0.3);
      const bis = gleichNach ? u.schnittNach : Math.min(u.saetze[0].dateiDauer, u.t1 + 0.5);
      S.segmente.push({ id: u.teil.id, datei: u.teil.roh.datei, von: r3(von), bis: r3(bis), bei: r3(start + u.bei - (u.t0 - von)), stimme: u.teil.stimme.name });
    });

    // Untertitel
    const cueListe = [];
    for (const u of einheiten) for (const s of u.saetze) {
      const wl = s.w.map(x => ({ w: x.w, s: x.a, e: x.b, sprech: x.sprech }));
      for (const g of schneiden(wl)) cueListe.push({ szene: n, wort: g });
    }
    // Sehr kurze Untertitel (z. B. „Guten Tag.“) mit dem folgenden zusammenfassen, wenn sie sonst unter der Mindestdauer
    // blieben und beide zusammen in zwei Zeilen passen
    for (let i = 0; i < cueListe.length - 1;) {
      const c = cueListe[i], nxt = cueListe[i + 1];
      const b0 = c.wort.filter(x => x.sprech)[0], b1 = nxt.wort.filter(x => x.sprech)[0];
      const zusammen = [...c.wort, ...nxt.wort].map(x => x.w).join(' ');
      if (b1.s - b0.s - 0.07 < K.cueMinDauer && zusammen.length <= K.cueMax && zeilen(zusammen)) { c.wort = [...c.wort, ...nxt.wort]; cueListe.splice(i + 1, 1); }
      else i++;
    }
    // Zeiten: Beginn kurz vor dem ersten Wort, Ende kurz nach dem letzten; zwischen zwei Untertiteln mindestens 2 Bilder Abstand.
    // Folgen die Wörter dicht aufeinander, liegt die Grenze mittig in der Wortlücke.
    const LUECKE = 0.07;
    cueListe.forEach(c => { const buch = c.wort.filter(x => x.sprech); c.s = buch[0].s; c.e = buch[buch.length - 1].e; c.start = Math.max(0, c.s - K.cueVorlauf); });
    cueListe.forEach((c, i) => {
      const nxt = cueListe[i + 1];
      if (!nxt) { c.end = Math.min(c.e + K.cueNachhall, L - 0.1); }
      else if (nxt.start - c.e >= LUECKE) { c.end = Math.min(c.e + K.cueNachhall, nxt.start - LUECKE); }
      else { const mitte = (c.e + nxt.s) / 2; c.end = mitte - LUECKE / 2; nxt.start = Math.max(nxt.start, mitte + LUECKE / 2); }
    });
    cueListe.forEach((c, i) => {
      const nxt = cueListe[i + 1];
      if (c.end - c.start < K.cueMinDauer) c.end = Math.min(c.start + K.cueMinDauer, nxt ? nxt.start - LUECKE : L - 0.1);
      c.text = c.wort.map(x => x.w).join(' ');
      c.lines = zeilen(c.text);
    });
    for (const c of cueListe) ergebnis.cues.push({ szene: n, start: r3(start + c.start), end: r3(start + c.end), lines: c.lines });

    S.saetze = einheiten.flatMap(u => u.saetze.map(s => ({ text: s.text, teil: u.teil.id, art: u.teil.art, ziel: u.saetze[0] === s ? u.ziel : null, beginn: r3(u.bei + (s.t0 - u.t0)), ende: r3(u.bei + (s.t1 - u.t0)), worte: s.w.map(x => [x.w, x.a, x.b]) })));
    ergebnis.szenen.push(S);
    start = S.ende;
  });
  ergebnis.gesamt = start;
  return ergebnis;
}

// Der Ausschnitt, den die HTML-Datei braucht
export function fuerHtml(tl) {
  const szenen = {};
  for (const S of tl.szenen) szenen[S.n] = { start: S.start, end: S.ende, entwurf: S.entwurf, anker: S.anker.map(([d, a]) => [d, a]), tail: S.tail };
  return { szenen, cues: tl.cues.map(c => ({ scene: c.szene, start: c.start, end: c.end, lines: c.lines })) };
}
