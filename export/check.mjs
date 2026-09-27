// Prüfung des Videos gegen das Drehbuch (Standard: Drehbuch V1.2).
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
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { loadPlaywright, openVideo, renderAt, ROOT, BASENAME, HTML } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const DREHBUCH = path.resolve(ROOT, opt('drehbuch', 'Drehbuch_Video_Angriffsszenario_Herne_V1_2.md'));
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
  const m = sec.match(/\*\*Sprechertext:\*\*\s*„([\s\S]*?)“/);
  if (m) dSpeech[n] = m[1];
}
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
const sceneOf = t => V.SCENES.find(s => t >= s.start && t < s.end) || V.SCENES[V.SCENES.length - 1];

// ================================================================ A  Szenen und Zeiten
{
  const B = 'Szenen und Zeiten';
  if (dScenes.length !== V.SCENES.length) FEHLER(B, `Anzahl Szenen: Drehbuch ${dScenes.length}, Video ${V.SCENES.length}`);
  for (const d of dScenes) {
    const v = V.SCENES.find(s => s.n === d.n);
    if (!v) { FEHLER(B, `Szene ${d.n} fehlt im Video`); continue; }
    const diffs = [];
    if (v.title !== d.title) diffs.push(`Titel „${v.title}“ ≠ „${d.title}“`);
    if (v.start !== d.start || v.end !== d.end) diffs.push(`Zeit ${fmt(v.start)}–${fmt(v.end)} ≠ ${fmt(d.start)}–${fmt(d.end)}`);
    if (diffs.length) FEHLER(B, `Szene ${d.n}: ${diffs.join('; ')}`);
  }
  const total = dScenes[dScenes.length - 1].end;
  if (V.TOTAL === total && V.frames === total * V.FPS) OK(B, `Szenentitel und -zeiten wie Drehbuch; Gesamtdauer ${fmt(V.TOTAL)} (${V.TOTAL} s = ${V.frames} Bilder bei ${V.FPS} fps)`);
  else FEHLER(B, `Gesamtdauer ${V.TOTAL} s / ${V.frames} Bilder, Drehbuch ${total} s`);
  for (let i = 1; i < dScenes.length; i++) if (dScenes[i].start !== dScenes[i - 1].end) FEHLER(B, `Lücke/Überlappung zwischen Szene ${dScenes[i - 1].n} und ${dScenes[i].n}`);
}

// ================================================================ B  Sprechertext
{
  const B = 'Sprechertext';
  for (const n of Object.keys(dSpeech).map(Number)) {
    if (V.SPRECHERTEXT[n] === dSpeech[n]) OK(B, `Szene ${n}: wortgleich (${dSpeech[n].length} Zeichen)`);
    else FEHLER(B, `Szene ${n}: weicht vom Drehbuch ab`);
  }
  for (const n of Object.keys(V.SPRECHERTEXT).map(Number)) if (!(n in dSpeech)) FEHLER(B, `Szene ${n}: Sprechertext im Video, aber nicht im Drehbuch`);
}

// ================================================================ C  Untertitel (Cues)
const cueMetrics = [];
{
  const B = 'Untertitel';
  const cues = V.CUES.map((c, i) => ({ ...c, i }));
  for (const n of Object.keys(dSpeech).map(Number)) {
    const sc = V.SCENES.find(s => s.n === n);
    const cs = cues.filter(c => c.scene === n);
    if (!cs.length) { (inScope(n) ? FEHLER : INFO)(B, `Szene ${n}: noch keine Untertitel`); continue; }
    const joined = cs.map(c => c.lines.join(' ')).join(' ');
    if (joined === dSpeech[n]) OK(B, `Szene ${n}: ${cs.length} Untertitel, zusammen wortgleich und vollständig`);
    else FEHLER(B, `Szene ${n}: Untertitel ergeben nicht den Sprechertext`);
    cs.forEach((c, k) => {
      const dur = c.end - c.start, chars = c.lines.join(' ').length, cps = chars / dur;
      cueMetrics.push({ n, i: c.i, start: c.start, end: c.end, dur, chars, cps, lines: c.lines });
      if (c.start < sc.start || c.end > sc.end) FEHLER(B, `Cue ${c.i + 1} liegt außerhalb von Szene ${n}`);
      if (c.lines.length > 2) FEHLER(B, `Cue ${c.i + 1}: mehr als zwei Zeilen`);
      if (dur < 1.2) WARN(B, `Cue ${c.i + 1}: nur ${dur.toFixed(1)} s sichtbar`);
      if (cps > 17) FEHLER(B, `Cue ${c.i + 1}: Lesetempo ${cps.toFixed(1)} Zeichen/s (> 17)`);
      else if (cps > 15) WARN(B, `Cue ${c.i + 1}: Lesetempo ${cps.toFixed(1)} Zeichen/s (> 15)`);
      if (k > 0 && c.start < cs[k - 1].end) FEHLER(B, `Cue ${c.i + 1} überlappt Cue ${c.i}`);
      if (k > 0 && c.start - cs[k - 1].end < 0.1) WARN(B, `Cue ${c.i + 1}: Abstand zum Vorgänger < 0,1 s`);
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
}

// ================================================================ D  Synchronpunkte
{
  const B = 'Synchronpunkte';
  for (const s of V.SYNC || []) {
    const sc = sceneOf(s.t);
    if (!inScope(sc.n)) continue;
    const c = V.CUES.find(c => c.lines.join(' ').includes(s.phrase));
    if (!c) { FEHLER(B, `${s.label}: kein Untertitel mit „${s.phrase}“`); continue; }
    const d = c.start - s.t;
    if (Math.abs(d) <= 0.15 && c.end > s.t + 0.3) OK(B, `${s.label} bei ${fmt(s.t)} – Untertitel „${c.lines.join(' ')}“ ab ${fmt(c.start)} (Abweichung ${d.toFixed(2)} s)`);
    else FEHLER(B, `${s.label} bei ${fmt(s.t)}, Untertitel „${s.phrase}“ erst/schon ab ${fmt(c.start)}`);
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
  for (const [a, b] of ranges) {
    for (let t = a; t < b - 1e-6; t += STEP) {
      const tt = Math.round(t * V.FPS) / V.FPS;
      await renderAt(page, tt);
      const els = await page.evaluate(() => [...document.querySelectorAll('#stage text')].map(e => {
        let op = 1, n = e;
        while (n && n.id !== 'stage') { const cs = getComputedStyle(n); if (cs.display === 'none') { op = 0; break; } op *= parseFloat(cs.opacity || '1'); n = n.parentElement; }
        return { k: e.dataset.k || null, i: +(e.dataset.i || 0), text: e.textContent, op };
      }));
      checkGroup(els, tt);
      for (const tm of timed) { const vis = Math.max(0, ...els.filter(e => e.k === tm.key).map(e => e.op)); (timedSeen[tm.key] = timedSeen[tm.key] || []).push([tt, vis]); }
      samples++;
    }
  }
  if (issues.size) for (const m of issues.values()) (m.startsWith('Platzhalter') ? (SCOPE ? INFO : FEHLER) : FEHLER)(B, m);
  const hard = [...issues.values()].filter(m => !m.startsWith('Platzhalter')).length;
  if (!hard) OK(B, `${samples} Zeitpunkte abgetastet (alle ${STEP} s${SCOPE ? ', Szenen ' + SCOPE.join(', ') : ''}): jeder Text trägt eine Kennung und ist wortgleich`);
  // Einblendezeiten laut Drehbuch
  for (const tm of timed) {
    if (!inScope(sceneOf(tm.from).n)) { INFO(B, `Einblendung „${tm.key}“ (${fmt(tm.from)}–${fmt(tm.to)}): Szene ${sceneOf(tm.from).n} nicht im Prüfumfang`); continue; }
    const seen = timedSeen[tm.key];
    if (!seen) continue;
    const inside = seen.filter(([t]) => t >= tm.from + 0.4 && t <= tm.to - 0.4);
    const outside = seen.filter(([t]) => t < tm.from - 0.05 || t > tm.to + 0.05);
    const inOK = inside.length && inside.every(([, v]) => v > 0.5), outOK = outside.every(([, v]) => v < 0.05);
    if (inOK && outOK) OK(B, `Einblendung „${tm.key}“ sichtbar ${fmt(tm.from)}–${fmt(tm.to)} wie im Drehbuch`);
    else FEHLER(B, `Einblendung „${tm.key}“: Sichtbarkeit weicht von ${fmt(tm.from)}–${fmt(tm.to)} ab`);
  }
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
  // Code: Treffer mit Einordnung
  const files = [HTML, ...fs.readdirSync(path.join(ROOT, 'export')).filter(f => f.endsWith('.mjs')).map(f => path.join(ROOT, 'export', f)), path.join(ROOT, 'package.json')];
  const known = [
    [/^URL$/, /w3\.org\/2000\/svg/, 'SVG-Namensraum (technisch notwendig, nicht im Bild)'],
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
  const rows = V.SCENES.map(s => `Szene ${s.n} ${fmt(s.start)}–${fmt(s.end)} (${s.end - s.start} s)`).join(' · ');
  INFO(B, rows);
  if (fs.existsSync(SRT)) {
    const srt = fs.readFileSync(SRT, 'utf8').replace(/\r/g, '').trim().split(/\n\n+/);
    const parsed = srt.map(b => { const l = b.split('\n'); const m = l[1].match(/(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/); const ts = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000; return { start: ts(m[1], m[2], m[3], m[4]), end: ts(m[5], m[6], m[7], m[8]), text: l.slice(2) }; });
    const same = parsed.length === V.CUES.length && parsed.every((p, i) => Math.abs(p.start - V.CUES[i].start) < 0.002 && Math.abs(p.end - V.CUES[i].end) < 0.002 && p.text.join('|') === V.CUES[i].lines.join('|'));
    (same ? OK : FEHLER)(B, `SRT: ${parsed.length} Einträge, ${same ? 'Text und Zeiten identisch mit den eingebrannten Untertiteln' : 'weicht von den Untertiteln ab'}`);
  }
  if (fs.existsSync(MP4)) {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_frames,codec_type:format=duration,size', '-of', 'json', MP4]).toString());
    const v = j.streams.find(s => s.codec_type === 'video'), audio = j.streams.some(s => s.codec_type === 'audio');
    const okAll = v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1' && +v.nb_read_frames === V.frames && !audio;
    (okAll ? OK : FEHLER)(B, `MP4: ${v.codec_name} ${v.profile}, ${v.width}×${v.height}, ${v.pix_fmt}, ${v.r_frame_rate} fps, ${v.nb_read_frames} Bilder, ${(+j.format.duration).toFixed(3)} s, ${(j.format.size / 1e6).toFixed(1)} MB, ${audio ? 'MIT Tonspur' : 'ohne Ton'}`);
  } else INFO(B, 'MP4 noch nicht exportiert');
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
