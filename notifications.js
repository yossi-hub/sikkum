/* Notifications de l'application : Airtable reste la source, le rapport existant
 * reste responsable du contrôle des présences. Aucun nouveau contrôle planifié.
 */
(function (root, factory) {
  const feature = factory();
  if (typeof module === 'object' && module.exports) module.exports = feature;
  else root.LaviNotifications = feature;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const TABLE_NOTIFICATIONS = 'tblSGA8alJE5Reev4';
  const TABLE_CANDIDATURES = 'tbl6TtLej3NuJX3ea';
  const TABLE_HISTORY = 'tblaMErXMYZkVpyRD';
  const N = {
    key: 'fldgIP5cNkEC8zT9E', teacher: 'fld7IGRMcTaWT1K7U',
    type: 'fld7tFpIv13V9b9pe', source: 'fldMrlkJ2iPyDsD53',
    title: 'fldFYuRY1VXbVVSBA', detail: 'fldjy2TQ1RkBriSi3',
    data: 'fldTqnZpcpjdtzm9P', date: 'fldg3xnhx7w7iYEg1',
    read: 'fldFQ1qb22wDIO14z', closed: 'fldkHzcfha3sSQdmg'
  };
  const C = {
    name: 'fldtsbmrCSmGqC4Hb', key: 'fld2Fcn3KYiZ0R27B',
    absence: 'fld6TmPyz5al6IbPf', teacher: 'fldp7tNexDn8rkZfu',
    email: 'fldL1PtYw5CCcK7WH', classNum: 'fldLUacaxlz2SJQwC',
    date: 'fld6cMZZ9VJfMPqJB', hours: 'fldNZ5dy8hFX05C25',
    link: 'fldNu6pqmnKeXh4ty'
  };
  const H = {
    key: 'fldfMRaqWZFEMv36M', classNum: 'fldd6JfbXm1gYJF4f',
    date: 'fld1AFy3hw88o9wqN', name: 'fldXcijGPH04eNHrD',
    email: 'fldb1c0Hdm3lSrcxb', status: 'fldxjugPzel0mwARs',
    checked: 'fldBGRzkvTan14aPW', resolved: 'fldqLE6Jp3weuAj4F'
  };
  const ABS_REPLACEMENT = 'fldpe4Y3zKJQCrMrK';
  const REFRESH_MS = 5 * 60 * 1000;
  const parisClock = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  let generation = 0;
  let model = emptyModel();
  let pending = null;
  let interval = null;
  let listening = false;
  let opener = null;
  let selectedKey = null;
  let teacherCache = null;
  let actionMessage = '';
  const applying = new Set();
  const locallySaved = new Set();
  const locallySavedCourses = new Set();

  function emptyModel() {
    return {
      teacherId: null, items: [], offers: new Map(), openIds: new Set(),
      applications: new Set(), reports: [], classInfo: new Map(),
      courseSignature: '', refreshed: 0, error: '', loaded: false
    };
  }
  function textValue(value) {
    if (Array.isArray(value)) return value.map(textValue).join(', ');
    if (value && typeof value === 'object') return String(value.name || value.value || '');
    return String(value == null ? '' : value);
  }
  function norm(value) { return textValue(value).trim().toLowerCase(); }
  function html(value) {
    return textValue(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formulaString(value) { return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function query(fields, formula, view, fieldIds = true) {
    const p = new URLSearchParams({ returnFieldsByFieldId: String(fieldIds) });
    for (const field of fields) p.append('fields[]', field);
    if (formula) p.set('filterByFormula', formula);
    if (view) p.set('view', view);
    return '?' + p.toString();
  }
  function parisParts(now) {
    return Object.fromEntries(parisClock.formatToParts(now || new Date()).filter(function (p) {
      return p.type !== 'literal';
    }).map(function (p) { return [p.type, p.value]; }));
  }
  function parisDate(now) {
    const p = parisParts(now);
    return p.year + '-' + p.month + '-' + p.day;
  }
  function addDays(date, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
    const d = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) return '';
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function dueInstant(date) {
    const due = addDays(date, 2);
    if (!due) return '';
    const guess = new Date(due + 'T09:00:00Z');
    const p = parisParts(guess);
    const localAsUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(guess.getTime() * 2 - localAsUTC).toISOString();
  }
  function reportDue(fields, now) {
    const due = addDays(textValue(fields[H.date]), 2);
    if (!due || textValue(fields[H.status]) !== 'Manquante' || fields[H.resolved]) return false;
    // Le rapport doit avoir effectivement contrôlé la séance à J+2 ou après.
    if (textValue(fields[H.checked]).slice(0, 10) < due) return false;
    const p = parisParts(now);
    const today = p.year + '-' + p.month + '-' + p.day;
    return today > due || (today === due && +p.hour >= 9);
  }
  function responsibleTeacher(report, teachers, absences, classInfo) {
    const f = report.fields;
    const replacements = new Set();
    for (const absence of absences) {
      const a = absence.fields;
      const sameClass = (a[FLD_ABS_CLASSE] || []).some(function (id) {
        return String((classInfo.get(id) || {}).num) === textValue(f[H.classNum]).trim();
      });
      if (sameClass && textValue(a[FLD_ABS_DATE]).slice(0, 10) === f[H.date]) {
        for (const id of a[ABS_REPLACEMENT] || []) replacements.add(id);
      }
    }
    if (replacements.size) return replacements.size === 1 ? Array.from(replacements)[0] : null;
    const email = norm(f[H.email]);
    const matches = teachers.filter(function (teacher) {
      return email ? norm(teacher.fields.Email) === email : norm(teacher.fields.Name) === norm(f[H.name]);
    });
    // Les noms ambigus ne donnent jamais lieu à un rappel au mauvais compte.
    return matches.length === 1 ? matches[0].id : null;
  }
  function fromRecord(record) {
    const f = record.fields;
    let data = {};
    try { data = JSON.parse(f[N.data] || '{}'); } catch (_) { /* ancien enregistrement illisible */ }
    return {
      id: record.id, key: f[N.key], type: f[N.type], source: f[N.source],
      title: f[N.title] || '', detail: f[N.detail] || '', data: data,
      date: f[N.date] || record.createdTime || '', readAt: f[N.read] || '',
      closedAt: f[N.closed] || '', status: ''
    };
  }
  function unread(item) { return !item.readAt && !item.closedAt; }
  function current(capture) {
    return capture.generation === generation && state.teacher && state.teacher.id === capture.teacher.id;
  }
  function captureSession() {
    return { generation: generation, teacher: Object.assign({}, state.teacher) };
  }
  function headerHtml() {
    return '<button type="button" class="notifications-bell" id="notifications-bell" ' +
      'aria-label="עדכונים" aria-haspopup="dialog" aria-expanded="false" onclick="LaviNotifications.toggle()">' +
      '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>' +
      '<path d="M10 21h4"/></svg><span id="notifications-dot" class="notifications-dot" hidden></span></button>';
  }
  function updateBell() {
    const button = document.getElementById('notifications-bell');
    const dot = document.getElementById('notifications-dot');
    const hasUnread = model.items.some(unread);
    if (dot) dot.hidden = !hasUnread;
    if (button) button.setAttribute('aria-label', hasUnread ? 'עדכונים — יש עדכונים שלא נקראו' : 'עדכונים');
  }
  function start() {
    if (!listening) {
      listening = true;
      window.addEventListener('focus', function () {
        if (state.teacher) refresh().catch(function () {});
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && state.teacher) refresh().catch(function () {});
      });
    }
    if (!interval) interval = setInterval(function () {
      if (!document.hidden && state.teacher) refresh().catch(function () {});
    }, REFRESH_MS);
    updateBell();
  }
  function reset() {
    generation++;
    if (interval) clearInterval(interval);
    interval = null;
    pending = null;
    model = emptyModel();
    teacherCache = null;
    actionMessage = '';
    selectedKey = null;
    applying.clear();
    locallySaved.clear();
    locallySavedCourses.clear();
    const d = document.getElementById('notifications-dialog');
    if (d && d.open) d.close();
    if (d) d.remove();
  }
  async function upsert(table, keyField, records, capture) {
    const saved = [];
    for (let i = 0; i < records.length; i += 10) {
      if (!current(capture)) return saved;
      const result = await api(BASE_COURS, table, '', 'PATCH', {
        performUpsert: { fieldsToMergeOn: [keyField] },
        records: records.slice(i, i + 10), returnFieldsByFieldId: true
      });
      saved.push.apply(saved, result.records || []);
    }
    return saved;
  }
  async function refresh(force) {
    if (!state.teacher) return;
    if (pending) return pending;
    if (!force && model.loaded && Date.now() - model.refreshed < REFRESH_MS) {
      updateBell();
      renderProposals();
      return;
    }
    const capture = captureSession();
    const task = load(capture).catch(function (error) {
      if (current(capture)) {
        model.error = 'לא ניתן לטעון את העדכונים כרגע. אפשר לנסות שוב.';
        renderDialog();
        renderProposals();
      }
      // Ne pas afficher les réponses Airtable qui peuvent contenir des données privées.
      console.warn('Notifications: actualisation impossible', error && error.name || 'Erreur');
    });
    pending = task;
    try { await task; } finally { if (pending === task) pending = null; }
  }
  async function load(capture) {
    const teacher = capture.teacher;
    const absFields = [FLD_ABS_DATE, FLD_ABS_CLASSE, FLD_ABS_TEACHER, ABS_REPLACEMENT];
    const prefix = teacher.id + '|';
    const results = await Promise.all([
      getAll(BASE_COURS, TABLE_NOTIFICATIONS, query(Object.values(N),
        'LEFT({' + N.key + '},' + prefix.length + ')=' + formulaString(prefix))),
      getAll(BASE_COURS, TABLE_ABSENCES, query(absFields, '', VIEW_REMPLACEMENT)),
      getAll(BASE_COURS, TABLE_HISTORY, query(Object.values(H))),
      getAll(BASE_COURS, TABLE_CANDIDATURES, query(Object.values(C),
        '{' + C.email + '}=' + formulaString(norm(teacher.email)))),
      getAll(BASE_COURS, TABLE_ABSENCES, query(absFields)),
      teacherCache ? Promise.resolve(teacherCache) :
        getAll(BASE_COURS, TABLE_TEACHERS, '?fields%5B%5D=Name&fields%5B%5D=Email'),
      (teacher.classIds || []).length ? getAll(BASE_COURS, TABLE_RAPPORTS,
        query(['fld5pPY7sfAzWNFJB', 'fldv20CiFCcpI5D0a'], '{Prof}=' + formulaString(teacher.name))) : Promise.resolve([])
    ]);
    if (!current(capture)) return;
    const [stored, visible, reports, applications, absences, teachers, courseReports] = results;
    teacherCache = teachers;
    const classIds = Array.from(new Set((teacher.classIds || []).concat(absences.concat(visible).flatMap(function (r) {
      return r.fields[FLD_ABS_CLASSE] || [];
    }))));
    const info = new Map();
    const courseClasses = new Map();
    const lieux = await loadLieuxMap();
    for (let i = 0; i < classIds.length; i += 20) {
      if (!current(capture)) return;
      const formula = 'OR(' + classIds.slice(i, i + 20).map(function (id) {
        return 'RECORD_ID()=' + formulaString(id);
      }).join(',') + ')';
      const records = await getAll(BASE_COURS, TABLE_CLASSES, query([
        FLD_CL_NUM, FLD_CL_CHAPITRE, FLD_CL_JOUR_TEXT, FLD_CL_HORAIRES, FLD_CL_ENDROIT,
        FLD_CL_STATUS, FLD_CL_STUDENTS
      ], formula));
      for (const r of records) {
        const f = r.fields;
        info.set(r.id, {
          classId: r.id, num: textValue(f[FLD_CL_NUM]), chapitre: textValue(f[FLD_CL_CHAPITRE]),
          jour: textValue(f[FLD_CL_JOUR_TEXT]), horaires: textValue(f[FLD_CL_HORAIRES]),
          endroit: (f[FLD_CL_ENDROIT] || []).map(function (id) { return lieux[id] || ''; }).filter(Boolean).join(', ')
        });
        courseClasses.set(r.id, {
          classId: r.id, num: textValue(f[FLD_CL_NUM]),
          status: textValue(f[FLD_CL_STATUS]), studentIds: f[FLD_CL_STUDENTS] || []
        });
      }
    }
    if (!current(capture)) return;
    const ownClasses = (teacher.classIds || []).map(function (id) { return courseClasses.get(id); }).filter(Boolean);
    const sentCourseIds = new Set(ownClasses.filter(function (cls) {
      return locallySavedCourses.has(cls.classId) || courseReportIsSent(cls, courseReports.filter(function (r) {
        return textValue(r.fields.fld5pPY7sfAzWNFJB).trim() === cls.num.trim();
      }));
    }).map(function (cls) { return cls.classId; }));
    const pendingCourses = ownClasses.filter(function (cls) {
      return cls.status === 'Complete' && !sentCourseIds.has(cls.classId);
    });
    const courseSignature = JSON.stringify(ownClasses.map(function (cls) {
      return [cls.classId, cls.num, cls.status, cls.studentIds, sentCourseIds.has(cls.classId)];
    }));
    const now = new Date();
    const today = parisDate(now);
    const openIds = new Set(visible.filter(function (r) {
      return r.fields[FLD_ABS_DATE] >= today && !(r.fields[ABS_REPLACEMENT] || []).length;
    }).map(function (r) { return r.id; }));
    const offers = new Map(absences.concat(visible).map(function (r) {
      const f = r.fields;
      const classId = (f[FLD_ABS_CLASSE] || [])[0];
      return [r.id, Object.assign({}, info.get(classId) || {}, {
        id: r.id, classId: classId, date: f[FLD_ABS_DATE] || '',
        assigned: (f[ABS_REPLACEMENT] || []).length > 0,
        teacherIds: f[FLD_ABS_TEACHER] || [], createdTime: r.createdTime
      })];
    }));
    const items = new Map();
    for (const r of stored) {
      if (!(r.fields[N.teacher] || []).includes(teacher.id)) continue;
      const item = fromRecord(r);
      // Lecture monotone même si deux onglets ont chargé avant le clic.
      const local = model.items.find(function (n) { return n.key === item.key; });
      if (local) {
        item.readAt = item.readAt || local.readAt;
        item.closedAt = item.closedAt || local.closedAt;
      }
      const prior = items.get(item.key);
      if (prior) {
        prior.readAt = prior.readAt || item.readAt;
        prior.closedAt = prior.closedAt || item.closedAt;
      } else items.set(item.key, item);
    }
    const toCreate = [];
    function addItem(item) {
      if (items.has(item.key)) return;
      items.set(item.key, item);
      toCreate.push({ fields: {
        [N.key]: item.key, [N.teacher]: [teacher.id], [N.type]: item.type,
        [N.source]: item.source, [N.title]: item.title, [N.detail]: item.detail,
        [N.data]: JSON.stringify(item.data), [N.date]: item.date
      } });
    }
    for (const id of openIds) {
      const offer = offers.get(id);
      if (!offer || !offer.num) continue;
      addItem({
        key: prefix + 'remplacement|' + id, type: 'remplacement', source: id,
        title: 'אפשרות חדשה להחלפה — כיתה ' + offer.num,
        detail: offerDetail(offer), data: offer,
        date: offer.createdTime || now.toISOString(), readAt: '', closedAt: ''
      });
    }
    for (const report of reports) {
      const f = report.fields;
      if (!reportDue(f, now) || responsibleTeacher(report, teachers, absences, info) !== teacher.id) continue;
      const source = textValue(f[H.classNum]).trim() + '_' + f[H.date];
      if (locallySaved.has(source)) continue;
      addItem({
        key: prefix + 'presence|' + source, type: 'presence', source: source,
        title: 'תזכורת למילוי נוכחות — כיתה ' + textValue(f[H.classNum]),
        detail: 'טרם הושלמה נוכחות לשיעור בתאריך ' + formatFrDate(f[H.date]),
        data: { classNum: textValue(f[H.classNum]).trim(), date: f[H.date], reportId: report.id },
        date: dueInstant(f[H.date]), readAt: '', closedAt: ''
      });
    }
    for (const cls of pendingCourses) {
      addItem({
        key: prefix + 'sikkum|' + cls.classId, type: 'sikkum', source: cls.classId,
        title: 'כיתה ' + cls.num + ' הסתיימה — יש למלא דוח סיום קורס',
        detail: 'דוח סיום הקורס ממתין למילוי עבור כיתה ' + cls.num,
        data: { classId: cls.classId, classNum: cls.num },
        date: now.toISOString(), readAt: '', closedAt: ''
      });
    }
    const created = await upsert(TABLE_NOTIFICATIONS, N.key, toCreate, capture);
    if (!current(capture)) return;
    for (const r of created) items.set(r.fields[N.key], fromRecord(r));
    const toClose = [];
    for (const item of items.values()) {
      let closed = false;
      if (item.type === 'remplacement') {
        const offer = offers.get(item.source);
        if (offer) item.data = offer;
        item.detail = offerDetail(item.data);
        item.status = offer && offer.assigned ? 'השיעור כבר אויש' :
          !openIds.has(item.source) ? 'ההצעה אינה זמינה עוד' : '';
        closed = !openIds.has(item.source);
      } else if (item.type === 'sikkum') {
        const cls = ownClasses.find(function (c) { return c.classId === item.source; });
        if (sentCourseIds.has(item.source) || locallySavedCourses.has(item.source)) item.status = 'דוח סיום הקורס נשלח';
        else if (!cls || cls.status !== 'Complete') item.status = 'התזכורת אינה פעילה עוד';
        closed = !!item.status;
      } else if (item.type === 'presence') {
        if (locallySaved.has(item.source)) item.status = 'הנוכחות הושלמה';
        const report = reports.find(function (r) {
          return textValue(r.fields[H.classNum]).trim() + '_' + r.fields[H.date] === item.source;
        });
        if (item.status) { /* sauvegarde de cette séance dans l'application */ }
        else if (report) {
          const status = textValue(report.fields[H.status]);
          if (status === 'Saisie' || report.fields[H.resolved]) item.status = 'הנוכחות הושלמה';
          else if (status !== 'Manquante' || responsibleTeacher(report, teachers, absences, info) !== teacher.id) {
            item.status = 'התזכורת אינה פעילה עוד';
          }
        } else item.status = 'התזכורת אינה פעילה עוד';
        closed = !!item.status;
      }
      if (closed && !item.closedAt && item.id) {
        item.closedAt = now.toISOString();
        toClose.push({ id: item.id, fields: { [N.closed]: item.closedAt } });
      }
      if (item.closedAt && !item.status) item.status = item.type === 'remplacement' ?
        'ההצעה אינה זמינה עוד' : 'התזכורת נסגרה';
    }
    for (let i = 0; i < toClose.length; i += 10) {
      if (!current(capture)) return;
      await api(BASE_COURS, TABLE_NOTIFICATIONS, '', 'PATCH', { records: toClose.slice(i, i + 10) });
    }
    if (!current(capture)) return;
    for (const item of items.values()) {
      const local = model.items.find(function (n) { return n.key === item.key; });
      if (local) {
        item.readAt = item.readAt || local.readAt;
        item.closedAt = item.closedAt || local.closedAt;
        item.status = item.status || local.status;
      }
    }
    const coursesChanged = model.courseSignature && model.courseSignature !== courseSignature;
    model = {
      teacherId: teacher.id, items: Array.from(items.values()).sort(function (a, b) {
        return b.date.localeCompare(a.date);
      }),
      offers: offers, openIds: openIds,
      applications: new Set(applications.flatMap(function (r) {
        return (r.fields[C.teacher] || []).includes(teacher.id) ? r.fields[C.absence] || [] : [];
      })),
      reports: reports, classInfo: info, courseSignature: courseSignature,
      refreshed: Date.now(), error: '', loaded: true
    };
    pendingCourseReportIds = new Set(pendingCourses.filter(function (cls) {
      return !locallySavedCourses.has(cls.classId);
    }).map(function (cls) { return cls.classId; }));
    updateCourseReportIndicators();
    if (coursesChanged) invalidateCourseReportClasses();
    updateBell();
    renderDialog();
    renderProposals();
  }
  function offerDetail(offer) {
    return [formatFrDate(offer.date), offer.jour, offer.horaires, offer.endroit,
      offer.chapitre ? 'פרק נוכחי: ' + offer.chapitre : ''].filter(Boolean).join(' · ');
  }
  function offerButton(offer) {
    let label = 'אני פנוי/ה להחלפה', disabled = false;
    if (!model.openIds.has(offer.id) || offer.assigned) { label = 'השיעור כבר אויש'; disabled = true; }
    else if (model.applications.has(offer.id)) { label = 'המועמדות נשלחה ✓'; disabled = true; }
    else if (applying.has(offer.id)) { label = 'שומר…'; disabled = true; }
    else if (model.error) { label = 'יש לרענן לפני שליחת מועמדות'; disabled = true; }
    else if ((offer.teacherIds || []).includes(state.teacher.id)) { label = 'היעדרות שלך'; disabled = true; }
    return '<button type="button" class="notification-apply" data-apply-offer="' + html(offer.id) +
      '" onclick="LaviNotifications.apply(this.dataset.applyOffer)"' + (disabled ? ' disabled' : '') +
      '>' + label + '</button>';
  }
  function renderProposals() {
    const container = document.getElementById('remplacement-proposals');
    if (!container || !state.teacher) return;
    if (!model.loaded) {
      container.innerHTML = model.error ? '<div class="notification-error">' + html(model.error) +
        ' <button class="btn-ghost" onclick="LaviNotifications.refresh(true)">ניסיון נוסף</button></div>' :
        '<div class="loading" style="padding:1rem;">טוען הצעות להחלפה…</div>';
      return;
    }
    const offers = Array.from(model.offers.values()).filter(function (o) {
      return model.openIds.has(o.id) && o.num;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    container.innerHTML = (model.error || actionMessage ? '<div class="notification-error" role="status">' +
      html(model.error || actionMessage) + '</div>' : '') +
      (offers.length ? '<div class="remplacement-props"><div class="remplacement-props-title">🔄 הצעות להחלפת שיעורים</div>' +
        '<div class="remplacement-props-list">' + offers.map(function (offer) {
          return '<div class="remplacement-prop-card"><div class="remplacement-prop-head"><span>כיתה ' +
            html(offer.num) + '</span><span class="remplacement-prop-date">' + html(formatFrDate(offer.date)) +
            '</span></div><div class="remplacement-prop-body">' + html(offerDetail(offer)) +
            '</div>' + offerButton(offer) + '</div>';
        }).join('') + '</div></div>' : '');
  }
  function ensureDialog() {
    let dialog = document.getElementById('notifications-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'notifications-dialog';
    dialog.className = 'notifications-dialog';
    dialog.setAttribute('aria-labelledby', 'notifications-title');
    dialog.setAttribute('dir', 'rtl');
    dialog.innerHTML = '<div class="notifications-heading"><h2 id="notifications-title">עדכונים</h2>' +
      '<button type="button" class="notification-close" aria-label="סגירה" onclick="LaviNotifications.close()">×</button></div>' +
      '<div id="notifications-content"></div><div id="notifications-message" class="notification-error" role="status"></div>';
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) { close(); return; }
      const button = e.target.closest('[data-notification-key]');
      if (button) openItem(button.dataset.notificationKey);
    });
    dialog.addEventListener('close', function () {
      const bell = document.getElementById('notifications-bell');
      if (bell) bell.setAttribute('aria-expanded', 'false');
      if (opener && opener.isConnected) opener.focus();
    });
    document.body.appendChild(dialog);
    return dialog;
  }
  async function toggle() {
    const dialog = ensureDialog();
    if (dialog.open) { close(); return; }
    opener = document.activeElement;
    selectedKey = null;
    renderDialog();
    dialog.showModal();
    document.getElementById('notifications-bell').setAttribute('aria-expanded', 'true');
    await refresh(true);
  }
  function close() {
    const dialog = document.getElementById('notifications-dialog');
    if (dialog && dialog.open) dialog.close();
  }
  function renderDialog() {
    const container = document.getElementById('notifications-content');
    if (!container) return;
    if (selectedKey) {
      const item = model.items.find(function (n) { return n.key === selectedKey; });
      if (item) {
        container.innerHTML = '<button type="button" class="btn-ghost notification-back" onclick="LaviNotifications.back()">← לכל העדכונים</button>' +
          '<div class="notification-detail"><h3>' + html(item.title) + '</h3><p>' + html(item.detail) + '</p>' +
          (item.status ? '<span class="notification-status">' + html(item.status) + '</span>' : '') +
          (item.type === 'remplacement' && item.data.id ? offerButton(item.data) : '') + '</div>';
        showMessage(model.error || actionMessage);
        return;
      }
    }
    container.innerHTML = !model.loaded && !model.error ? '<div class="loading">טוען עדכונים…</div>' :
      model.items.length ? '<div class="notifications-list">' + model.items.map(function (item) {
        return '<button type="button" class="notification-item' + (unread(item) ? ' is-unread' : '') +
          '" data-notification-key="' + html(item.key) + '"><span class="notification-item-title">' +
          (unread(item) ? '<span class="notification-unread" aria-label="לא נקראה"></span>' : '') +
          html(item.title) + '</span><span class="notification-item-detail">' + html(item.detail) +
          '</span>' + (item.status ? '<span class="notification-status">' + html(item.status) + '</span>' : '') +
          '</button>';
      }).join('') + '</div>' : '<div class="notification-empty">אין עדכונים כרגע</div>';
    showMessage(model.error || actionMessage);
  }
  function back() { selectedKey = null; renderDialog(); }
  function showMessage(message) {
    const element = document.getElementById('notifications-message');
    if (element) element.textContent = message || '';
  }
  async function openItem(key) {
    const capture = captureSession();
    const item = model.items.find(function (n) { return n.key === key; });
    if (!item || !item.id) return;
    selectedKey = key;
    try {
      if (!item.readAt) {
        const readAt = new Date().toISOString();
        await api(BASE_COURS, TABLE_NOTIFICATIONS, '/' + item.id, 'PATCH', { fields: { [N.read]: readAt } });
        if (!current(capture)) return;
        item.readAt = readAt;
      }
      updateBell();
      if (item.type === 'presence' && !item.closedAt) {
        await openAttendance(item, capture);
      } else if (item.type === 'sikkum') {
        await openCourseReport(item, capture);
      } else {
        renderDialog();
        await refresh(true); // une ancienne proposition peut être pourvue entre-temps
      }
    } catch (_) {
      if (current(capture)) {
        renderDialog();
        showMessage('לא ניתן לפתוח את העדכון כרגע. אפשר לנסות שוב.');
      }
    }
  }
  async function openCourseReport(item, capture) {
    if (hiddenTabsSet.has('sikkum')) {
      renderDialog();
      showMessage('לשונית דוח סיום הקורס אינה זמינה כרגע. יש לפנות להנהלה.');
      return;
    }
    // Relire le statut avant de proposer le bilan, même avec un cache déjà chargé.
    classesPromise = null;
    const loaded = await prefetchClasses();
    if (!current(capture)) return;
    if (!loaded) throw new Error('Chargement des classes impossible');
    const cls = sikkumClasses().find(function (c) { return c.id === item.source; });
    if (!cls) {
      await refresh(true);
      if (current(capture)) showMessage('הכיתה אינה ממתינה כרגע לדוח סיום קורס.');
      return;
    }
    classesLoaded = true;
    renderSikkumTab();
    renderPresenceTab();
    showTabs();
    activateTabUI('sikkum');
    close();
    const block = document.getElementById('block-' + cls.id);
    if (block) {
      block.classList.add('open');
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  async function openAttendance(item, capture) {
    if (hiddenTabsSet.has('presence')) {
      renderDialog();
      showMessage('לשונית הנוכחות אינה זמינה כרגע. יש לפנות להנהלה.');
      return;
    }
    const loaded = await prefetchClasses();
    if (!current(capture)) return;
    if (!loaded) throw new Error('Chargement des classes impossible');
    if (!classesLoaded) {
      classesLoaded = true;
      renderSikkumTab();
      renderPresenceTab();
    }
    showTabs();
    switchTab('presence');
    if (!current(capture)) return;
    const own = state.classes.find(function (cls) { return String(cls.num) === item.data.classNum; });
    const dateInput = own && document.getElementById('pres-date-' + own.id);
    if (dateInput) {
      dateInput.value = item.data.date;
      document.getElementById('presblock-' + own.id).classList.add('open');
      await loadAndRenderPresenceChecklist(own.id, item.data.date);
      if (!current(capture)) return;
      close();
      document.getElementById('presblock-' + own.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Les remplaçants (et les anciennes classes terminées) utilisent le formulaire existant.
      const found = await api(BASE_COURS, TABLE_CLASSES, query(['Numéro de Classe', 'Teacher en texte'],
        '{Numéro de Classe}=' + formulaString(item.data.classNum), undefined, false));
      if (!current(capture)) return;
      if ((found.records || []).length !== 1) throw new Error('Classe introuvable');
      const cls = found.records[0];
      allClassesLight = (allClassesLight || []).filter(function (r) { return r.id !== cls.id; });
      allClassesLight.push({ id: cls.id, num: item.data.classNum, teacher: cls.fields['Teacher en texte'] || '' });
      await selectRemplacementClass(cls.id, item.data.date);
      if (!current(capture)) return;
      close();
      document.getElementById('remplacement-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  async function apply(id) {
    if (!/^rec[A-Za-z0-9]{14}$/.test(id || '') || applying.has(id) || !state.teacher) return;
    const capture = captureSession();
    if (model.applications.has(id)) return;
    actionMessage = '';
    applying.add(id);
    renderProposals();
    renderDialog();
    try {
      // Relecture de la vue et du remplacement avant chaque candidature.
      const [visible, record] = await Promise.all([
        getAll(BASE_COURS, TABLE_ABSENCES, query([FLD_ABS_DATE], '', VIEW_REMPLACEMENT)),
        api(BASE_COURS, TABLE_ABSENCES, '/' + id + '?returnFieldsByFieldId=true')
      ]);
      if (!current(capture)) return;
      const f = record.fields;
      if (!visible.some(function (r) { return r.id === id; }) ||
          (f[ABS_REPLACEMENT] || []).length || f[FLD_ABS_DATE] < parisDate() ||
          (f[FLD_ABS_TEACHER] || []).includes(capture.teacher.id)) {
        await refresh(true);
        if (current(capture)) actionMessage = 'ההצעה אינה זמינה למועמדות. הרשימה עודכנה.';
        return;
      }
      const offer = model.offers.get(id);
      if (!offer || !offer.num) throw new Error('Informations de classe absentes');
      const key = id + '|' + capture.teacher.id;
      const existing = await getAll(BASE_COURS, TABLE_CANDIDATURES,
        query([C.key], '{' + C.key + '}=' + formulaString(key)));
      if (!current(capture)) return;
      if (!existing.length) {
        await upsert(TABLE_CANDIDATURES, C.key, [{ fields: {
          [C.key]: key, [C.name]: capture.teacher.name, [C.absence]: [id],
          [C.teacher]: [capture.teacher.id], [C.email]: norm(capture.teacher.email),
          [C.classNum]: offer.num, [C.date]: f[FLD_ABS_DATE], [C.hours]: offer.horaires || '',
          [C.link]: 'https://airtable.com/' + BASE_COURS + '/' + TABLE_ABSENCES + '/' + id
        } }], capture);
      }
      if (!current(capture)) return;
      model.applications.add(id);
      actionMessage = 'המועמדות נשלחה.';
    } catch (_) {
      if (current(capture)) actionMessage = 'לא ניתן לאשר שהמועמדות נשמרה. יש לרענן ולבדוק לפני ניסיון נוסף.';
    } finally {
      if (current(capture)) {
        applying.delete(id);
        renderProposals();
        renderDialog();
      }
    }
  }
  async function presenceSaved(classNum, date) {
    if (!state.teacher) return;
    const capture = captureSession();
    const source = String(classNum).trim() + '_' + date;
    locallySaved.add(source);
    const affected = model.items.filter(function (n) {
      return n.type === 'presence' && n.source === source && !n.closedAt;
    });
    const stamp = new Date().toISOString();
    for (const item of affected) {
      item.closedAt = stamp;
      item.status = 'הנוכחות הושלמה';
    }
    updateBell();
    renderDialog();
    // Ne pas modifier l'historique du rapport ni ses statuts d'e-mail.
    try {
      for (const item of affected) {
        if (!current(capture)) return;
        if (item.id) await api(BASE_COURS, TABLE_NOTIFICATIONS, '/' + item.id, 'PATCH',
          { fields: { [N.closed]: stamp } });
      }
    } catch (_) {
      if (current(capture)) showMessage('הנוכחות נשמרה. מצב התזכורת יתעדכן בבדיקה הבאה.');
    }
  }
  async function courseReportSaved(classId) {
    if (!state.teacher) return;
    const capture = captureSession();
    locallySavedCourses.add(classId);
    pendingCourseReportIds.delete(classId);
    updateCourseReportIndicators();
    const stamp = new Date().toISOString();
    const affected = model.items.filter(function (item) {
      return item.type === 'sikkum' && item.source === classId && !item.closedAt;
    });
    for (const item of affected) {
      item.closedAt = stamp;
      item.status = 'דוח סיום הקורס נשלח';
    }
    updateBell();
    renderDialog();
    try {
      for (const item of affected) {
        if (!current(capture)) return;
        if (item.id) await api(BASE_COURS, TABLE_NOTIFICATIONS, '/' + item.id, 'PATCH',
          { fields: { [N.closed]: stamp } });
      }
    } catch (_) {
      if (current(capture)) showMessage('הדוח נשמר. מצב התזכורת יתעדכן בבדיקה הבאה.');
    }
  }
  return {
    headerHtml: headerHtml, start: start, reset: reset, refresh: refresh,
    renderProposals: renderProposals, toggle: toggle, close: close, back: back,
    apply: apply, presenceSaved: presenceSaved, courseReportSaved: courseReportSaved,
    // Fonctions pures exposées pour tester les règles sans accéder aux bases.
    rules: { parisDate: parisDate, addDays: addDays, dueInstant: dueInstant,
      reportDue: reportDue, responsibleTeacher: responsibleTeacher, unread: unread,
      html: html, N: N, C: C, H: H, ABS_REPLACEMENT: ABS_REPLACEMENT }
  };
});
