// Ausführen mit: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const R = require('../rules.js');

const settings = { saturday: false, holidays: true };

function team({ sb = 0, tech = 0, meister = 0, teile = 0, assist = 0 }) {
  const persons = [];
  const add = (role, n) => { for (let i = 0; i < n; i++) persons.push({ id: `${role}${i}`, name: `${role} ${i}`, role }); };
  add('SB', sb); add('TECH', tech); add('MEISTER', meister); add('TEILE', teile); add('ASSIST', assist);
  return persons;
}

test('Ostersonntag und österreichische Feiertage', () => {
  assert.strictEqual(R.easter(2026), '2026-04-05');
  assert.strictEqual(R.easter(2027), '2027-03-28');
  assert.strictEqual(R.holidayName('2026-04-06'), 'Ostermontag');
  assert.strictEqual(R.holidayName('2026-06-04'), 'Fronleichnam');
  assert.strictEqual(R.holidayName('2026-10-26'), 'Nationalfeiertag');
  assert.strictEqual(Object.keys(R.holidays(2026)).length, 13);
});

test('Verhältnisse: ceil-Berechnung', () => {
  assert.strictEqual(R.violations({ SB: 2, TECH: 6, MEISTER: 1, TEILE: 1, ASSIST: 1 }).length, 0);
  const v = R.violations({ SB: 2, TECH: 8, MEISTER: 1, TEILE: 1, ASSIST: 1 });
  assert.deepStrictEqual(v.map(x => x.role).sort(), ['MEISTER', 'SB']);
  assert.deepStrictEqual(R.violations({ SB: 3, TECH: 9, MEISTER: 2, TEILE: 1, ASSIST: 1 }).map(x => x.role), ['ASSIST']);
});

test('Serviceberater-Urlaub wird abgelehnt, wenn zu wenige SB bleiben', () => {
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  const res = R.checkRequest({ personId: 'SB0', from: '2026-11-02', to: '2026-11-06' }, persons, [], settings);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.conflicts.length, 5);
  assert.match(res.conflicts[0].messages[0], /Serviceberater: 1 anwesend, 2 nötig/);
});

test('Techniker-Urlaub senkt den Bedarf und ist erlaubt', () => {
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  const res = R.checkRequest({ personId: 'TECH0', from: '2026-11-02', to: '2026-11-06' }, persons, [], settings);
  assert.strictEqual(res.ok, true);
});

test('SB darf nur an Tagen gehen, an denen ein Techniker fehlt (4 TE brauchen 2 SB, 3 TE nur 1)', () => {
  const persons = team({ sb: 2, tech: 4, meister: 1, teile: 1, assist: 1 });
  const vac = [{ personId: 'TECH0', from: '2026-11-02', to: '2026-11-04' }];
  const res = R.checkRequest({ personId: 'SB0', from: '2026-11-02', to: '2026-11-06' }, persons, vac, settings);
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.conflicts.map(c => c.day), ['2026-11-05', '2026-11-06']);
});

test('Wochenenden und Feiertage werden nicht geprüft', () => {
  const persons = team({ sb: 1, tech: 3, meister: 1, teile: 1, assist: 1 });
  // 24.–26.10.2026: Sa, So, Nationalfeiertag (Mo)
  const res = R.checkRequest({ personId: 'SB0', from: '2026-10-24', to: '2026-10-26' }, persons, [], settings);
  assert.strictEqual(res.ok, false);
  assert.match(res.errors[0], /kein Arbeitstag/);
});

test('Überschneidung mit eigenem Urlaub wird erkannt', () => {
  const persons = team({ tech: 1 });
  const vac = [{ personId: 'TECH0', from: '2026-11-02', to: '2026-11-04' }];
  const res = R.checkRequest({ personId: 'TECH0', from: '2026-11-04', to: '2026-11-06' }, persons, vac, settings);
  assert.strictEqual(res.ok, false);
  assert.match(res.errors[0], /überschneidet/);
});

test('Bestehende Unterbesetzung blockiert nicht unbeteiligte Stellen', () => {
  // 0 SB bei 3 Technikern ist schon ohne Urlaub verletzt; Urlaub der Teilevertriebs-Person (2 vorhanden) ändert daran nichts.
  const persons = team({ sb: 0, tech: 3, meister: 1, teile: 2, assist: 0 });
  const res = R.checkRequest({ personId: 'TEILE0', from: '2026-11-02', to: '2026-11-03' }, persons, [], settings);
  assert.strictEqual(res.ok, true);
});

test('Mindestbesetzung: 3 Techniker müssen bleiben', () => {
  const persons = team({ sb: 2, tech: 3, meister: 1, teile: 1, assist: 1 });
  const res = R.checkRequest({ personId: 'TECH0', from: '2026-11-02', to: '2026-11-02' }, persons, [], settings);
  assert.strictEqual(res.ok, false);
  assert.match(res.conflicts[0].messages[0], /Techniker: 2 anwesend, 3 nötig \(Mindestbesetzung/);
});

test('Mindestbesetzung: letzter Werkstattmeister/Teilevertrieb/Assistentin/SB darf nicht fehlen', () => {
  // Wenige Techniker -> Verhältnisse verlangen nichts, nur die Mindestbesetzung greift
  const persons = team({ sb: 1, tech: 3, meister: 1, teile: 1, assist: 1 });
  for (const id of ['MEISTER0', 'TEILE0', 'ASSIST0', 'SB0']) {
    const res = R.checkRequest({ personId: id, from: '2026-11-02', to: '2026-11-02' }, persons, [], settings);
    assert.strictEqual(res.ok, false, id);
    assert.match(res.conflicts[0].messages.join(), /Mindestbesetzung/, id);
  }
});

test('Personen ohne Vertretung werden erkannt', () => {
  const persons = team({ sb: 2, tech: 6, meister: 2, teile: 1, assist: 1 });
  // SB: 6 TE brauchen 2 SB; TECH: 5 TE bleibt über Minimum; MEISTER: 2 vorhanden, 1 nötig
  assert.deepStrictEqual(R.personsWithoutCover(persons).map(p => p.id), ['SB0', 'SB1', 'TEILE0', 'ASSIST0']);
});

test('Vertretung: Techniker vertritt Werkstattmeister', () => {
  const persons = team({ sb: 2, tech: 5, meister: 1, teile: 1, assist: 1 });
  const req = { personId: 'MEISTER0', from: '2026-11-02', to: '2026-11-03' };
  assert.strictEqual(R.checkRequest(req, persons, [], settings).ok, false);

  persons.find(p => p.id === 'TECH0').deputyFor = ['MEISTER'];
  const res = R.checkRequest(req, persons, [], settings);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.deputies.length, 2);
  assert.strictEqual(res.deputies[0].deputies[0].person.id, 'TECH0');
  assert.strictEqual(res.deputies[0].deputies[0].role, 'MEISTER');
  assert.deepStrictEqual(R.personsWithoutCover(persons).map(p => p.id).includes('MEISTER0'), false);
});

test('Vertretung zählt nicht doppelt: vertretender Techniker fehlt bei den Technikern', () => {
  // 3 TE = Mindestbesetzung; wenn TECH0 den Meister vertritt, bleiben nur 2 TE
  const persons = team({ sb: 1, tech: 3, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').deputyFor = ['MEISTER'];
  const res = R.checkRequest({ personId: 'MEISTER0', from: '2026-11-02', to: '2026-11-02' }, persons, [], settings);
  assert.strictEqual(res.ok, false);
  // Entweder fehlt der Meister oder (mit Vertretung) ein Techniker – beides ist Unterbesetzung
  assert.match(res.conflicts[0].messages.join(), /Werkstattmeister: 0 anwesend|Techniker: 2 anwesend, 3 nötig/);
});

test('Vertreter im Urlaub: Vertretung entfällt, Antrag des Vertreters wird abgelehnt', () => {
  const persons = team({ sb: 2, tech: 5, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').deputyFor = ['MEISTER'];
  const vac = [{ personId: 'MEISTER0', from: '2026-11-02', to: '2026-11-06' }];
  const res = R.checkRequest({ personId: 'TECH0', from: '2026-11-05', to: '2026-11-05' }, persons, vac, settings);
  assert.strictEqual(res.ok, false);
  assert.match(res.conflicts[0].messages.join(), /Werkstattmeister: 0 anwesend, 1 nötig/);
});

test('Vertretungen werden nur bei Bedarf eingesetzt', () => {
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').deputyFor = ['MEISTER', 'TEILE'];
  assert.deepStrictEqual(R.staffing('2026-11-02', persons, []).deputies, []);
});

test('Mehrere Regeln für dieselbe Stelle ergeben eine Meldung', () => {
  const v = R.violations({ SB: 2, TECH: 6, MEISTER: 0, TEILE: 1, ASSIST: 1 });
  assert.strictEqual(v.length, 1);
  assert.match(v[0].message, /Werkstattmeister: 0 anwesend, 1 nötig \(.*max\. 7.* bzw\. Mindestbesetzung/);
});

const qset = Object.assign({}, settings, { qualMin: { P57A: 1, DST: 0 } });

test('Zusatzqualifikation: letzter §57a-Prüfer darf nicht fehlen', () => {
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').quals = ['P57A'];
  const res = R.checkRequest({ personId: 'TECH0', from: '2026-11-02', to: '2026-11-02' }, persons, [], qset);
  assert.strictEqual(res.ok, false);
  assert.match(res.conflicts[0].messages.join(), /§57a-Prüfer: 0 anwesend, 1 nötig/);

  // Mit zweitem Prüfer klappt es
  persons.find(p => p.id === 'TECH1').quals = ['P57A', 'DST'];
  assert.strictEqual(R.checkRequest({ personId: 'TECH0', from: '2026-11-02', to: '2026-11-02' }, persons, [], qset).ok, true);
});

test('Zusatzqualifikation: Mindestanzahl 0 prüft nichts, Qualifikation nur bei Technikern', () => {
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').quals = ['DST'];
  persons.find(p => p.id === 'MEISTER0').quals = ['P57A']; // ignoriert: kein Techniker
  // DST-Mindestanzahl 0 -> erlaubt; fehlender §57a-Prüfer besteht schon vorher und wird nicht verschärft
  assert.strictEqual(R.checkRequest({ personId: 'TECH0', from: '2026-11-02', to: '2026-11-02' }, persons, [], qset).ok, true);
  const st = R.staffing('2026-11-02', persons, [], qset.qualMin);
  assert.deepStrictEqual(st.quals, { P57A: 0, DST: 1 });
});

test('Zusatzqualifikation: Prüfer, der den Meister vertritt, zählt weiter als Prüfer', () => {
  const persons = team({ sb: 2, tech: 5, meister: 1, teile: 1, assist: 1 });
  const t = persons.find(p => p.id === 'TECH0');
  t.quals = ['P57A']; t.deputyFor = ['MEISTER'];
  const res = R.checkRequest({ personId: 'MEISTER0', from: '2026-11-02', to: '2026-11-02' }, persons, [], qset);
  assert.strictEqual(res.ok, true);
});

test('Standard: mind. 1 §57a-Prüfer und 1 Diplomservicetechniker', () => {
  assert.deepStrictEqual(R.DEFAULT_QUAL_MIN, { P57A: 1, DST: 1 });
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').quals = ['P57A'];
  persons.find(p => p.id === 'TECH1').quals = ['DST'];
  persons.find(p => p.id === 'TECH2').quals = ['P57A', 'DST'];
  const s = Object.assign({}, settings, { qualMin: R.DEFAULT_QUAL_MIN });
  // TECH0 weg: TECH2 deckt 57a ab
  assert.strictEqual(R.checkRequest({ personId: 'TECH0', from: '2026-11-02', to: '2026-11-02' }, persons, [], s).ok, true);
  // TECH1 und TECH2 gleichzeitig weg: kein Diplomservicetechniker mehr
  const vac = [{ personId: 'TECH1', from: '2026-11-02', to: '2026-11-02' }];
  const res = R.checkRequest({ personId: 'TECH2', from: '2026-11-02', to: '2026-11-02' }, persons, vac, s);
  assert.strictEqual(res.ok, false);
  assert.match(res.conflicts[0].messages.join(), /Diplomservicetechniker: 0 anwesend, 1 nötig/);
});

test('Bestätigt: eine Person mit 57a und DST erfüllt beide Mindestwerte allein', () => {
  const persons = team({ sb: 2, tech: 6, meister: 1, teile: 1, assist: 1 });
  persons.find(p => p.id === 'TECH0').quals = ['P57A', 'DST'];
  const st = R.staffing('2026-11-02', persons, [], R.DEFAULT_QUAL_MIN);
  assert.deepStrictEqual(st.violations, []);
});
