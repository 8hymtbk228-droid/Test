/*
 * Fachlogik der Urlaubsplanung: Rollen, Feiertage, Verhältnisprüfung.
 * Läuft im Browser (window.Rules) und in Node (module.exports) für Tests.
 */
(function (root) {
  'use strict';

  const ROLES = {
    SB:      { label: 'Serviceberater',               short: 'SB', color: '#2563eb' },
    TECH:    { label: 'Techniker',                    short: 'TE', color: '#16a34a' },
    MEISTER: { label: 'Werkstattmeister',             short: 'WM', color: '#ea580c' },
    TEILE:   { label: 'Teilevertrieb',                short: 'TV', color: '#9333ea' },
    ASSIST:  { label: 'Serviceassistentin',           short: 'SA', color: '#db2777' },
  };
  const ROLE_ORDER = ['MEISTER', 'SB', 'ASSIST', 'TECH', 'TEILE'];

  // Zusatzqualifikationen der Techniker; Mindestanzahl je Arbeitstag ist einstellbar
  const QUALS = {
    P57A: { label: '§57a-Prüfer',            short: '57a', color: '#0891b2' },
    DST:  { label: 'Diplomservicetechniker', short: 'DST', color: '#4d7c0f' },
  };
  const QUAL_ORDER = ['P57A', 'DST'];
  const DEFAULT_QUAL_MIN = { P57A: 1, DST: 0 };

  // Verhältnisregeln: "need" Personen der Rolle pro "per" anwesende Personen der Basisrolle.
  const RULES = [
    { role: 'SB',      base: 'TECH', per: 3,  text: '1 Serviceberater je 3 Techniker' },
    { role: 'MEISTER', base: 'TECH', per: 7,  text: 'max. 7 Techniker je Werkstattmeister' },
    { role: 'TEILE',   base: 'TECH', per: 10, text: 'max. 10 Techniker je Teilevertriebsmitarbeiter' },
    { role: 'ASSIST',  base: 'SB',   per: 2,  text: '1 Serviceassistentin je 2 Serviceberater' },
    // Mindestbesetzung je Stelle, unabhängig von den Verhältnissen
    { role: 'SB',      min: 1, text: 'mind. 1 Serviceberater anwesend' },
    { role: 'ASSIST',  min: 1, text: 'mind. 1 Serviceassistentin anwesend' },
    { role: 'MEISTER', min: 1, text: 'mind. 1 Werkstattmeister anwesend' },
    { role: 'TEILE',   min: 1, text: 'mind. 1 Teilevertriebsmitarbeiter anwesend' },
    { role: 'TECH',    min: 3, text: 'mind. 3 Techniker anwesend' },
  ];

  // ---------- Datumshilfen (alles in UTC, Format YYYY-MM-DD) ----------
  function parse(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function fmt(date) {
    return date.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const d = parse(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmt(d);
  }
  function eachDay(from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function weekday(s) {
    return parse(s).getUTCDay(); // 0 = So, 6 = Sa
  }
  function deDate(s) {
    const [y, m, d] = s.split('-');
    return `${d}.${m}.${y}`;
  }

  // Ostersonntag nach Gauß/Anonymer Gregorianischer Algorithmus
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return fmt(new Date(Date.UTC(year, month - 1, day)));
  }

  // Gesetzliche Feiertage Österreich (Feiertagsruhegesetz 1957)
  const holidayCache = {};
  function holidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    const e = easter(year);
    const p = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const map = {
      [p(1, 1)]: 'Neujahr',
      [p(1, 6)]: 'Heilige Drei Könige',
      [addDays(e, 1)]: 'Ostermontag',
      [p(5, 1)]: 'Staatsfeiertag',
      [addDays(e, 39)]: 'Christi Himmelfahrt',
      [addDays(e, 50)]: 'Pfingstmontag',
      [addDays(e, 60)]: 'Fronleichnam',
      [p(8, 15)]: 'Mariä Himmelfahrt',
      [p(10, 26)]: 'Nationalfeiertag',
      [p(11, 1)]: 'Allerheiligen',
      [p(12, 8)]: 'Mariä Empfängnis',
      [p(12, 25)]: 'Christtag',
      [p(12, 26)]: 'Stefanitag',
    };
    holidayCache[year] = map;
    return map;
  }
  function holidayName(s) {
    return holidays(Number(s.slice(0, 4)))[s] || null;
  }

  // Arbeitstag = an diesem Tag muss die Besetzung stimmen
  function isWorkday(s, settings) {
    const wd = weekday(s);
    if (wd === 0) return false;
    if (wd === 6 && !settings.saturday) return false;
    if (settings.holidays && holidayName(s)) return false;
    return true;
  }

  // ---------- Besetzung ----------
  function isAbsent(personId, day, vacations) {
    return vacations.some(v => v.personId === personId && v.from <= day && day <= v.to);
  }

  function presentCounts(day, persons, vacations) {
    const counts = {};
    for (const r of Object.keys(ROLES)) counts[r] = 0;
    for (const p of persons) {
      if (!isAbsent(p.id, day, vacations)) counts[p.role]++;
    }
    return counts;
  }

  /*
   * Liefert die Unterbesetzung je Stelle für die gegebenen Anwesenheitszahlen.
   * Greifen für eine Stelle mehrere Regeln, zählt die strengste; die Begründung nennt alle.
   */
  function violations(counts) {
    const byRole = {};
    for (const r of RULES) {
      const required = r.min !== undefined ? r.min : Math.ceil(counts[r.base] / r.per);
      if (counts[r.role] >= required) continue;
      const why = r.min !== undefined
        ? `Mindestbesetzung: ${r.text}`
        : `${counts[r.base]} ${ROLES[r.base].label} anwesend; Regel: ${r.text}`;
      const v = byRole[r.role];
      if (!v) byRole[r.role] = { rule: r, required, reasons: [why] };
      else {
        v.reasons.push(why);
        if (required > v.required) Object.assign(v, { rule: r, required });
      }
    }
    return ROLE_ORDER.filter(role => byRole[role]).map(role => {
      const v = byRole[role];
      return {
        rule: v.rule,
        key: role,
        role,
        required: v.required,
        present: counts[role],
        deficit: v.required - counts[role],
        message: `${ROLES[role].label}: ${counts[role]} anwesend, ${v.required} nötig (${v.reasons.join(' bzw. ')})`,
      };
    });
  }
  const totalDeficit = v => v.reduce((sum, x) => sum + x.deficit, 0);

  const hasQual = (p, q) => p.role === 'TECH' && (p.quals || []).includes(q);

  /*
   * Mindestanzahl je Zusatzqualifikation. Gezählt werden alle anwesenden Techniker mit der
   * Qualifikation – auch wenn sie an dem Tag eine andere Stelle vertreten (sie sind im Haus).
   */
  function qualViolations(present, qualMin) {
    const out = [];
    for (const q of QUAL_ORDER) {
      const required = (qualMin && qualMin[q]) || 0;
      const n = present.filter(p => hasQual(p, q)).length;
      if (n < required) {
        out.push({
          key: 'Q:' + q,
          role: 'TECH',
          qual: q,
          required,
          present: n,
          deficit: required - n,
          message: `${QUALS[q].label}: ${n} anwesend, ${required} nötig (Mindestbesetzung Zusatzqualifikation)`,
        });
      }
    }
    return out;
  }
  function qualCounts(present) {
    const out = {};
    for (const q of QUAL_ORDER) out[q] = present.filter(p => hasQual(p, q)).length;
    return out;
  }

  // Alle Aufteilungen von n gleichartigen Personen auf k Optionen
  function compositions(n, k) {
    if (k === 1) return [[n]];
    const out = [];
    for (let i = n; i >= 0; i--) for (const rest of compositions(n - i, k - 1)) out.push([i, ...rest]);
    return out;
  }

  /*
   * Ermittelt die beste Besetzung eines Tages unter Einsatz von Vertretungen.
   * Eine Person mit deputyFor zählt entweder in ihrer eigenen Stelle oder – als
   * Vertretung – in genau einer der Stellen, die sie vertreten darf (dann fehlt sie
   * in ihrer eigenen). Gewählt wird die Aufteilung mit dem geringsten Gesamtdefizit,
   * bei Gleichstand die mit den wenigsten Vertretungseinsätzen.
   * Zusätzlich wird die Mindestanzahl je Zusatzqualifikation (qualMin) geprüft.
   * Rückgabe: { counts, quals, violations, deputies: [{ person, role }] }
   */
  function staffing(day, persons, vacations, qualMin) {
    const present = persons.filter(p => !isAbsent(p.id, day, vacations));
    const base = presentCounts(day, present, []);

    // Personen mit gleicher Stelle und gleichen Vertretungsrechten sind austauschbar
    const groups = new Map();
    for (const p of present) {
      const targets = (p.deputyFor || []).filter(r => r !== p.role && ROLES[r]);
      if (!targets.length) continue;
      const key = p.role + '>' + targets.slice().sort().join(',');
      if (!groups.has(key)) groups.set(key, { role: p.role, targets: targets.slice().sort(), people: [] });
      groups.get(key).people.push(p);
    }
    const list = [...groups.values()];
    const choices = list.map(g => compositions(g.people.length, g.targets.length + 1));

    let best = null;
    let budget = 200000; // Schutz gegen kombinatorische Explosion bei sehr vielen Vertretern
    (function search(i, counts, moves, picks) {
      if (budget-- <= 0) return;
      if (i === list.length) {
        const v = violations(counts);
        const d = totalDeficit(v);
        if (!best || d < best.deficit || (d === best.deficit && moves < best.moves)) {
          best = { deficit: d, moves, counts: Object.assign({}, counts), violations: v, picks: picks.slice() };
        }
        return;
      }
      const g = list[i];
      for (const comp of choices[i]) {
        // comp[0] = bleiben in eigener Stelle, comp[j] = vertreten targets[j-1]
        const c = Object.assign({}, counts);
        let m = moves;
        comp.slice(1).forEach((n, j) => { c[g.role] -= n; c[g.targets[j]] += n; m += n; });
        picks.push(comp);
        search(i + 1, c, m, picks);
        picks.pop();
        if (best && best.deficit === 0 && best.moves === 0) return;
      }
    })(0, base, 0, []);

    const deputies = [];
    list.forEach((g, i) => {
      let idx = best.picks[i][0];
      best.picks[i].slice(1).forEach((n, j) => {
        for (let k = 0; k < n; k++) deputies.push({ person: g.people[idx++], role: g.targets[j] });
      });
    });
    return {
      counts: best.counts,
      quals: qualCounts(present),
      violations: best.violations.concat(qualViolations(present, qualMin)),
      deputies,
    };
  }

  /*
   * Prüft einen Urlaubsantrag.
   * Rückgabe: { ok, errors: [string], conflicts: [{day, messages}], deputies: [{day, deputies}], workdays }
   */
  function checkRequest(request, persons, vacations, settings) {
    const errors = [];
    const person = persons.find(p => p.id === request.personId);
    if (!person) errors.push('Person nicht gefunden.');
    if (!request.from || !request.to) errors.push('Von- und Bis-Datum angeben.');
    else if (request.from > request.to) errors.push('Das Von-Datum liegt nach dem Bis-Datum.');
    const fail = () => ({ ok: false, errors, conflicts: [], deputies: [], workdays: 0 });
    if (errors.length) return fail();

    const overlap = vacations.find(
      v => v.personId === person.id && v.from <= request.to && request.from <= v.to
    );
    if (overlap) {
      errors.push(
        `${person.name} hat bereits Urlaub von ${deDate(overlap.from)} bis ${deDate(overlap.to)}, ` +
        'der sich mit dem Antrag überschneidet.'
      );
      return fail();
    }

    const days = eachDay(request.from, request.to).filter(d => isWorkday(d, settings));
    if (days.length === 0) {
      errors.push('Im gewählten Zeitraum liegt kein Arbeitstag – es wäre kein Urlaubstag nötig.');
      return fail();
    }

    const planned = vacations.concat([{ personId: person.id, from: request.from, to: request.to }]);
    const conflicts = [];
    const deputies = [];
    for (const day of days) {
      const before = staffing(day, persons, vacations, settings.qualMin);
      const after = staffing(day, persons, planned, settings.qualMin);
      // Nur Unterbesetzung zählt, die durch diesen Antrag entsteht oder sich verschärft.
      if (totalDeficit(after.violations) > totalDeficit(before.violations)) {
        const worse = after.violations.filter(a => {
          const b = before.violations.find(x => x.key === a.key);
          return !b || a.deficit > b.deficit;
        });
        conflicts.push({ day, messages: (worse.length ? worse : after.violations).map(c => c.message) });
      } else if (after.deputies.length) {
        deputies.push({ day, deputies: after.deputies });
      }
    }
    return { ok: conflicts.length === 0, errors, conflicts, deputies, workdays: days.length };
  }

  /*
   * Personen ohne Vertretung: Fehlt diese Person bei sonst voller Besetzung, ist auch
   * mit allen Vertretungen eine Regel verletzt. Urlaub geht dann nur, wenn der Bedarf
   * durch andere Abwesenheiten sinkt (oder gar nicht).
   */
  function personsWithoutCover(persons, qualMin) {
    const full = totalDeficit(staffing('', persons, [], qualMin).violations);
    return persons.filter(p => {
      const without = persons.filter(x => x !== p);
      return totalDeficit(staffing('', without, [], qualMin).violations) > full;
    });
  }

  // Fasst aufeinanderfolgende Konflikttage mit gleicher Meldung zu Zeiträumen zusammen
  function groupConflicts(conflicts) {
    const groups = [];
    for (const c of conflicts) {
      const key = c.messages.join('|');
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.to = c.day;
      else groups.push({ key, from: c.day, to: c.day, messages: c.messages });
    }
    return groups;
  }

  const api = {
    ROLES, ROLE_ORDER, RULES, QUALS, QUAL_ORDER, DEFAULT_QUAL_MIN, hasQual,
    parse, fmt, addDays, eachDay, weekday, deDate,
    easter, holidays, holidayName, isWorkday,
    isAbsent, presentCounts, violations, staffing, checkRequest, groupConflicts, personsWithoutCover,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
