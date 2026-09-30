// Sprachausgabe mit ElevenLabs: ein Aufruf je Sprechteil über text-to-speech/{voice_id}/with-timestamps.
// Ergebnis je Teil: audio/<id>.mp3 (unverändert wie geliefert) und audio/<id>.json (Text, Stimme, Zeichen-Zeitmarken).
// Szene 8 hat mehrere Teile: die vier Pressefragen (zwei Stimmen im Wechsel) und den Sprechertext.
//
// Aufruf:  node export/tts.mjs                    → alle Szenen (bereits erzeugte Teile werden übersprungen)
//          node export/tts.mjs --scenes 1,9,12    → nur diese Szenen
//          node export/tts.mjs --force            → vorhandene Teile neu erzeugen (kostet Zeichen)
//          node export/tts.mjs --dry              → nur anzeigen, was erzeugt würde
// Der API-Schlüssel steht in der Umgebungsvariable ELEVENLABS_API_KEY. Er wird nie ausgegeben, gespeichert oder geloggt.
// Die Erzählerstimme ist festgelegt; die zwei Stimmen der Pressefragen stehen in audio/stimmen.json (nach Freigabe).
import fs from 'fs';
import path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { findDrehbuch, parseDrehbuch } from './drehbuch.mjs';
import { MODELL, EINSTELLUNGEN, DIR, teile, seedFor, schluessel } from './tts-lib.mjs';

// Node holt den Proxy der Umgebung nicht von selbst: einmal neu starten, damit HTTPS_PROXY gilt
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' } });
  process.exit(r.status ?? 1);
}

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const SCOPE = opt('scenes', null) ? String(opt('scenes')).split(',').map(Number) : null;
const FORCE = !!opt('force', false), DRY = !!opt('dry', false);

const KEY = process.env.ELEVENLABS_API_KEY;
const redact = s => (KEY ? String(s).split(KEY).join('[Schlüssel]') : String(s));
fs.mkdirSync(DIR, { recursive: true });

async function erzeugen(t) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${t.stimme.id}/with-timestamps?output_format=mp3_44100_128`;
  const body = JSON.stringify({ text: t.text, model_id: MODELL, voice_settings: EINSTELLUNGEN, seed: seedFor(t) });
  for (let versuch = 1; versuch <= 4; versuch++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(180000) });
    } catch (e) {
      if (versuch === 4) throw new Error('Verbindungsfehler: ' + redact(e.cause?.code || e.message));
      await new Promise(r => setTimeout(r, 2000 * 2 ** (versuch - 1)));
      continue;
    }
    if (res.ok) return await res.json();
    const txt = redact(await res.text()).replace(/\s+/g, ' ').slice(0, 400);
    if ((res.status === 429 || res.status >= 500) && versuch < 4) { await new Promise(r => setTimeout(r, 2000 * 2 ** (versuch - 1))); continue; }
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
}

const dauer = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

const db = parseDrehbuch(findDrehbuch());
const alle = teile(db).filter(t => !SCOPE || SCOPE.includes(t.szene));
const offen = [];
for (const t of alle) {
  if (!t.stimme) { console.log(`– ${t.id}: übersprungen, Stimme ${t.rolle} ist noch nicht freigegeben (audio/stimmen.json fehlt)`); continue; }
  const jf = path.join(DIR, t.id + '.json'), mf = path.join(DIR, t.id + '.mp3');
  const alt = fs.existsSync(jf) && fs.existsSync(mf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : null;
  if (alt && alt.schluessel === schluessel(t) && !FORCE) { console.log(`= ${t.id}: vorhanden (${alt.text.length} Zeichen, ${dauer(mf).toFixed(2)} s)`); continue; }
  offen.push(t);
}
const zeichen = offen.reduce((a, t) => a + t.text.length, 0);
console.log(`${offen.length} Teile zu erzeugen (${zeichen} Zeichen)${DRY ? ' – Probelauf, es wird nichts gesendet' : ''}`);
if (!DRY && offen.length) {
  if (!KEY) { console.error('ELEVENLABS_API_KEY ist nicht gesetzt.'); process.exit(2); }
  for (const t of offen) {
    if (/herne/i.test(t.text)) throw new Error(`${t.id}: Der Ortsname darf nicht an die Sprachausgabe gehen (Vorgabe des Auftraggebers)`);
    const r = await erzeugen(t);
    const a = r.alignment;
    if (!a || a.characters.join('') !== t.text) throw new Error(`${t.id}: Zeitmarken passen nicht zum gesendeten Text`);
    fs.writeFileSync(path.join(DIR, t.id + '.mp3'), Buffer.from(r.audio_base64, 'base64'));
    const r3 = x => Math.round(x * 1000) / 1000;
    fs.writeFileSync(path.join(DIR, t.id + '.json'), JSON.stringify({
      schluessel: schluessel(t), id: t.id, szene: t.szene, rolle: t.rolle, stimme: t.stimme, modell: MODELL, einstellungen: EINSTELLUNGEN, seed: seedFor(t),
      text: t.text, quelle: t.quelle,
      zeichen: a.characters.length, start: a.character_start_times_seconds.map(r3), ende: a.character_end_times_seconds.map(r3),
    }));
    console.log(`✓ ${t.id}: ${t.text.length} Zeichen, ${dauer(path.join(DIR, t.id + '.mp3')).toFixed(2)} s, Sprechende laut Zeitmarken ${r3(a.character_end_times_seconds.at(-1))} s`);
  }
}
