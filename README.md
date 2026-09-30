# Ein ganz normaler Montag – Erklärvideo (Motion Graphics)

Vertraulich – nur zur internen Verwendung.

Erklärvideo für die Verwaltungsführung der Stadt Herne, 1920 × 1080, 30 fps.
Grundlage ist das Drehbuch `Drehbuch_Video_Angriffsszenario_Herne_V1_4.md` (13 Szenen, ca. 7:34, mit Sprachausgabe). Die Stilreferenz
`referenz/Stilreferenz_Herne_Flat_Vector.png` dient nur als Vorlage und ist nicht Teil des Videos.

> **Stand:** Das Video wird auf Drehbuch V1_4 umgebaut. Die HTML-Datei und die Dateien in `output/` zeigen bis zum Abschluss noch den
> Stand nach Drehbuch V1.2 (9 Szenen, 4:18, ohne Ton); `npm run check` meldet dazu Abweichungen.

## Dateien

| Datei | Inhalt |
|---|---|
| `Ein_ganz_normaler_Montag_V1_0.html` | Das Video in einer Datei: Illustrationen (SVG im Code), Zeitleiste, `render(t)`, Untertitel und Vorschau |
| `export/render.mjs` | Export: nimmt jedes Bild über `render(t)` auf und setzt es mit ffmpeg zu MP4 zusammen (H.264, yuv420p, 30 fps); erzeugt die SRT |
| `export/check.mjs` | Prüfung gegen das Drehbuch (neueste Fassung im Projektordner); Bericht, Standbilder und Kontaktbogen in `output/pruefung/` |
| `export/drehbuch.mjs` | Liest das Drehbuch (Szenen, Zeiten, Sprechertext, Pressefragen) |
| `export/tts-text.mjs` | Sprachtexte mit ausgeschriebenen Abkürzungen und Zahlen, Ersetzungsliste |
| `audio/tts/` | Sprachtexte je Szene (`szene_XX.txt`) und `ERSETZUNGEN.md` |
| `SITS_Logo.png` | Logo (152 × 88 px), wird als Data-URI in die HTML-Datei eingebettet |
| `export/stills.mjs` | Standbilder zu beliebigen Zeitpunkten |
| `output/` | `Ein_ganz_normaler_Montag_V1_0.mp4`, `Ein_ganz_normaler_Montag_V1_0.srt`, Prüfergebnisse, Musterbilder |

## Vorschau

Die HTML-Datei im Browser öffnen. Bedienung:

| Taste | Funktion |
|---|---|
| Leertaste | Abspielen / Pause |
| ← / → | ein Bild zurück / vor |
| Umschalt + ← / → | eine Sekunde zurück / vor |
| 0 bis 8 | zur jeweiligen Szene springen |

## Prüfen und exportieren

Voraussetzungen: Node.js ab Version 18, `npm install`, `npx playwright install chromium` und ffmpeg im Suchpfad.

```bash
npm run check                 # Prüfung gegen das neueste Drehbuch im Projektordner (derzeit V1_4)
npm run check -- --stills     # zusätzlich Standbilder bei 25/50/75 % je Szene und Kontaktbogen
npm run export                # MP4 und SRT nach output/
npm run tts:text              # Sprachtexte und Ersetzungsliste nach audio/tts/
```

## Hinweise zur Umsetzung

- **Deterministisch:** `render(t)` hängt nur von der Zeit t ab. Es gibt keinen Zufall ohne festen Startwert und keine Echtzeit, gleiches t ergibt also das gleiche Bild.
- **Texte:** Alle sichtbaren Texte stehen im Verzeichnis `TEXTE` im HTML und sind wortgleich aus dem Drehbuch übernommen.
  - Jedes Textelement trägt eine Kennung, die `check.mjs` prüft.
  - Ausnahmen laut Auftrag: der Spruch an der Fassade, „Stadt Herne“ und das Haltestellenzeichen.
- **Untertitel und SRT:** Beide stammen aus denselben Cue-Daten (`CUES`).
- **Synchronpunkt Szene 3:** Die Schlüsseldrehung am Serverraum fällt auf „erreicht damit zentrale Systeme“.
- **Schrift:** Arial. Wo Arial fehlt, wird die maßgleiche Ersatzschrift verwendet, die Zeilenumbrüche bleiben gleich.
