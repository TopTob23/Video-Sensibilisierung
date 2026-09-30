// Ergänzungen zum Sprechertext auf Wunsch des Auftraggebers (Rückmeldung zum fertigen Video): Begrüßung, Übergang in Szene 1, Schlusssatz.
// Sie stehen nicht im Drehbuch; der Drehbuchtext selbst bleibt wortgleich. check.mjs lässt im Sprechertext und in den
// Untertiteln genau diese Ergänzungen zu – an genau dieser Stelle – und weist sie im Prüfbericht aus.
//
// Regeln für jede Ergänzung:
//  · Inhalt nur aus dem Drehbuch abgeleitet (Titel, Unterzeile, Hinweis-Einblendung, Leitgedanke) – keine neuen Zahlen, Fälle, Belege
//  · Sprachregeln des Drehbuchs: ruhig, vollständige Sätze, keine rhetorischen Fragen, keine Pointe, keine Technik
//  · die Stimme nennt den Ortsnamen nicht („die Stadt“)
//
// stelle: 'vor'     – vor dem Sprechertext der Szene (Szene 0 hat keinen eigenen Sprechertext)
//         'nach'    – nach dem Sprechertext der Szene
//         'schluss' – eigener Sprechteil auf der Schlusstafel (letzte Szene)
export const ERGAENZUNGEN = [
  {
    szene: 0, stelle: 'vor',
    text: 'Guten Tag. Dieses Video zeigt an einem erfundenen, aber realistischen Ablauf, was ein Cyberangriff für die Stadt bedeuten würde und welche Entscheidungen jetzt anstehen.',
    grund: 'Begrüßung statt zwölf Sekunden Stille unter der Titelkarte',
    grundlage: 'Unterzeile der Titelkarte („Was ein Cyberangriff für Herne bedeuten würde“), Leitgedanke („Ein erfundener, aber realistischer Angriffsverlauf“, „welche Entscheidungen jetzt anstehen“)',
  },
  {
    szene: 1, stelle: 'vor',
    text: 'Im Rathaus beginnt ein ganz normaler Montag.',
    grund: 'Übergang: Der Sprechertext setzt sonst unvermittelt mit der Aufzählung „Ausweise, …“ ein',
    grundlage: 'Titel („Ein ganz normaler Montag“), Bild der Szene 1 (Rathaus)',
  },
  {
    szene: 12, stelle: 'schluss',
    text: 'Vielen Dank für Ihre Aufmerksamkeit.',
    grund: 'Abschluss auf der Schlusstafel als Gegenstück zur Begrüßung',
    grundlage: 'Grußformel, kein inhaltlicher Zusatz',
  },
];

export const ergaenzungenFuer = (n, stelle) => ERGAENZUNGEN.filter(e => e.szene === n && e.stelle === stelle).map(e => e.text);
