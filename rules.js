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

  // Liefert alle verletzten Regeln für die gegebenen Anwesenheitszahlen
  function violations(counts) {
    const out = [];
    for (const r of RULES) {
      const required = r.min !== undefined ? r.min : Math.ceil(counts[r.base] / r.per);
      if (counts[r.role] < required) {
        const why = r.min !== undefined
          ? `Mindestbesetzung: ${r.text}`
          : `${counts[r.base]} ${ROLES[r.base].label} anwesend; Regel: ${r.text}`;
        out.push({
          rule: r,
          required,
          present: counts[r.role],
          message: `${ROLES[r.role].label}: ${counts[r.role]} anwesend, ${required} nötig (${why})`,
        });
      }
    }
    return out;
  }

  /*
   * Prüft einen Urlaubsantrag.
   * Rückgabe: { ok, errors: [string], conflicts: [{day, messages}], workdays }
   */
  function checkRequest(request, persons, vacations, settings) {
    const errors = [];
    const person = persons.find(p => p.id === request.personId);
    if (!person) errors.push('Person nicht gefunden.');
    if (!request.from || !request.to) errors.push('Von- und Bis-Datum angeben.');
    else if (request.from > request.to) errors.push('Das Von-Datum liegt nach dem Bis-Datum.');
    if (errors.length) return { ok: false, errors, conflicts: [], workdays: 0 };

    const overlap = vacations.find(
      v => v.personId === person.id && v.from <= request.to && request.from <= v.to
    );
    if (overlap) {
      errors.push(
        `${person.name} hat bereits Urlaub von ${deDate(overlap.from)} bis ${deDate(overlap.to)}, ` +
        'der sich mit dem Antrag überschneidet.'
      );
      return { ok: false, errors, conflicts: [], workdays: 0 };
    }

    const days = eachDay(request.from, request.to).filter(d => isWorkday(d, settings));
    if (days.length === 0) {
      errors.push('Im gewählten Zeitraum liegt kein Arbeitstag – es wäre kein Urlaubstag nötig.');
      return { ok: false, errors, conflicts: [], workdays: 0 };
    }

    const planned = vacations.concat([{ personId: person.id, from: request.from, to: request.to }]);
    const conflicts = [];
    for (const day of days) {
      const before = violations(presentCounts(day, persons, vacations));
      const after = violations(presentCounts(day, persons, planned));
      // Nur Verstöße zählen, die durch diesen Antrag neu entstehen oder sich verschärfen.
      const caused = after.filter(a => {
        const b = before.find(x => x.rule === a.rule);
        return !b || a.present < b.present || a.required > b.required;
      });
      if (caused.length) conflicts.push({ day, messages: caused.map(c => c.message) });
    }
    return { ok: conflicts.length === 0, errors, conflicts, workdays: days.length };
  }

  /*
   * Stellen ohne Vertretung: Fehlt eine Person dieser Stelle bei sonst voller Besetzung,
   * ist eine Regel verletzt. Diese Personen können nur Urlaub nehmen, wenn sich
   * der Bedarf durch andere Abwesenheiten senkt (oder gar nicht).
   */
  function rolesWithoutCover(persons) {
    const full = presentCounts('', persons, []);
    return ROLE_ORDER.filter(role => {
      if (!full[role]) return false;
      const less = Object.assign({}, full, { [role]: full[role] - 1 });
      return violations(less).length > violations(full).length;
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
    ROLES, ROLE_ORDER, RULES,
    parse, fmt, addDays, eachDay, weekday, deDate,
    easter, holidays, holidayName, isWorkday,
    isAbsent, presentCounts, violations, checkRequest, groupConflicts, rolesWithoutCover,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
