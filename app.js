/* Oberfläche der Urlaubsplanung. Daten liegen im localStorage des Browsers. */
(function () {
  'use strict';
  const R = window.Rules;
  const STORAGE_KEY = 'werkstatt-urlaubsplanung-v1';
  const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = R.fmt(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));

  let state = load();
  let view = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.persons) && Array.isArray(s.vacations)) {
        s.settings = Object.assign({ saturday: false, holidays: true }, s.settings);
        return s;
      }
    } catch (e) { /* Speicher nicht verfügbar oder leer */ }
    return { persons: [], vacations: [], settings: { saturday: false, holidays: true } };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
  }

  const chip = role => `<span class="chip" style="background:${R.ROLES[role].color}">${R.ROLES[role].label}</span>`;
  const personById = id => state.persons.find(p => p.id === id);
  const sortedPersons = () => state.persons.slice().sort((a, b) =>
    R.ROLE_ORDER.indexOf(a.role) - R.ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'de'));

  // ---------- Personen ----------
  function renderPersons() {
    const counts = R.presentCounts('0000-00-00', state.persons, []);
    $('stats').innerHTML = R.ROLE_ORDER.map(r =>
      `<div class="stat" style="border-color:${R.ROLES[r].color}">${R.ROLES[r].label}: <b>${counts[r]}</b></div>`).join('');

    const v = R.staffing('', state.persons, []).violations;
    $('baseCheck').innerHTML = !state.persons.length ? '' : v.length
      ? `<div class="msg bad"><b>Grundbesetzung verletzt die Regeln schon ohne Urlaub:</b><ul>${v.map(x => `<li>${esc(x.message)}</li>`).join('')}</ul></div>`
      : '<div class="msg ok">Grundbesetzung erfüllt alle Regeln.</div>';
    const noCover = state.persons.length && !v.length ? R.personsWithoutCover(sortedPersons()) : [];
    if (noCover.length) {
      $('baseCheck').innerHTML += `<div class="msg warn"><b>Ohne Vertretung:</b> Fehlt eine dieser Personen bei sonst voller Besetzung, ist die Besetzung unterschritten. Urlaub geht nur, wenn gleichzeitig der Bedarf sinkt (z. B. Techniker auf Urlaub) – sonst unten bei „Vertritt“ eine Vertretung festlegen:<ul>${noCover.map(p => `<li>${esc(p.name)} (${R.ROLES[p.role].label})</li>`).join('')}</ul></div>`;
    }

    const list = sortedPersons();
    $('tblPersons').innerHTML = list.length
      ? '<tr><th>Name</th><th>Stelle</th><th title="Stellen, die diese Person bei Bedarf vertreten darf">Vertritt</th><th></th></tr>' + list.map(p =>
        `<tr><td>${esc(p.name)}</td><td>${chip(p.role)}</td>
         <td class="deps">${R.ROLE_ORDER.filter(r => r !== p.role).map(r =>
           `<label title="${esc(p.name)} darf ${R.ROLES[r].label} vertreten"><input type="checkbox" data-deputy="${p.id}" value="${r}" ${(p.deputyFor || []).includes(r) ? 'checked' : ''}><span style="color:${R.ROLES[r].color}">${R.ROLES[r].short}</span></label>`).join('')}</td>
         <td><button class="del" data-del-person="${p.id}" title="Person löschen">✕</button></td></tr>`).join('')
      : '<tr><td class="empty">Noch keine Personen erfasst.</td></tr>';

    const sel = $('vPerson');
    const prev = sel.value;
    sel.innerHTML = '<option value="">– wählen –</option>' + list.map(p =>
      `<option value="${p.id}">${esc(p.name)} (${R.ROLES[p.role].label})</option>`).join('');
    if (personById(prev)) sel.value = prev;
  }

  $('formPerson').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('pName').value.trim();
    if (!name) return;
    state.persons.push({ id: uid(), name, role: $('pRole').value, deputyFor: [] });
    $('pName').value = '';
    $('pName').focus();
    save(); renderAll();
  });

  $('tblPersons').addEventListener('change', e => {
    const id = e.target.dataset.deputy;
    if (!id) return;
    const p = personById(id);
    const set = new Set(p.deputyFor || []);
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    p.deputyFor = R.ROLE_ORDER.filter(r => set.has(r));
    save(); renderAll();
  });

  $('tblPersons').addEventListener('click', e => {
    const id = e.target.dataset.delPerson;
    if (!id) return;
    const p = personById(id);
    const n = state.vacations.filter(v => v.personId === id).length;
    if (!confirm(`${p.name} löschen?` + (n ? ` (${n} Urlaub(e) werden mitgelöscht)` : ''))) return;
    state.persons = state.persons.filter(x => x.id !== id);
    state.vacations = state.vacations.filter(v => v.personId !== id);
    save(); renderAll();
  });

  // ---------- Urlaub ----------
  $('formVacation').addEventListener('submit', e => {
    e.preventDefault();
    const req = { personId: $('vPerson').value, from: $('vFrom').value, to: $('vTo').value };
    const res = R.checkRequest(req, state.persons, state.vacations, state.settings);
    const p = personById(req.personId);

    if (res.ok) {
      state.vacations.push(Object.assign({ id: uid() }, req));
      save();
      let html = `<div class="msg ok">✔ Urlaub für <b>${esc(p.name)}</b> von ${R.deDate(req.from)} bis ${R.deDate(req.to)} eingetragen (${res.workdays} Arbeitstag${res.workdays === 1 ? '' : 'e'}).`;
      const deps = R.groupConflicts(res.deputies.map(d => ({
        day: d.day, messages: d.deputies.map(x => `${x.person.name} vertritt ${R.ROLES[x.role].label}`),
      })));
      if (deps.length) {
        html += '<div style="margin-top:6px">Möglich nur mit Vertretung:</div><ul>' + deps.map(g =>
          `<li><b>${g.from === g.to ? R.deDate(g.from) : `${R.deDate(g.from)} – ${R.deDate(g.to)}`}</b>: ${g.messages.map(esc).join('; ')}</li>`).join('') + '</ul>';
      }
      $('result').innerHTML = html + '</div>';
      view = { year: Number(req.from.slice(0, 4)), month: Number(req.from.slice(5, 7)) - 1 };
      renderAll();
      return;
    }

    let html = '<div class="msg bad">✘ Urlaub kann <b>nicht</b> eingetragen werden.';
    if (res.errors.length) html += `<ul>${res.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (res.conflicts.length) {
      html += ` An ${res.conflicts.length} von ${res.workdays} Arbeitstagen wäre die Besetzung zu gering:<ul>`;
      for (const g of R.groupConflicts(res.conflicts)) {
        const range = g.from === g.to ? R.deDate(g.from) : `${R.deDate(g.from)} – ${R.deDate(g.to)}`;
        html += `<li><b>${range}</b>: ${g.messages.map(esc).join('; ')}</li>`;
      }
      html += '</ul>';
      const ok = res.workdays - res.conflicts.length;
      if (ok > 0) html += `<div style="margin-top:6px">Tipp: Die übrigen ${ok} Arbeitstage wären möglich – Zeitraum anpassen oder mit Kollegen tauschen.</div>`;
    }
    $('result').innerHTML = html + '</div>';
  });

  $('vFrom').addEventListener('change', () => {
    if (!$('vTo').value || $('vTo').value < $('vFrom').value) $('vTo').value = $('vFrom').value;
  });

  function renderVacations() {
    const list = state.vacations.slice().sort((a, b) => a.from.localeCompare(b.from));
    $('tblVacations').innerHTML = list.length
      ? '<tr><th>Person</th><th>Von</th><th>Bis</th><th></th></tr>' + list.map(v => {
        const p = personById(v.personId);
        return `<tr><td>${chip(p.role)} ${esc(p.name)}</td><td>${R.deDate(v.from)}</td><td>${R.deDate(v.to)}</td>
          <td><button class="del" data-del-vac="${v.id}" title="Urlaub stornieren">✕</button></td></tr>`;
      }).join('')
      : '<tr><td class="empty">Noch keine Urlaube eingetragen.</td></tr>';
  }

  $('tblVacations').addEventListener('click', e => {
    const id = e.target.dataset.delVac;
    if (!id || !confirm('Urlaub stornieren?')) return;
    state.vacations = state.vacations.filter(v => v.id !== id);
    save(); renderAll();
  });

  // ---------- Kalender ----------
  function renderCalendar() {
    const { year, month } = view;
    $('monthTitle').textContent = `${MONTHS[month]} ${year}`;
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const last = R.fmt(new Date(Date.UTC(year, month + 1, 0)));
    const days = R.eachDay(first, last);
    const persons = sortedPersons();

    const dayInfo = days.map(d => {
      const work = R.isWorkday(d, state.settings);
      const hol = R.holidayName(d);
      const st = R.staffing(d, state.persons, state.vacations);
      const deputy = {};
      for (const x of st.deputies) deputy[x.person.id] = x.role;
      return { d, work, hol, counts: st.counts, deputy, viol: work ? st.violations : [] };
    });

    let html = '<thead><tr><th class="name">Mitarbeiter</th>';
    for (const i of dayInfo) {
      const title = i.hol ? ` title="${esc(i.hol)}"` : '';
      html += `<th class="${i.work ? '' : 'off'} ${i.d === today ? 'today' : ''}"${title}>${Number(i.d.slice(8))}<small>${WD[R.weekday(i.d)]}</small></th>`;
    }
    html += '</tr></thead><tbody>';

    if (!persons.length) {
      html += `<tr><td class="name empty" colspan="${days.length + 1}">Bitte zuerst Personen erfassen.</td></tr>`;
    }

    let currentRole = null;
    for (const p of persons) {
      if (p.role !== currentRole) {
        currentRole = p.role;
        html += `<tr class="group"><td class="name" style="color:${R.ROLES[p.role].color}">${R.ROLES[p.role].label}</td>${dayInfo.map(i => `<td class="${i.work ? '' : 'off'}"></td>`).join('')}</tr>`;
      }
      const color = R.ROLES[p.role].color;
      html += `<tr><td class="name" style="border-left-color:${color}">${esc(p.name)}</td>`;
      for (const i of dayInfo) {
        const absent = R.isAbsent(p.id, i.d, state.vacations);
        if (absent && i.work) html += `<td class="vac" style="background:${color}" title="${esc(p.name)}: Urlaub ${R.deDate(i.d)}">U</td>`;
        else if (absent) html += `<td class="off" style="background:${color}55"></td>`;
        else if (i.work && i.deputy[p.id]) {
          const r = R.ROLES[i.deputy[p.id]];
          html += `<td class="dep" style="color:${r.color};border-color:${r.color}" title="${esc(p.name)} vertritt ${r.label}">${r.short}</td>`;
        }
        else html += `<td class="${i.work ? '' : 'off'}"></td>`;
      }
      html += '</tr>';
    }

    if (persons.length) {
      // Anwesenheit je Stelle
      html += `<tr class="group"><td class="name">Anwesend</td>${dayInfo.map(i => `<td class="${i.work ? '' : 'off'}"></td>`).join('')}</tr>`;
      for (const r of R.ROLE_ORDER) {
        if (!state.persons.some(p => p.role === r)) continue;
        html += `<tr><td class="name" style="border-left-color:${R.ROLES[r].color}">${R.ROLES[r].label}</td>`;
        for (const i of dayInfo) {
          if (!i.work) { html += '<td class="off"></td>'; continue; }
          const bad = i.viol.some(v => v.role === r);
          html += `<td class="${bad ? 'badc' : ''}">${i.counts[r]}</td>`;
        }
        html += '</tr>';
      }
      // Gesamtstatus
      html += '<tr class="sum"><td class="name">Status Besetzung</td>';
      for (const i of dayInfo) {
        if (!i.work) { html += `<td class="off" title="${esc(i.hol || 'kein Arbeitstag')}"></td>`; continue; }
        const tip = i.viol.length ? i.viol.map(v => v.message).join('\n') : 'Alle Regeln erfüllt';
        html += `<td class="${i.viol.length ? 'badc' : 'okc'}" title="${esc(tip)}">${i.viol.length ? '✘' : '✔'}</td>`;
      }
      html += '</tr>';
    }
    $('calendar').innerHTML = html + '</tbody>';
  }

  function shiftMonth(n) {
    const d = new Date(Date.UTC(view.year, view.month + n, 1));
    view = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    renderCalendar();
  }
  $('prevMonth').onclick = () => shiftMonth(-1);
  $('nextMonth').onclick = () => shiftMonth(1);
  $('thisMonth').onclick = () => {
    view = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
    renderCalendar();
  };

  // ---------- Einstellungen / Export / Import ----------
  $('setSaturday').checked = state.settings.saturday;
  $('setHolidays').checked = state.settings.holidays;
  $('setSaturday').onchange = e => { state.settings.saturday = e.target.checked; save(); renderAll(); };
  $('setHolidays').onchange = e => { state.settings.holidays = e.target.checked; save(); renderAll(); };

  $('btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `urlaubsplanung-${today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.persons) || !Array.isArray(data.vacations)) throw new Error('Ungültiges Format');
      if (!confirm('Aktuelle Daten durch Import ersetzen?')) return;
      state = { persons: data.persons, vacations: data.vacations,
        settings: Object.assign({ saturday: false, holidays: true }, data.settings) };
      $('setSaturday').checked = state.settings.saturday;
      $('setHolidays').checked = state.settings.holidays;
      save(); renderAll();
    } catch (err) {
      alert('Import fehlgeschlagen: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  // ---------- Start ----------
  $('pRole').innerHTML = R.ROLE_ORDER.map(r => `<option value="${r}">${R.ROLES[r].label}</option>`).join('');
  $('rulesList').innerHTML = R.RULES.map(r => `<li>${r.text}</li>`).join('') +
    '<li>Geprüft wird jeder Arbeitstag im Zeitraum anhand der dann anwesenden Personen.</li>' +
    '<li>Vertretungen (Spalte „Vertritt“ bei den Personen) werden automatisch eingesetzt, wenn nötig. ' +
    'Wer vertritt, fehlt an diesem Tag in seiner eigenen Stelle.</li>';
  $('legend').innerHTML = R.ROLE_ORDER.map(chip).join('') +
    '<span class="chip" style="background:#9ca3af">Wochenende/Feiertag</span>' +
    '<span class="chip" style="background:#fff;color:#374151;box-shadow:inset 0 0 0 2px #374151">WM = vertritt Stelle</span>';

  function renderAll() {
    renderPersons();
    renderVacations();
    renderCalendar();
  }
  renderAll();
})();
