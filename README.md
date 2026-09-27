# Ein ganz normaler Montag – Erklärvideo (Motion Graphics)

Vertraulich – nur zur internen Verwendung.

Erklärvideo für die Verwaltungsführung der Stadt Herne, Länge 4:18, 1920 × 1080, 30 fps, ohne Ton.
Grundlage ist das Drehbuch `Drehbuch_Video_Angriffsszenario_Herne_V1_2.md`. Die Stilreferenz
`referenz/Stilreferenz_Herne_Flat_Vector.png` dient nur als Vorlage und ist nicht Teil des Videos.

## Dateien

| Datei | Inhalt |
|---|---|
| `Ein_ganz_normaler_Montag_V1_0.html` | Das Video in einer Datei: Illustrationen (SVG im Code), Zeitleiste, `render(t)`, Untertitel und Vorschau |
| `export/render.mjs` | Export: nimmt jedes Bild über `render(t)` auf und setzt es mit ffmpeg zu MP4 zusammen (H.264, yuv420p, 30 fps); erzeugt die SRT |
| `export/check.mjs` | Prüfung gegen das Drehbuch; Bericht, Standbilder und Kontaktbogen in `output/pruefung/` |
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
npm run check                 # Prüfung gegen Drehbuch V1.2
npm run check -- --stills     # zusätzlich Standbilder bei 25/50/75 % je Szene und Kontaktbogen
npm run export                # MP4 und SRT nach output/
```

## Hinweise zur Umsetzung

- **Deterministisch:** `render(t)` hängt nur von der Zeit t ab. Es gibt keinen Zufall ohne festen Startwert und keine Echtzeit, gleiches t ergibt also das gleiche Bild.
- **Texte:** Alle sichtbaren Texte stehen im Verzeichnis `TEXTE` im HTML und sind wortgleich aus dem Drehbuch übernommen.
  - Jedes Textelement trägt eine Kennung, die `check.mjs` prüft.
  - Ausnahmen laut Auftrag: der Spruch an der Fassade, „Stadt Herne“ und das Haltestellenzeichen.
- **Untertitel und SRT:** Beide stammen aus denselben Cue-Daten (`CUES`). Die SRT dient als Vorlage für die spätere Sprachaufnahme.
- **Synchronpunkt Szene 3:** Die Schlüsseldrehung am Serverraum fällt auf „erreicht damit zentrale Systeme“ (1:22,2).
- **Zeitleiste:** Szene 7 dauert 2:50–3:44 und ist damit 8 s länger als in Drehbuch V1.1. V1.2 hat das übernommen.
- **Schrift:** Arial. Wo Arial fehlt, wird die maßgleiche Ersatzschrift verwendet, die Zeilenumbrüche bleiben gleich.
