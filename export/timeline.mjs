// Zeitplan aus den Audiodateien.
//
// Aus den Rohdateien der Sprachausgabe (audio/szene_*.mp3 + *.json mit Zeichen-Zeitmarken) entstehen:
//  · die Platzierung der Sätze in jeder Szene: Sätze werden nie beschleunigt und nie innerhalb eines Satzes zerschnitten.
//    Ein Satz beginnt zum Entwurfszeitpunkt seines Bild-Ton-Ankers, sofern die Stimme davor fertig ist; sonst kommt er später.
//  · die Szenenlängen: Drehbuchlänge, oder länger, wenn Sprechtext + Nachlauf sie überschreiten (ganze Sekunden)
//  · die Bild-Ton-Anker (Entwurfszeit ↔ tatsächliche Zeit), mit denen die Bilder der Stimme folgen
//  · die Untertitel (Zeitmarken der Wörter, höchstens zwei Zeilen, Satzgrenzen bevorzugt)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ROOT } from './lib.mjs';
import { DIR, teile } from './tts-lib.mjs';

export const KONFIG = {
  vorlaufMin: 0.5,      // Pause am Szenenanfang (mindestens)
  nachlauf: 0.8,        // Pause nach dem letzten Wort einer Szene
  lueckeMin: 0.45,      // kleinste Pause zwischen zwei Sätzen
  frageLuecke: 0.7,     // Pause zwischen den Pressefragen
  frageNachlauf: 1.0,   // Pause zwischen der letzten Pressefrage und dem Sprechertext
  zeileMax: 54,         // Zeichen je Untertitelzeile
  zeileEinzeln: 52,     // Untertitel bis zu dieser Länge stehen in einer Zeile
  cueMax: 100,          // Zeichen je Untertitel (zwei Zeilen)
  cueZiel: 84,          // angestrebte Länge beim Teilen langer Sätze
  cueVorlauf: 0.10,     // Untertitel erscheint kurz vor dem ersten Wort
  cueNachhall: 0.45,    // und bleibt kurz nach dem letzten Wort stehen
  cueMinDauer: 1.0,
  saetzeFesthalten: false,  // true: jeder Satz beginnt zum Entwurfszeitpunkt seines Ankers (Pausen dazwischen); false: Sprechfluss bleibt zusammen
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
    return funktionswort(t) ? 2500 : 900;
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
// szenen: [{ n, title, nominal: [von, bis] }] laut Drehbuch; anker: { n: [[Entwurfszeit, "erste Wörter"], …] }
export function planen(db, anker = {}, optionen = {}) {
  const K = { ...KONFIG, ...optionen };
  const alleTeile = teile(db);
  const ergebnis = { szenen: [], cues: [], hinweise: [] };
  let start = 0;
  for (const dsz of db.scenes) {
    const n = dsz.n;
    const nominal = dsz.end - dsz.start;
    const meine = alleTeile.filter(t => t.szene === n).map(t => ({ ...t, roh: rohLaden(t.id) })).filter(t => t.roh);
    const fehlend = alleTeile.filter(t => t.szene === n && !meine.some(m => m.id === t.id)).map(t => t.id);
    const S = { n, titel: dsz.title, nominal: [dsz.start, dsz.end], start, ende: start + nominal, entwurf: nominal, anker: [], tail: 1, teile: [], saetze: [], segmente: [], fehlend };
    if (!meine.length) { ergebnis.szenen.push(S); start = S.ende; continue; }

    // Sätze aller Teile in Reihenfolge; jeder Satz kennt seinen Teil und seine Zeiten (Rohzeit der Datei)
    const saetze = [];
    for (const teil of meine) {
      const w = woerter(teil, teil.roh);
      const stille_ = stille(teil.roh.pfad);
      const dateiDauer = dauerVon(teil.roh.pfad);
      S.teile.push({ id: teil.id, datei: teil.roh.datei, stimme: teil.stimme.name, rolle: teil.rolle, dauer: r3(dateiDauer) });
      const sl = saetzeVon(w);
      sl.forEach((sw, idx) => {
        const buch = sw.filter(x => x.sprech);
        saetze.push({ teil, w: sw, t0: buch[0].s, t1: buch[buch.length - 1].e, erster: idx === 0, letzter: idx === sl.length - 1, stille: stille_, dateiDauer });
      });
    }
    saetze.forEach((s, i) => { s.i = i; s.text = s.w.map(x => x.w).join(' '); s.dauer = s.t1 - s.t0; });

    // Ziele: Bild-Ton-Anker auf Satzanfängen; Pressefragen und späterer Sprechbeginn laut Drehbuch
    const ank = anker[n] || [];
    const ziel = new Map();
    // Anker den Wörtern zuordnen (in Reihenfolge)
    const alleW = [];
    saetze.forEach(s => s.w.forEach((x, k) => alleW.push({ satz: s, k, x })));
    let suchab = 0;
    const ankerTreffer = ank.map(([entwurf, phrase]) => {
      const pw = phrase.split(/\s+/).map(norm).filter(Boolean);
      for (let i = suchab; i + pw.length <= alleW.length; i++) {
        if (pw.every((p, q) => norm(alleW[i + q].x.w) === p)) { suchab = i + 1; return { entwurf, phrase, ref: alleW[i] }; }
      }
      throw new Error(`Szene ${n}: Anker „${phrase}“ nicht im Sprechtext gefunden`);
    });
    for (const a of ankerTreffer) if (a.ref.k === 0 && (K.saetzeFesthalten || a.ref.satz.i === 0)) ziel.set(a.ref.satz.i, a.entwurf);
    const istFrage = s => s.teil.art === 'fragen';
    // Pressefragen: hintereinander; der Sprechertext beginnt laut Drehbuch später („ab 4:00“)
    const sprechAb = dsz.speechFrom !== null && dsz.speechFrom !== undefined ? dsz.speechFrom - dsz.start : null;
    if (sprechAb !== null) { const e = saetze.find(s => !istFrage(s)); if (e && !ziel.has(e.i)) ziel.set(e.i, sprechAb); }

    // Schnittstellen zwischen Sätzen desselben Teils: nur in echter Stille schneiden
    saetze.forEach((s, i) => {
      const nxt = saetze[i + 1];
      s.schnittNach = null;
      if (!s.letzter && nxt && nxt.teil === s.teil) {
        let best = null;
        for (const iv of s.stille) {
          const a = Math.max(iv.von, s.t1), b = Math.min(iv.bis, nxt.t0);
          if (b - a >= 0.06 && (!best || b - a > best.b - best.a)) best = { a, b };
        }
        if (best) s.schnittNach = (best.a + best.b) / 2;
      }
    });

    // Einheiten: Sätze, die nicht getrennt werden können, bleiben zusammen
    const einheiten = [];
    for (const s of saetze) {
      const last = einheiten[einheiten.length - 1];
      if (last && last.teil === s.teil && last.saetze[last.saetze.length - 1].schnittNach === null && !last.saetze[last.saetze.length - 1].letzter) last.saetze.push(s);
      else einheiten.push({ teil: s.teil, saetze: [s] });
    }
    einheiten.forEach(u => {
      u.t0 = u.saetze[0].t0; u.t1 = u.saetze[u.saetze.length - 1].t1; u.dauer = u.t1 - u.t0;
      u.ziel = ziel.has(u.saetze[0].i) ? ziel.get(u.saetze[0].i) : null;
    });

    // Platzierung (Szenenzeit)
    let ende = -Infinity;
    einheiten.forEach((u, i) => {
      const vorher = einheiten[i - 1];
      let luecke = 0;
      if (vorher) {
        const frageV = istFrage(vorher.saetze[0]), frageU = istFrage(u.saetze[0]);
        if (frageV && frageU) luecke = K.frageLuecke;
        else if (frageV && !frageU) luecke = K.frageNachlauf;
        else luecke = vorher.teil === u.teil ? Math.min(1.0, Math.max(K.lueckeMin, u.t0 - vorher.t1)) : K.lueckeMin;   // natürliche Pause der Stimme bleibt erhalten
      }
      const fruehestens = !vorher ? K.vorlaufMin : ende + luecke;
      u.bei = Math.max(u.ziel !== null ? u.ziel : fruehestens, fruehestens);
      if (u.ziel !== null && u.bei > u.ziel + 0.01) ergebnis.hinweise.push(`Szene ${n}: Satz „${u.saetze[0].text.slice(0, 40)}…“ beginnt ${r3(u.bei - u.ziel)} s nach seinem Entwurfszeitpunkt (${u.ziel} s)`);
      ende = u.bei + u.dauer;
    });
    const audioEnde = ende;

    // Wortzeiten in Szenenzeit
    for (const u of einheiten) for (const s of u.saetze) for (const x of s.w) { x.a = r3(u.bei + (x.s - u.t0)); x.b = r3(u.bei + (x.e - u.t0)); }

    // Anker: Entwurfszeit ↔ tatsächliche Zeit
    S.anker = ankerTreffer.map(a => [a.entwurf, a.ref.x.a]);
    for (let i = 1; i < S.anker.length; i++) if (S.anker[i][0] <= S.anker[i - 1][0] || S.anker[i][1] <= S.anker[i - 1][1]) throw new Error(`Szene ${n}: Anker nicht monoton (${JSON.stringify(S.anker.slice(i - 1, i + 1))})`);

    // Szenenlänge
    let L = Math.max(nominal, Math.ceil(audioEnde + K.nachlauf - 1e-9));
    if (S.anker.length) { const [dl, al] = S.anker[S.anker.length - 1]; L = Math.max(L, Math.ceil(al + (S.entwurf - dl) - 1e-9)); }
    S.ende = start + L;
    S.audioEnde = r3(audioEnde);
    S.verlaengert = L > nominal ? L - nominal : 0;
    if (S.anker.length) { const [dl, al] = S.anker[S.anker.length - 1]; const rd = S.entwurf - dl, ra = L - al; S.tail = ra < rd ? r3(rd / ra) : 1; }

    // Segmente für die Tonmischung (absolute Zeit)
    einheiten.forEach((u, i) => {
      const erstes = u.saetze[0], letztes = u.saetze[u.saetze.length - 1];
      const vorU = einheiten[i - 1], nachU = einheiten[i + 1];
      const gleichVor = vorU && vorU.teil === u.teil, gleichNach = nachU && nachU.teil === u.teil;
      const von = gleichVor ? vorU.saetze[vorU.saetze.length - 1].schnittNach : Math.max(0, u.t0 - 0.2);
      const bis = gleichNach ? letztes.schnittNach : Math.min(erstes.dateiDauer, u.t1 + 0.5);
      S.segmente.push({ id: u.teil.id, datei: u.teil.roh.datei, von: r3(von), bis: r3(bis), bei: r3(start + u.bei - (u.t0 - von)), stimme: u.teil.stimme.name });
    });

    // Untertitel
    const cueListe = [];
    for (const u of einheiten) for (const s of u.saetze) {
      const wl = s.w.map(x => ({ w: x.w, s: x.a, e: x.b, sprech: x.sprech }));
      for (const g of schneiden(wl)) cueListe.push({ szene: n, wort: g });
    }
    cueListe.forEach((c, i) => {
      const buch = c.wort.filter(x => x.sprech);
      c.start = Math.max(0, buch[0].s - K.cueVorlauf);
      const nxt = cueListe[i + 1];
      const grenze = nxt ? (() => { const nb = nxt.wort.filter(x => x.sprech); return nb[0].s - K.cueVorlauf - 0.05; })() : L - 0.1;
      c.end = Math.min(buch[buch.length - 1].e + K.cueNachhall, grenze);
      if (c.end - c.start < K.cueMinDauer) c.end = Math.min(c.start + K.cueMinDauer, grenze);
      c.text = c.wort.map(x => x.w).join(' ');
      c.lines = zeilen(c.text);
    });
    for (const c of cueListe) ergebnis.cues.push({ szene: n, start: r3(start + c.start), end: r3(start + c.end), lines: c.lines });

    S.saetze = einheiten.flatMap(u => u.saetze.map(s => ({ text: s.text, teil: u.teil.id, ziel: u.saetze[0] === s ? u.ziel : null, beginn: r3(u.bei + (s.t0 - u.t0)), ende: r3(u.bei + (s.t1 - u.t0)), worte: s.w.map(x => [x.w, x.a, x.b]) })));
    ergebnis.szenen.push(S);
    start = S.ende;
  }
  ergebnis.gesamt = start;
  return ergebnis;
}

// Der Ausschnitt, den die HTML-Datei braucht
export function fuerHtml(tl) {
  const szenen = {};
  for (const S of tl.szenen) szenen[S.n] = { start: S.start, end: S.ende, entwurf: S.entwurf, anker: S.anker.map(([d, a]) => [d, a]), tail: S.tail };
  return { szenen, cues: tl.cues.map(c => ({ scene: c.szene, start: c.start, end: c.end, lines: c.lines })) };
}
