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

  // Version 2: Mindestanzahl Diplomservicetechniker ist 1 – ältere gespeicherte Werte (0) werden ersetzt
  const SETTINGS_VERSION = 2;
  const normSettings = s => Object.assign({ saturday: false, holidays: true }, s, {
    version: SETTINGS_VERSION,
    qualMin: Object.assign({}, R.DEFAULT_QUAL_MIN, s && s.version === SETTINGS_VERSION ? s.qualMin : null),
  });

  let state = load();
  let view = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.persons) && Array.isArray(s.vacations)) {
        s.settings = normSettings(s.settings);
        return s;
      }
    } catch (e) { /* Speicher nicht verfügbar oder leer */ }
    return { persons: [], vacations: [], settings: normSettings({}) };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
  }

  const qualBadge = q => `<span class="qual" style="background:${R.QUALS[q].color}" title="${R.QUALS[q].label}">${R.QUALS[q].short}</span>`;
  const qualBadges = p => R.QUAL_ORDER.filter(q => R.hasQual(p, q)).map(qualBadge).join('');
  // Zweistufige Bestätigung im Button selbst (confirm() steht nicht überall zur Verfügung)
  function confirmed(btn, label) {
    if (btn.classList.contains('armed')) return true;
    const orig = btn.textContent;
    btn.classList.add('armed');
    btn.textContent = label;
    setTimeout(() => {
      if (btn.isConnected && btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = orig; }
    }, 4000);
    return false;
  }

  const chip = role => `<span class="chip" style="background:${R.ROLES[role].color}">${R.ROLES[role].label}</span>`;
  const personById = id => state.persons.find(p => p.id === id);
  const sortedPersons = () => state.persons.slice().sort((a, b) =>
    R.ROLE_ORDER.indexOf(a.role) - R.ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'de'));

  // ---------- Personen ----------
  function renderPersons() {
    const counts = R.presentCounts('0000-00-00', state.persons, []);
    $('stats').innerHTML = R.ROLE_ORDER.map(r =>
      `<div class="stat" style="border-color:${R.ROLES[r].color}">${R.ROLES[r].label}: <b>${counts[r]}</b></div>`).join('') +
      R.QUAL_ORDER.map(q =>
        `<div class="stat" style="border-color:${R.QUALS[q].color}">davon ${R.QUALS[q].label}: <b>${state.persons.filter(p => R.hasQual(p, q)).length}</b></div>`).join('');

    $('qualMin').innerHTML = '<span>Mindestens anwesend (Techniker mit Zusatzqualifikation):</span>' + R.QUAL_ORDER.map(q =>
      `<label>${qualBadge(q)} ${R.QUALS[q].label} <input type="number" min="0" max="20" step="1" data-qualmin="${q}" value="${state.settings.qualMin[q]}"></label>`).join('');

    const v = R.staffing('', state.persons, [], state.settings.qualMin).violations;
    $('baseCheck').innerHTML = !state.persons.length ? '' : v.length
      ? `<div class="msg bad"><b>Grundbesetzung verletzt die Regeln schon ohne Urlaub:</b><ul>${v.map(x => `<li>${esc(x.message)}</li>`).join('')}</ul></div>`
      : '<div class="msg ok">Grundbesetzung erfüllt alle Regeln.</div>';
    const noCover = state.persons.length && !v.length ? R.personsWithoutCover(sortedPersons(), state.settings.qualMin) : [];
    if (noCover.length) {
      $('baseCheck').innerHTML += `<div class="msg warn"><b>Ohne Vertretung:</b> Fehlt eine dieser Personen bei sonst voller Besetzung, ist die Besetzung unterschritten. Urlaub geht nur, wenn gleichzeitig der Bedarf sinkt (z. B. Techniker auf Urlaub) – sonst unten bei „Vertritt“ eine Vertretung festlegen:<ul>${noCover.map(p => `<li>${esc(p.name)} (${R.ROLES[p.role].label}${R.QUAL_ORDER.filter(q => R.hasQual(p, q)).map(q => ', ' + R.QUALS[q].label).join('')})</li>`).join('')}</ul></div>`;
    }

    const list = sortedPersons();
    $('tblPersons').innerHTML = list.length
      ? '<tr><th>Name</th><th>Stelle</th><th title="Zusatzqualifikationen (nur Techniker)">Zusatz</th><th title="Stellen, die diese Person bei Bedarf vertreten darf">Vertritt</th><th></th></tr>' + list.map(p =>
        `<tr><td>${esc(p.name)}</td><td>${chip(p.role)}</td>
         <td class="deps">${p.role !== 'TECH' ? '' : R.QUAL_ORDER.map(q =>
           `<label title="${R.QUALS[q].label}"><input type="checkbox" data-qual="${p.id}" value="${q}" ${(p.quals || []).includes(q) ? 'checked' : ''}><span style="color:${R.QUALS[q].color}">${R.QUALS[q].short}</span></label>`).join('')}</td>
         <td class="deps">${R.ROLE_ORDER.filter(r => r !== p.role).map(r =>
           `<label title="${esc(p.name)} darf ${R.ROLES[r].label} vertreten"><input type="checkbox" data-deputy="${p.id}" value="${r}" ${(p.deputyFor || []).includes(r) ? 'checked' : ''}><span style="color:${R.ROLES[r].color}">${R.ROLES[r].short}</span></label>`).join('')}</td>
         <td><button class="del" data-del-person="${p.id}" title="Person löschen">✕</button></td></tr>`).join('')
      : '<tr><td class="empty">Noch keine Personen erfasst. Oben Name und Stelle eingeben – oder zum Ausprobieren ' +
        '<button type="button" class="ghost" id="btnSample">Beispielteam laden</button></td></tr>';

    const sel = $('vPerson');
    const prev = sel.value;
    sel.innerHTML = '<option value="">– wählen –</option>' + list.map(p =>
      `<option value="${p.id}">${esc(p.name)} (${R.ROLES[p.role].label}${R.QUAL_ORDER.filter(q => R.hasQual(p, q)).map(q => ', ' + R.QUALS[q].short).join('')})</option>`).join('');
    if (personById(prev)) sel.value = prev;
  }

  $('formPerson').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('pName').value.trim();
    if (!name) return;
    state.persons.push({ id: uid(), name, role: $('pRole').value, deputyFor: [], quals: [] });
    $('pName').value = '';
    $('pName').focus();
    save(); renderAll();
  });

  $('tblPersons').addEventListener('change', e => {
    const qid = e.target.dataset.qual;
    if (qid) {
      const p = personById(qid);
      const set = new Set(p.quals || []);
      if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
      p.quals = R.QUAL_ORDER.filter(q => set.has(q));
      save(); renderAll();
      return;
    }
    const id = e.target.dataset.deputy;
    if (!id) return;
    const p = personById(id);
    const set = new Set(p.deputyFor || []);
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    p.deputyFor = R.ROLE_ORDER.filter(r => set.has(r));
    save(); renderAll();
  });

  $('qualMin').addEventListener('change', e => {
    const q = e.target.dataset.qualmin;
    if (!q) return;
    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
    state.settings.qualMin[q] = n;
    save(); renderAll();
  });

  $('tblPersons').addEventListener('click', e => {
    if (e.target.id === 'btnSample') { loadSample(); return; }
    const btn = e.target.closest('[data-del-person]');
    if (!btn) return;
    const id = btn.dataset.delPerson;
    const n = state.vacations.filter(v => v.personId === id).length;
    if (!confirmed(btn, n ? `Löschen? (${n} Urlaub${n === 1 ? '' : 'e'} weg)` : 'Löschen?')) return;
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
    const btn = e.target.closest('[data-del-vac]');
    if (!btn || !confirmed(btn, 'Stornieren?')) return;
    const id = btn.dataset.delVac;
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
      const st = R.staffing(d, state.persons, state.vacations, state.settings.qualMin);
      const deputy = {};
      for (const x of st.deputies) deputy[x.person.id] = x.role;
      return { d, work, hol, counts: st.counts, quals: st.quals, deputy, viol: work ? st.violations : [] };
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
      html += `<tr><td class="name" style="border-left-color:${color}">${esc(p.name)} ${qualBadges(p)}</td>`;
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
          const bad = i.viol.some(v => v.key === r);
          html += `<td class="${bad ? 'badc' : ''}">${i.counts[r]}</td>`;
        }
        html += '</tr>';
      }
      for (const q of R.QUAL_ORDER) {
        if (!state.settings.qualMin[q] && !state.persons.some(p => R.hasQual(p, q))) continue;
        const min = state.settings.qualMin[q];
        html += `<tr><td class="name" style="border-left-color:${R.QUALS[q].color}">↳ ${R.QUALS[q].label}${min ? ` <small>(mind. ${min})</small>` : ''}</td>`;
        for (const i of dayInfo) {
          if (!i.work) { html += '<td class="off"></td>'; continue; }
          const bad = i.viol.some(v => v.key === 'Q:' + q);
          html += `<td class="${bad ? 'badc' : ''}">${i.quals[q]}</td>`;
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

  function applyData(data) {
    if (!data || !Array.isArray(data.persons) || !Array.isArray(data.vacations)) {
      throw new Error('Der Text enthält keine Urlaubsplanung (persons/vacations fehlen).');
    }
    state = { persons: data.persons, vacations: data.vacations, settings: normSettings(data.settings) };
    $('setSaturday').checked = state.settings.saturday;
    $('setHolidays').checked = state.settings.holidays;
    save(); renderAll();
  }

  // Beispielteam zum Ausprobieren (fiktive Namen)
  function loadSample() {
    const t = (name, role, extra) => Object.assign({ id: uid(), name, role, deputyFor: [], quals: [] }, extra);
    applyData({
      persons: [
        t('Beispiel Meister', 'MEISTER'),
        t('Beispiel Berater 1', 'SB'), t('Beispiel Berater 2', 'SB'),
        t('Beispiel Assistentin', 'ASSIST'),
        t('Beispiel Techniker 1', 'TECH', { quals: ['P57A'], deputyFor: ['MEISTER'] }),
        t('Beispiel Techniker 2', 'TECH', { quals: ['P57A', 'DST'] }),
        t('Beispiel Techniker 3', 'TECH', { quals: ['DST'] }),
        t('Beispiel Techniker 4', 'TECH'), t('Beispiel Techniker 5', 'TECH'), t('Beispiel Techniker 6', 'TECH'),
        t('Beispiel Teilevertrieb', 'TEILE'),
      ],
      vacations: [],
      settings: state.settings,
    });
  }

  const exportJson = () => JSON.stringify(state, null, 2);
  $('btnData').onclick = () => {
    const panel = $('dataPanel');
    panel.hidden = !panel.hidden;
    $('btnData').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) {
      $('exportText').value = exportJson();
      $('exportMsg').textContent = '';
      panel.scrollIntoView({ block: 'start' });
    }
  };
  $('btnCopy').onclick = () => {
    const ta = $('exportText');
    ta.value = exportJson();
    const fallback = () => { ta.focus(); ta.select(); $('exportMsg').textContent = 'Text ist markiert – mit Strg+C kopieren.'; };
    try {
      navigator.clipboard.writeText(ta.value)
        .then(() => { $('exportMsg').textContent = 'Kopiert.'; }, fallback);
    } catch (e) { fallback(); }
  };
  if ($('btnDownload')) $('btnDownload').onclick = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `urlaubsplanung-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('fileImport').onchange = async e => {
    const file = e.target.files[0];
    if (file) $('importText').value = await file.text();
    e.target.value = '';
  };
  $('btnImport').onclick = () => {
    const msg = $('importMsg');
    let data;
    try {
      data = JSON.parse($('importText').value);
      if (!data || !Array.isArray(data.persons) || !Array.isArray(data.vacations)) {
        throw new Error('Der Text enthält keine Urlaubsplanung (persons/vacations fehlen).');
      }
    } catch (err) {
      const why = err instanceof SyntaxError ? 'Der Text ist keine gültige Sicherung.' : err.message;
      msg.innerHTML = `<div class="msg bad">Laden nicht möglich: ${esc(why)} Bitte den vollständigen gesicherten Text einfügen.</div>`;
      return;
    }
    if (!confirmed($('btnImport'), 'Aktuelle Daten ersetzen?')) return;
    applyData(data);
    $('btnImport').classList.remove('armed');
    $('btnImport').textContent = 'Daten übernehmen';
    $('importText').value = '';
    $('exportText').value = exportJson();
    msg.innerHTML = `<div class="msg ok">Geladen: ${state.persons.length} Personen, ${state.vacations.length} Urlaube.</div>`;
  };

  // ---------- Start ----------
  $('pRole').innerHTML = R.ROLE_ORDER.map(r => `<option value="${r}">${R.ROLES[r].label}</option>`).join('');
  $('legend').innerHTML = R.ROLE_ORDER.map(chip).join('') +
    '<span class="chip" style="background:var(--off);color:var(--muted)">Wochenende/Feiertag</span>' +
    '<span class="chip outline">WM = vertritt Stelle</span>';

  function renderAll() {
    $('rulesList').innerHTML = R.RULES.map(r => `<li>${r.text}</li>`).join('') +
      R.QUAL_ORDER.filter(q => state.settings.qualMin[q] > 0).map(q => `<li>mind. ${state.settings.qualMin[q]} ${R.QUALS[q].label} anwesend</li>`).join('') +
      '<li>Geprüft wird jeder Arbeitstag im Zeitraum anhand der dann anwesenden Personen.</li>' +
      '<li>Vertretungen (Spalte „Vertritt“ bei den Personen) werden automatisch eingesetzt, wenn nötig. ' +
      'Wer vertritt, fehlt an diesem Tag in seiner eigenen Stelle.</li>';
    renderPersons();
    renderVacations();
    renderCalendar();
  }
  renderAll();
})();
