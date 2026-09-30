"""Hintergrundmusik für „Ein ganz normaler Montag“ – eigene Komposition, synthetisch erzeugt, deterministisch.

Die Musik folgt der Dramaturgie der Szenen (Zeiten aus audio/timeline.json): ruhig und freundlich in F-Dur
(Titel, Alltag), ab dem Einstieg zunehmend angespannt in d-Moll, Höhepunkt, wenn der Angriff sichtbar wird,
ernst bei Folgen und Verantwortung, aufbauend bei den Maßnahmen, zum Schluss zuversichtlich zurück nach F-Dur
mit Schlussakkord auf der Schlusstafel. Jede Szene hat ihr eigenes Taktraster (etwa 80 Schläge pro Minute),
so dass jeder Szenenwechsel auf eine Eins fällt.

Unter der Stimme wird die Musik abgesenkt; in Pausen zwischen den Szenen kommt sie hervor. Keine fremden
Klänge oder Aufnahmen: alle Instrumente sind hier synthetisiert (Flächen, weiches Klavier, Zupfklang, Puls,
Grundton, Taktgeräusch, Herzschlag, Schlag) – damit frei von Rechten Dritter.

Aufruf: python3 export/musik.py --timeline audio/timeline.json --out output/.ton/Musik.wav [--stats datei.json]
"""
import argparse, json, math, wave
import numpy as np
from scipy import signal

SR = 48000
PAUSE_LUFS = -25.0      # Musik in Sprechpausen (Kurzzeit-Lautheit), Sprache wird auf −16 LUFS gebracht
DUCK_DB = -10.0         # Absenkung unter der Stimme → etwa −35 LUFS, rund 19 LU unter der Sprache
TAKT = 3.0              # angestrebte Taktlänge in s (4/4, ca. 80 BPM)

# ---------------------------------------------------------------- Harmonik
# Akkorde: (Bass als MIDI-Note, obere Stimmen als MIDI-Noten); Tonart F-Dur / d-Moll (ein b)
AKK = {
    'Fmaj9': (41, [53, 57, 60, 64, 67]), 'Dm9': (38, [50, 53, 57, 60, 64]), 'Bbmaj9': (34, [50, 53, 57, 60, 62]),
    'Csus4': (36, [53, 55, 60, 65]), 'C': (36, [52, 55, 60, 64]), 'Dm': (38, [50, 53, 57, 62]), 'Dmadd9': (38, [50, 53, 57, 64]),
    'Bbmaj7': (34, [50, 53, 57, 58]), 'Bbmaj7#11': (34, [50, 52, 53, 57]), 'Gm7': (43, [50, 53, 55, 58]), 'A': (45, [49, 52, 57, 64]),
    'A7sus4': (45, [50, 52, 55, 57]), 'Fmaj7/A': (45, [53, 57, 60, 64]), 'Bb': (34, [50, 53, 58, 62]), 'F': (41, [53, 57, 60, 65]),
    'Gm/D': (38, [50, 55, 58, 62]), 'Dm7': (38, [50, 53, 57, 60]), 'Fmaj7': (41, [52, 57, 60, 64]), 'Gm': (43, [50, 55, 58, 62]),
}

# Abschnitte je Szene: Akkordfolge (ein Akkord je Takt) und Anteil der Instrumente (0–1); hell = Helligkeit der Fläche
SEK = {
    0: dict(name='Titel', folge=['Fmaj9', 'Dm9', 'Bbmaj9', 'Csus4'], pad=1.0, hell=0.45, klavier=0.75, glanz=0.5),
    1: dict(name='Alltag', folge=['Fmaj9', 'Dm9', 'Bbmaj9', 'C'], pad=0.85, hell=0.55, klavier=0.45, arp=0.6, glanz=0.25),
    2: dict(name='Einstieg', folge=['Dm9', 'Bbmaj7', 'Fmaj7/A', 'Csus4'], pad=0.85, hell=0.42, arp=0.45, puls=0.3, grund=0.3),
    3: dict(name='Zugang', folge=['Dmadd9', 'Bbmaj7', 'Gm7', 'A7sus4'], pad=0.8, hell=0.36, puls=0.6, grund=0.5, tick=0.35),
    4: dict(name='Unbemerkt', folge=['Dmadd9', 'Dmadd9', 'Bbmaj7#11', 'Bbmaj7#11'], pad=0.75, hell=0.3, grund=0.6, herz=0.55, tick=0.2),
    5: dict(name='Ausbreitung', folge=['Dm', 'Bb', 'F', 'C'], pad=0.8, hell=0.4, puls=0.8, grund=0.5, tick=0.3),
    6: dict(name='Sichtbar', folge=['Dm', 'Bb', 'Gm', 'A'], pad=0.9, hell=0.45, puls=0.9, grund=0.7, herz=0.4, schlag=1.0),
    7: dict(name='Folgen', folge=['Dm', 'Gm/D', 'Bb', 'A'], pad=0.9, hell=0.35, klavier=0.55, grund=0.6, puls=0.2),
    8: dict(name='Presse', folge=['Dm', 'Dm', 'Bb', 'Bb'], pad=0.7, hell=0.3, grund=0.6, tick=0.45, puls=0.25),
    9: dict(name='Leitung', folge=['Dm', 'F', 'C', 'Bb'], pad=0.8, hell=0.4, puls=0.4, klavier=0.3),
    10: dict(name='Was es braucht', folge=['F', 'C', 'Dm', 'Bb'], pad=0.9, hell=0.55, arp=0.55, puls=0.45, glanz=0.2),
    11: dict(name='Stand heute', folge=['Dm', 'Dm', 'Bbmaj7', 'Bbmaj7'], pad=0.8, hell=0.3, klavier=0.45, grund=0.5),
    12: dict(name='Ausblick', folge=['Fmaj7', 'C', 'Dm7', 'Bbmaj9'], pad=0.9, hell=0.55, arp=0.45, klavier=0.4, glanz=0.35, kadenz=['Bbmaj9', 'Csus4']),
    'ende': dict(name='Schlusstafel', folge=['Fmaj9'], pad=1.0, hell=0.5, glanz=0.5, klavier=0.6, schluss=True),
}

# Pegel der Instrumente (linear) und Hallanteil
PEGEL = dict(pad=0.055, klavier=0.38, arp=0.19, puls=0.25, grund=0.09, tick=0.25, herz=0.33, schlag=0.45, glanz=0.055, riser=0.08)
HALL = dict(pad=0.35, klavier=0.45, arp=0.35, puls=0.08, grund=0.05, tick=0.25, herz=0.12, schlag=0.45, glanz=0.6, riser=0.4)

hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- Bausteine
def saw(f, n, ph0, drift):
    """bandbegrenzte Sägezahnschwingung (PolyBLEP) mit langsamer Tonhöhendrift"""
    finst = f * drift
    ph = (ph0 + np.cumsum(finst) / SR) % 1.0
    dt = finst / SR
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def huelle(n, auf, ab):
    """weiches Ein- und Ausblenden (Kosinus) über auf/ab Sekunden"""
    e = np.ones(n)
    a, b = min(n, int(auf * SR)), min(n, int(ab * SR))
    if a: e[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if b: e[n - b:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b))
    return e


class Spur:
    """Stereo-Summe eines Instruments über die ganze Länge"""
    def __init__(self, n): self.l, self.r = np.zeros(n), np.zeros(n)

    def add(self, t, l, r):
        i = int(round(t * SR))
        if i >= len(self.l): return
        j0 = max(0, -i); i = max(0, i)
        k = min(len(l) - j0, len(self.l) - i)
        if k <= 0: return
        self.l[i:i + k] += l[j0:j0 + k]; self.r[i:i + k] += r[j0:j0 + k]


def pan(y, p):
    """p = −1 (links) … +1 (rechts), gleichbleibende Leistung"""
    a = (p + 1) * np.pi / 4
    return y * np.cos(a), y * np.sin(a)


# ---------------------------------------------------------------- Instrumente
def pad(sp, t0, t1, akk, hell, stark, rng, auf=0.6, ab=1.6):
    bass, oben = AKK[akk]
    n = int((t1 - t0 + ab) * SR)
    tt = np.arange(n) / SR
    L, R = np.zeros(n), np.zeros(n)
    for m in oben + [bass + 12]:
        f = hz(m)
        g = 0.55 if m == bass + 12 else 1.0
        for cents, kanal in ((-7, L), (4, L), (-4, R), (7, R)):
            drift = 2 ** ((cents + 2.5 * np.sin(2 * np.pi * rng.uniform(0.07, 0.19) * tt + rng.uniform(0, 6.3))) / 1200)
            kanal += g * saw(f, n, rng.uniform(), drift)
    fc = 350 + 2600 * hell
    sos = signal.butter(2, fc, 'low', fs=SR, output='sos')
    hp = signal.butter(1, 110, 'high', fs=SR, output='sos')
    e = huelle(n, auf, ab) * stark
    sp.add(t0, signal.sosfilt(hp, signal.sosfilt(sos, L)) * e, signal.sosfilt(hp, signal.sosfilt(sos, R)) * e)


def klavier_ton(f, dauer, vel, rng):
    n = int((dauer + 2.8) * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    B = 0.00032
    for k in range(1, 9):
        fk = f * k * math.sqrt(1 + B * k * k)
        if fk > 6500: break
        ak = (vel ** (1 + 0.18 * k)) / k ** 1.35
        tau = 2.4 / (1 + 0.6 * (k - 1)) * (220 / max(f, 110)) ** 0.35
        y += ak * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.3)) * np.exp(-t / tau)
    y *= np.minimum(1, t / 0.007)
    los = t > dauer
    y[los] *= np.exp(-(t[los] - dauer) / 0.35)
    # weicher Anschlag (Filz): kurzes gefiltertes Rauschen
    nn = int(0.03 * SR)
    filz = rng.standard_normal(nn) * np.exp(-np.arange(nn) / (0.006 * SR)) * 0.02 * vel
    y[:nn] += signal.sosfilt(signal.butter(2, 1800, 'low', fs=SR, output='sos'), filz)
    return y


def zupf_ton(f, vel, rng):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 11):
        fk = f * k
        if fk > 7000: break
        y += (1 / k) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.3)) * np.exp(-t / (0.42 / k ** 0.75))
    return y * np.minimum(1, t / 0.003) * vel


def puls_ton(f, vel, dauer):
    n = int((dauer + 0.25) * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    y = np.tanh(1.4 * y) / np.tanh(1.4)
    return y * np.minimum(1, t / 0.005) * np.exp(-t / 0.16) * vel


def tick_ton(vel, rng):
    n = int(0.06 * SR)
    y = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.009 * SR))
    y = signal.sosfilt(signal.butter(2, [5500, 11000], 'bandpass', fs=SR, output='sos'), y)
    y *= np.minimum(1, np.arange(n) / (0.001 * SR))           # 1 ms Anstieg: Klick ohne digitale Spitze
    return y / (np.abs(y).max() + 1e-12) * 0.6 * vel          # gleichbleibender Spitzenpegel je Schlag


def herz_ton(vel):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 40 + 22 * np.exp(-t / 0.05)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13) * np.minimum(1, t / 0.004) * vel


def schlag_ton(rng):
    n = int(3.0 * SR)
    t = np.arange(n) / SR
    f = 30 + 32 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    rausch = signal.sosfilt(signal.butter(2, 900, 'low', fs=SR, output='sos'), rng.standard_normal(n)) * np.exp(-t / 0.18) * 0.35
    return (boom + rausch) * np.minimum(1, t / 0.003)


def glanz(sp, t0, t1, akk, stark, rng):
    _, oben = AKK[akk]
    n = int((t1 - t0 + 1.5) * SR)
    t = np.arange(n) / SR
    L, R = np.zeros(n), np.zeros(n)
    for i, m in enumerate(sorted(oben)[-3:]):
        f = hz(m + 24)
        y = np.sin(2 * np.pi * f * t + rng.uniform(0, 6.3)) * (0.75 + 0.25 * np.sin(2 * np.pi * rng.uniform(0.2, 0.45) * t))
        l, r = pan(y, (-0.6, 0.0, 0.6)[i])
        L += l; R += r
    e = huelle(n, 1.2, 1.5) * stark
    sp.add(t0, L * e, R * e)


def riser(sp, t_ende, dauer, rng):
    n = int(dauer * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    baender = [signal.sosfilt(signal.butter(2, b, 'bandpass', fs=SR, output='sos'), x) for b in ([200, 800], [800, 2500], [2500, 7000])]
    p = t / dauer
    y = baender[0] * (1 - p) ** 0.5 * 0.6 + baender[1] * np.sin(np.pi * p * 0.9) + baender[2] * p ** 2
    y *= (p ** 2.2)
    aus = int(0.3 * SR)                                   # kurzer Ausklang statt hartem Ende auf dem lautesten Punkt
    y[-aus:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, aus))
    l, r = pan(y, -0.2)
    sp.add(t_ende - dauer, l, r * 1.1)


# ---------------------------------------------------------------- Hall
def hall_impuls(rng, rt60=2.6, laenge=3.2):
    n = int(laenge * SR)
    t = np.arange(n) / SR
    out = []
    for kanal in range(2):
        x = rng.standard_normal(n)
        tief = signal.sosfilt(signal.butter(2, 500, 'low', fs=SR, output='sos'), x) * np.exp(-t * 6.91 / (rt60 * 1.15))
        mitte = signal.sosfilt(signal.butter(2, [500, 3000], 'bandpass', fs=SR, output='sos'), x) * np.exp(-t * 6.91 / rt60)
        hoch = signal.sosfilt(signal.butter(2, 3000, 'high', fs=SR, output='sos'), x) * np.exp(-t * 6.91 / (rt60 * 0.45))
        ir = (tief + mitte + 0.6 * hoch) * np.minimum(1, t / 0.012)
        vor = int(0.022 * SR)
        ir = np.concatenate([np.zeros(vor), ir])[:n]
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return out


# ---------------------------------------------------------------- Lautheit (ITU-R BS.1770, K-Bewertung)
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def k_quadrat(l, r):
    def kw(x): return signal.lfilter(*_K2, signal.lfilter(*_K1, x))
    return kw(l) ** 2 + kw(r) ** 2


def lufs_bereiche(q, bereiche):
    """integrierte Lautheit (mit Schwellen) über die Summe der Bereiche [a, b] in Sekunden"""
    bl, hop = int(0.4 * SR), int(0.1 * SR)
    werte = []
    for a, b in bereiche:
        i, j = int(a * SR), int(b * SR)
        for s in range(i, max(i, j - bl) + 1, hop):
            z = q[s:s + bl]
            if len(z) == bl: werte.append(z.mean())
    werte = np.array(werte)
    if not len(werte): return None
    lk = -0.691 + 10 * np.log10(werte + 1e-20)
    werte = werte[lk > -70]
    if not len(werte): return None
    rel = -0.691 + 10 * np.log10(werte.mean()) - 10
    werte = werte[-0.691 + 10 * np.log10(werte) > rel]
    return float(-0.691 + 10 * np.log10(werte.mean()))


# ---------------------------------------------------------------- Aufbau
def komponieren(tl):
    total = float(tl['gesamt'])
    n = int(math.ceil(total * SR)) + SR
    rng = np.random.default_rng(20260930)
    spuren = {k: Spur(n) for k in PEGEL}
    szenen = tl['szenen']
    abschnitte = []
    for S in szenen:
        a, b = S['start'], S['ende']
        if S.get('schlusstafel') is not None:
            e = a + S['schlusstafel']
            abschnitte.append((a, e, S['n'])); abschnitte.append((e, b, 'ende'))
        else:
            abschnitte.append((a, b, S['n']))
    plan = []
    for a, b, key in abschnitte:
        cfg = SEK[key]
        takte = 1 if cfg.get('schluss') else max(1, round((b - a) / TAKT))   # Schlusstafel: ein langer Schlussakkord
        tl_ = (b - a) / takte
        folge = [cfg['folge'][i % len(cfg['folge'])] for i in range(takte)]
        kad = cfg.get('kadenz')
        if kad and takte > len(kad): folge[-len(kad):] = kad                   # Kadenz in den Schlussakkord
        plan.append(dict(a=a, b=b, key=key, cfg=cfg, takt=tl_, folge=folge))

    for ab_i, p in enumerate(plan):
        cfg, a, tk = p['cfg'], p['a'], p['takt']
        schlag = tk / 4
        erster_abschnitt = ab_i == 0
        for i, akk in enumerate(p['folge']):
            t0, t1 = a + i * tk, a + (i + 1) * tk
            bass, oben = AKK[akk]
            letzter = cfg.get('schluss') and i == len(p['folge']) - 1
            # Fläche: legato – der neue Akkord setzt kurz vor dem Wechsel weich ein, der alte klingt ab dem Wechsel aus
            # (Ausklang 1,4 s, halbe Lautstärke nach 0,7 s); am Anfang des Videos langsamer Einsatz
            if cfg.get('pad'):
                erster = erster_abschnitt and i == 0
                pad(spuren['pad'], t0 - (0 if erster else 0.05), t1, akk, cfg['hell'], cfg['pad'], rng, auf=1.4 if erster else 0.35, ab=0.8 if letzter else 1.4)
            if cfg.get('glanz'):
                glanz(spuren['glanz'], t0 - 0.2, t1, akk, cfg['glanz'], rng)
            # Grundton: tiefe Sinusfläche auf dem Bass
            if cfg.get('grund'):
                nn = int((t1 - t0 + 1.2) * SR); tt = np.arange(nn) / SR
                f = hz(bass)
                y = (np.sin(2 * np.pi * f * tt) + 0.45 * np.sin(4 * np.pi * f * tt + 1.0)) * (0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * tt))
                y *= huelle(nn, 0.5, 1.0) * cfg['grund']
                spuren['grund'].add(t0 - 0.2, y, y)
            # Puls: Achtel (stark) oder Viertel (leise) auf dem Bass
            if cfg.get('puls'):
                achtel = cfg['puls'] >= 0.5
                schritte = 8 if achtel else 4
                d = tk / schritte
                for k in range(schritte):
                    vel = (1.0 if k == 0 else 0.75 if k % (2 if achtel else 1) == 0 else 0.55) * cfg['puls']
                    y = puls_ton(hz(bass + 12), vel, d * 0.9)
                    l, r = pan(y, 0.0)
                    spuren['puls'].add(t0 + k * d, l, r)
            # Taktgeräusch (Uhr): Viertel, abwechselnd links/rechts, Betonung auf der Eins
            if cfg.get('tick'):
                for k in range(4):
                    vel = (1.0 if k == 0 else 0.7) * cfg['tick']
                    l, r = pan(tick_ton(vel, rng), -0.5 if k % 2 == 0 else 0.5)
                    spuren['tick'].add(t0 + k * tk / 4, l, r)
            # Herzschlag: zwei Schläge auf der Eins
            if cfg.get('herz'):
                for dt_, v in ((0.0, 1.0), (0.3 * schlag, 0.65)):
                    y = herz_ton(v * cfg['herz'])
                    spuren['herz'].add(t0 + dt_, y, y)
            # Zupfklang: Achtel-Arpeggio über den oberen Stimmen (eine Oktave höher)
            if cfg.get('arp'):
                toene = sorted(oben)[:4]
                muster = [0, 1, 2, 3, 2, 1, 2, 3]
                for k in range(8):
                    m = toene[muster[k] % len(toene)] + 12
                    vel = (1.0 if k == 0 else 0.8 if k == 4 else 0.62) * cfg['arp']
                    y = zupf_ton(hz(m), vel, rng)
                    l, r = pan(y, (-0.45, 0.45)[k % 2])
                    spuren['arp'].add(t0 + k * tk / 8, l, r)
            # Klavier: wenige Töne je Takt aus dem Akkord, ruhige Melodielinie
            if cfg.get('klavier'):
                kt = sorted(oben)
                if letzter:
                    folge_t = [(0.0, kt[-1] + 12, 0.8), (0.5 * schlag, kt[-3] + 12, 0.6), (1.0 * schlag, kt[-2] + 12, 0.55), (2.0 * schlag, kt[-1] + 24, 0.5)]
                else:
                    wahl = rng.permutation(len(kt))
                    folge_t = [(0.0, kt[wahl[0]] + 12, 0.8), (1.5 * schlag, kt[wahl[1]] + 12, 0.55), (2.5 * schlag, kt[wahl[2 % len(kt)]] + 12, 0.6)]
                    if i % 2 == 1: folge_t.append((3.25 * schlag, kt[-1] + 12, 0.45))
                for dt_, m, v in folge_t:
                    y = klavier_ton(hz(m), schlag * 1.4, v * cfg['klavier'], rng)
                    l, r = pan(y, max(-0.6, min(0.6, (m - 72) / 20)))
                    spuren['klavier'].add(t0 + dt_, l, r)
        # Schlag auf der Eins des Abschnitts, davor ein Anlauf
        if cfg.get('schlag'):
            y = schlag_ton(rng) * cfg['schlag']
            spuren['schlag'].add(a, y, y)
            riser(spuren['riser'], a, 2.6, rng)
    # Anlauf in die Schlusstafel
    for p in plan:
        if p['key'] == 'ende': riser(spuren['riser'], p['a'], 2.2, rng)
    return spuren, plan, n, total


def mischen(spuren, n, rng):
    ir = hall_impuls(rng)
    trocken_l, trocken_r = np.zeros(n), np.zeros(n)
    hall_l, hall_r = np.zeros(n), np.zeros(n)
    for k, sp in spuren.items():
        g = PEGEL[k]
        trocken_l += sp.l * g; trocken_r += sp.r * g
        hall_l += sp.l * g * HALL[k]; hall_r += sp.r * g * HALL[k]
    # Echo für den Zupfklang (Pingpong, etwa punktierte Achtel)
    arp = spuren['arp']
    d = int(0.56 * SR)
    el, er = np.zeros(n), np.zeros(n)
    quelle_l, quelle_r = arp.l * PEGEL['arp'], arp.r * PEGEL['arp']
    for stufe in range(1, 5):
        g = 0.33 ** stufe
        v = d * stufe
        if stufe % 2: el[v:] += quelle_r[:n - v] * g; er[v:] += quelle_l[:n - v] * g
        else: el[v:] += quelle_l[:n - v] * g; er[v:] += quelle_r[:n - v] * g
    lp = signal.butter(2, 3500, 'low', fs=SR, output='sos')
    trocken_l += signal.sosfilt(lp, el); trocken_r += signal.sosfilt(lp, er)
    wl = signal.oaconvolve(hall_l, ir[0])[:n]
    wr = signal.oaconvolve(hall_r, ir[1])[:n]
    L, R = trocken_l + 0.85 * wl, trocken_r + 0.85 * wr
    # Klangbild: Rumpeln weg, Platz für die Sprache (sanfte Senke um 2,8 kHz)
    hp = signal.butter(2, 35, 'high', fs=SR, output='sos')
    b, a = peak_eq(2800, -3.5, 0.8)
    L = signal.lfilter(b, a, signal.sosfilt(hp, L)); R = signal.lfilter(b, a, signal.sosfilt(hp, R))
    return L, R


def peak_eq(f0, gain_db, q):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / SR; al = np.sin(w) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w), 1 - al * A]); a = np.array([1 + al / A, -2 * np.cos(w), 1 - al / A])
    return b / a[0], a / a[0]


# ---------------------------------------------------------------- Absenkung unter der Stimme
def sprachbereiche(tl, zusammen=0.9):
    w = sorted((S['start'] + a, S['start'] + b) for S in tl['szenen'] for st in S['saetze'] for (_, a, b) in st['worte'] if b > a)
    out = []
    for a, b in w:
        if out and a - out[-1][1] < zusammen: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return out


def huellkurve_db(n, total, bereiche):
    """Verstärkung in dB (0 = Pause, DUCK_DB = unter der Stimme); weiche Rampen, Absenkung beginnt vor dem ersten Wort"""
    fs_k = 200
    m = int(math.ceil(n / SR * fs_k)) + 1
    t = np.arange(m) / fs_k
    g = np.zeros(m)
    runter, vor, nach, hoch = 0.45, 0.10, 0.25, 1.3
    for a, b in bereiche:
        s0, s1, s2, s3 = a - vor - runter, a - vor, b + nach, b + nach + hoch
        x = np.zeros(m)
        k = (t >= s0) & (t < s1); x[k] = 0.5 - 0.5 * np.cos(np.pi * (t[k] - s0) / runter)
        x[(t >= s1) & (t <= s2)] = 1
        k = (t > s2) & (t < s3); x[k] = 0.5 + 0.5 * np.cos(np.pi * (t[k] - s2) / hoch)
        g = np.minimum(g, DUCK_DB * x)
    # Anfang einblenden, Ende ausblenden
    g = np.where(t < 1.0, g + 20 * np.log10(np.maximum(1e-4, 0.5 - 0.5 * np.cos(np.pi * np.clip(t / 1.0, 0, 1)))), g)
    aus0 = total - 3.4
    k = t > aus0
    g[k] += 20 * np.log10(np.maximum(1e-5, 0.5 + 0.5 * np.cos(np.pi * np.clip((t[k] - aus0) / 3.4, 0, 1))))
    return np.interp(np.arange(n) / SR, t, g)


def schreiben(pfad, L, R):
    x = np.stack([L, R], axis=1).astype(np.float32)
    # 32-bit float WAV (WAVE_FORMAT_IEEE_FLOAT) von Hand, da das wave-Modul nur PCM kennt
    daten = x.tobytes()
    import struct
    kopf = b'RIFF' + struct.pack('<I', 4 + 26 + 12 + 8 + len(daten)) + b'WAVE'
    fmt = b'fmt ' + struct.pack('<IHHIIHHH', 18, 3, 2, SR, SR * 8, 8, 32, 0)
    fact = b'fact' + struct.pack('<II', 4, len(x))
    with open(pfad, 'wb') as f:
        f.write(kopf + fmt + fact + b'data' + struct.pack('<I', len(daten)) + daten)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeline', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--stats')
    ap.add_argument('--ohne-absenkung', action='store_true')
    arg = ap.parse_args()
    tl = json.load(open(arg.timeline, encoding='utf8'))
    spuren, plan, n, total = komponieren(tl)
    L, R = mischen(spuren, n, np.random.default_rng(7))
    n = int(round(total * SR)); L, R = L[:n], R[:n]
    bereiche = sprachbereiche(tl)
    pausen = []
    t = 0.0
    for a, b in bereiche:
        if a - t > 2.0: pausen.append((t + 0.6, a - 0.6))
        t = b
    if total - t > 2.0: pausen.append((t + 0.6, total - 3.5))
    # Pegel: Musik in den Pausen auf PAUSE_LUFS (vor der Absenkung gemessen)
    q = k_quadrat(L, R)
    ist = lufs_bereiche(q, pausen)
    g = 10 ** ((PAUSE_LUFS - ist) / 20)
    L, R = L * g, R * g
    if not arg.ohne_absenkung:
        env = 10 ** (huellkurve_db(n, total, bereiche) / 20)
        L, R = L * env, R * env
    spitze = float(np.max(np.abs(np.stack([L, R]))))
    schreiben(arg.out, L, R)
    q = k_quadrat(L, R)
    stats = dict(
        dauer=round(total, 3), abschnitte=[dict(von=round(p['a'], 3), bis=round(p['b'], 3), name=p['cfg']['name'], takt=round(p['takt'], 3),
                                                 bpm=round(240 / p['takt'], 1), akkorde=p['folge']) for p in plan],
        pause_lufs=round(lufs_bereiche(q, pausen), 2), sprache_lufs=round(lufs_bereiche(q, [(a, b) for a, b in bereiche]), 2),
        absenkung_db=DUCK_DB, spitze_dbfs=round(20 * math.log10(spitze + 1e-12), 2), pausen=len(pausen))
    if arg.stats: json.dump(stats, open(arg.stats, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in stats.items() if k != 'abschnitte'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
