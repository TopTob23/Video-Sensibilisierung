// Bettet SITS_Logo.png als Data-URI in die HTML-Datei ein (Block LOGO). Das Logo ist die einzige zusätzliche Bilddatei.
// Aufruf: node export/embed-logo.mjs
import fs from 'fs';
import path from 'path';
import { ROOT, HTML } from './lib.mjs';

const png = fs.readFileSync(path.join(ROOT, 'SITS_Logo.png'));
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('SITS_Logo.png ist keine PNG-Datei');
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);          // IHDR: Breite und Höhe in Pixeln
const block = `/* LOGO-BEGIN (erzeugt von export/embed-logo.mjs aus SITS_Logo.png) */\nconst LOGO = { w: ${w}, h: ${h}, uri: 'data:image/png;base64,${png.toString('base64')}' };\n/* LOGO-END */`;
const html = fs.readFileSync(HTML, 'utf8');
const neu = html.replace(/\/\* LOGO-BEGIN[\s\S]*?\/\* LOGO-END \*\//, () => block);
if (neu === html && !html.includes(block)) throw new Error('Block LOGO nicht in der HTML-Datei gefunden');
fs.writeFileSync(HTML, neu);
console.log(`Logo eingebettet: ${w} × ${h} px, ${png.length} Bytes`);
