// Gemeinsame Hilfen für Standbilder, Prüfung und Export.
// Lädt Playwright (lokal installiert oder global) und öffnet das Video im Export-Modus.
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const EXPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
// Projektordner: standardmäßig das Repository; VIDEO_ROOT wählt eine abgeleitete Fassung (z. B. anonym/, erzeugt von export/anonym.mjs)
export const ROOT = process.env.VIDEO_ROOT ? path.resolve(process.env.VIDEO_ROOT) : path.resolve(EXPORT_DIR, '..');
export const HTML = path.join(ROOT, 'Ein_ganz_normaler_Montag_V1_0.html');
export const BASENAME = 'Ein_ganz_normaler_Montag_V1_0';

export async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* weiter mit globaler Installation */ }
  const require = createRequire(import.meta.url);
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(path.join(globalRoot, 'playwright'));
}

// Öffnet eine Seite mit 1920×1080 und wartet, bis render(t) bereit ist.
// Konsolenfehler werden gesammelt und zurückgegeben.
export async function openVideo(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(HTML).href + '?export=1');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const info = await page.evaluate(() => ({ FPS: window.VIDEO.FPS, TOTAL: window.VIDEO.TOTAL, frames: window.VIDEO.frames, SCENES: window.VIDEO.SCENES }));
  return { page, errors, info };
}

// Zeichnet Zeitpunkt t und wartet zwei Bildwechsel ab (Layout und Malen abgeschlossen).
export async function renderAt(page, t) {
  await page.evaluate(t => new Promise(res => { window.renderFrame(t); requestAnimationFrame(() => requestAnimationFrame(res)); }), t);
}

export function frameTime(i, fps) { return i / fps; }
