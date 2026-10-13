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
  assert.deepStrictEqual(v.map(x => x.rule.role).sort(), ['MEISTER', 'SB']);
  assert.deepStrictEqual(R.violations({ SB: 3, TECH: 9, MEISTER: 2, TEILE: 1, ASSIST: 1 }).map(x => x.rule.role), ['ASSIST']);
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

test('Stellen ohne Vertretung werden erkannt', () => {
  const persons = team({ sb: 2, tech: 6, meister: 2, teile: 1, assist: 1 });
  // SB: 6 TE brauchen 2 SB; TECH: 5 TE bleibt über Minimum; MEISTER: 2 vorhanden, 1 nötig
  assert.deepStrictEqual(R.rolesWithoutCover(persons), ['SB', 'ASSIST', 'TEILE']);
});
