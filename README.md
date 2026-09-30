# Ein ganz normaler Montag – Erklärvideo (Motion Graphics)

Vertraulich – nur zur internen Verwendung.

Erklärvideo für die Verwaltungsführung der Stadt Herne, 1920 × 1080, 30 fps, mit Sprachausgabe, Hintergrundmusik und eingebrannten Untertiteln.
Grundlage ist das Drehbuch `Drehbuch_Video_Angriffsszenario_Herne_V1_6.md` (13 Szenen, Richtwert ca. 7:34, mit Sprachausgabe). Die Stilreferenz
`referenz/Stilreferenz_Herne_Flat_Vector.png` dient nur als Vorlage und ist nicht Teil des Videos.

> **Stand:** Fertig nach Drehbuch V1_6: Begrüßung statt Stille am Anfang, Übergang in Szene 1, Schlusssatz; durchgehender
> Sprechfluss; Pausen zwischen den Szenen 1,5–4,4 s; Hintergrundmusik (eigene Komposition). Szene 9 nennt vier Erwartungen an die
> Verwaltungsleitung (prüfen und billigen, überwachen, schulen, Risiken verantworten – mit Unterschrift unter die ISMS-Dokumente),
> Szene 12 zeigt unter „Vorbereitet“, wer als Nächstes was tut, bei Umsetzungsleitfäden und Härtungslisten auch ihren Zweck. 13 Szenen, 6:32 (Drehbuchzeiten sind Richtwerte), Ton AAC
> 192 kbit/s, −16 LUFS, True Peak ≤ −1 dBTP. Erzähler „Alexander“, Pressefragen „Carla Blum“ und „Dan“ im Wechsel.

## Dateien

| Datei | Inhalt |
|---|---|
| `Ein_ganz_normaler_Montag_V1_0.html` | Das Video in einer Datei: Illustrationen (SVG im Code), Zeitleiste, `render(t)`, Untertitel und Vorschau |
| `export/render.mjs` | Export: nimmt jedes Bild über `render(t)` auf und setzt es mit ffmpeg zu MP4 zusammen (H.264, yuv420p, 30 fps); erzeugt die SRT |
| `export/check.mjs` | Prüfung gegen das Drehbuch (neueste Fassung im Projektordner); Bericht, Standbilder und Kontaktbogen in `output/pruefung/` |
| `export/drehbuch.mjs` | Liest das Drehbuch (Szenen, Zeiten, Sprechertext, Pressefragen) |
| `export/ergaenzungen.mjs` | Ergänzungen zum Sprechertext (Begrüßung, Übergang Szene 1, Schlusssatz) – nicht im Drehbuch, von `check.mjs` einzeln zugelassen |
| `export/tts-text.mjs` | Sprachtexte mit ausgeschriebenen Abkürzungen und Zahlen, Ersetzungs- und Ergänzungsliste; der Ortsname wird nicht gesprochen |
| `export/tts.mjs` | Sprachausgabe (ElevenLabs, mit Zeitmarken, mit dem Text davor/danach als Kontext); Schlüssel nur aus `ELEVENLABS_API_KEY` |
| `export/sync.mjs`, `export/timeline.mjs` | Zeitplan aus den Aufnahmen: Szenenlängen (Sprechende und Bildende), Bild-Ton-Anker, Untertitel |
| `export/musik.py` | Hintergrundmusik: eigene Komposition, synthetisch und deterministisch erzeugt, folgt den Szenen; unter der Stimme abgesenkt |
| `export/audio.mjs` | Tonmischung: Sprache −16 LUFS, Musik darunter, gesamt −16 LUFS integriert, True Peak ≤ −1 dBTP |
| `audio/` | Aufnahmen je Sprechteil (`szene_XX.mp3` + Zeitmarken `.json`), `timeline.json` |
| `audio/tts/` | Sprachtexte je Szene (`szene_XX.txt`), `ERSETZUNGEN.md` und `ERGAENZUNGEN.md` |
| `SITS_Logo.png` | Logo (152 × 88 px), wird als Data-URI in die HTML-Datei eingebettet |
| `export/stills.mjs` | Standbilder zu beliebigen Zeitpunkten |
| `output/` | `Ein_ganz_normaler_Montag_V1_0.mp4` (mit Ton), `Ein_ganz_normaler_Montag_V1_0.srt` (Untertitel synchron zur Stimme), Prüfergebnisse, Muster |

## Vorschau

Die HTML-Datei im Browser öffnen. Bedienung:

| Taste | Funktion |
|---|---|
| Leertaste | Abspielen / Pause |
| ← / → | ein Bild zurück / vor |
| Umschalt + ← / → | eine Sekunde zurück / vor |
| 0 bis 8 | zur jeweiligen Szene springen |

## Prüfen und exportieren

Voraussetzungen: Node.js ab Version 18, `npm install`, `npx playwright install chromium`, ffmpeg im Suchpfad und Python 3 mit numpy und scipy (Musik).

```bash
npm run check                 # Prüfung gegen das neueste Drehbuch im Projektordner (derzeit V1_6)
npm run check -- --stills     # zusätzlich Standbilder bei 25/50/75 % je Szene und Kontaktbogen
npm run export                # MP4 und SRT nach output/
npm run tts:text              # Sprachtexte und Ersetzungsliste nach audio/tts/
node export/tts.mjs           # Sprachausgabe für geänderte Texte (braucht ELEVENLABS_API_KEY); freigegebene Aufnahmen bleiben,
                              # wenn sich nur der Text davor/danach ändert (--kontext erzwingt auch diese)
node export/sync.mjs          # Zeitplan aus den Aufnahmen in die HTML-Datei übernehmen
node export/audio.mjs         # nur die Tonmischung (Sprache + Musik) nach output/.ton/
```

Die Musik entsteht beim Export automatisch neu, sobald sich Zeitplan oder Komposition ändern (`output/.ton/`, nicht im Repository).

## Hinweise zur Umsetzung

- **Deterministisch:** `render(t)` hängt nur von der Zeit t ab. Es gibt keinen Zufall ohne festen Startwert und keine Echtzeit, gleiches t ergibt also das gleiche Bild.
- **Texte:** Alle sichtbaren Texte stehen im Verzeichnis `TEXTE` im HTML und sind wortgleich aus dem Drehbuch übernommen.
  - Jedes Textelement trägt eine Kennung, die `check.mjs` prüft.
  - Ausnahmen laut Auftrag: der Spruch an der Fassade, „Stadt Herne“ und das Haltestellenzeichen.
- **Untertitel und SRT:** Beide stammen aus denselben Cue-Daten (`CUES`).
- **Synchronpunkt Szene 3:** Die Schlüsseldrehung am Serverraum fällt auf „erreicht damit zentrale Systeme“.
- **Zeitplan aus der Sprachaufnahme:** Jede Szene beginnt ihren Sprechtext nach 0,5 s (Titel 1,5 s, die Musik setzt vorher ein).
  Die Szene endet, wenn die Stimme fertig ist (plus 1 s) und das Bild seinen letzten Vorgang samt Haltezeit gezeigt hat
  (`BILDENDE` in der HTML-Datei, an der Bildbewegung gemessen). Reines Stehenbleiben ohne Sprache entfällt; die Stimme wird nie
  beschleunigt. Die Bilder folgen der Stimme über Bild-Ton-Anker (`ANKER`) und laufen danach im Echtzeitmaß.
- **Sprechfluss:** Jeder Sprechteil läuft als durchgehende Aufnahme mit seinen natürlichen Pausen (nichts eingefügt, nichts
  zerschnitten). Bei der Aufnahme bekommt die Stimme den gesprochenen Text davor und danach als Kontext, damit Satzanfänge und
  -enden wie in einem durchgehenden Vortrag betont werden.
- **Ergänzungen zum Sprechertext:** Begrüßung unter der Titelkarte, „Im Rathaus beginnt ein ganz normaler Montag.“ vor Szene 1
  und „Vielen Dank für Ihre Aufmerksamkeit.“ auf der Schlusstafel (`export/ergaenzungen.mjs`, Liste in `audio/tts/ERGAENZUNGEN.md`).
  Inhalt aus dem Drehbuch abgeleitet und seit V1_5 dort als Sprecherzeilen festgehalten.
- **Musik:** eigene Komposition (`export/musik.py`), keine fremden Aufnahmen: F-Dur/d-Moll, je Szene ein Abschnitt, der auf dem
  Szenenwechsel beginnt – ruhig am Anfang, angespannt ab dem Einstieg, Höhepunkt, wenn der Angriff sichtbar wird, zuversichtlich
  zum Schluss. Unter der Stimme etwa 19 LU leiser als die Sprache, in den Pausen zwischen den Szenen hörbar.
- **Ortsname:** Die Stimme sagt „die Stadt“ statt „Herne“; im Bild und in den Untertiteln steht der Name.
- **Marke:** SITS-Logo (Data-URI, Originalgröße) oben rechts in allen Szenen außer der Schlusstafel; dort mittig unter dem Stadt-Herne-Text.
- **Untertitel auf Titelkarte und Schlusstafel** stehen etwas höher, damit sie den Vertraulich-Vermerk unten links nicht berühren.
- **Schrift:** Arial. Wo Arial fehlt, wird die maßgleiche Ersatzschrift verwendet, die Zeilenumbrüche bleiben gleich.
