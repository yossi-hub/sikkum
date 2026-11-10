const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, F } = require('./notifications-fixture.cjs');
const { suggestedAttendanceDate: suggest } = require('../notifications.js').rules;

function setup(jour = 'יום שלישי', now = '2026-11-05T10:00:00Z') {
  const backend = makeBackend();
  backend.alice.fields['Classes 5786'] = [backend.classId];
  backend.data[F.classes][0].fields[F.day] = jour;
  const app = loadApp(backend, backend.alice, now);
  app.feature.start();
  const el = name => app.document.getElementById(name + '-' + backend.classId);
  return { backend, app, el };
}

function attendance(backend, date, chapter, present = true, id = 'recAttendance') {
  return { id, fields: {
    [F.pClass]: '101', [F.pDate]: date + 'T12:00:00.000Z',
    [F.pStudent]: backend.data[F.classes][0].fields[F.classStudents],
    [F.pPresent]: present, [F.pChapter]: chapter,
    [F.pLesson]: 'Séance du ' + date, [F.pMotif]: present ? '' : 'Malade'
  } };
}

test('le jour du cours propose aujourd’hui, sinon la dernière séance prévue', () => {
  assert.equal(suggest('יום שלישי', '2026-11-03'), '2026-11-03');
  assert.equal(suggest('יום שלישי', '2026-11-04'), '2026-11-03');
  assert.equal(suggest('Mardi', '2026-11-02'), '2026-10-27');
  assert.equal(suggest('mardi et jeudi', '2026-11-04'), '2026-11-03');
  assert.equal(suggest('mardi et jeudi', '2026-11-05'), '2026-11-05');
  assert.equal(suggest('mardi et jeudi', '2026-11-08'), '2026-11-05');
});

test('les jours français, hébreux et anglais et les lookups sont reconnus', () => {
  const aliases = [
    ['Dimanche', 'יום ראשון', 'Sunday'], ['Lundi', 'יום שני', 'Monday'],
    ['Mardi', 'יום שלישי', 'Tuesday'], ['Mercredi', 'יום רביעי', 'Wednesday'],
    ['Jeudi', 'יום חמישי', 'Thursday'], ['Vendredi', 'יום ששי', 'Friday'],
    ['Samedi', 'שבת', 'Saturday']
  ];
  aliases.forEach((names, day) => names.forEach(name => {
    assert.equal(suggest(name, '2026-11-08'), '2026-11-' + String(day ? day + 1 : 8).padStart(2, '0'));
  }));
  assert.equal(suggest(['יום שני', 'יום רביעי'], '2026-11-05'), '2026-11-04');
  assert.equal(suggest([{ name: 'MARDI' }, { name: 'JEUDI' }], '2026-11-06'), '2026-11-05');
  assert.equal(suggest('יוֹם שְׁלִישִׁי', '2026-11-04'), '2026-11-03');
});

test('les limites calendaires et changements d’heure ne décalent pas la séance', () => {
  assert.equal(suggest('lundi', '2026-01-01'), '2025-12-29');
  assert.equal(suggest('jeudi', '2024-03-01'), '2024-02-29');
  assert.equal(suggest('vendredi', '2026-03-29'), '2026-03-27');
  assert.equal(suggest('vendredi', '2026-10-25'), '2026-10-23');
  assert.equal(suggest('', '2026-11-05'), '2026-11-05');
  assert.equal(suggest('à définir', '2026-11-05'), '2026-11-05');
  assert.equal(suggest('mardi', '2026-02-30'), '');
});

test('la séance proposée charge ses présences et son chapitre, sans reprendre ceux d’aujourd’hui', async () => {
  const { backend, app, el } = setup();
  backend.data[F.presence].push(
    attendance(backend, '2026-11-03', '4.2'),
    attendance(backend, '2026-11-05', '9.1', false, 'recToday'),
    { ...attendance(backend, '2026-11-03', '8.1', false, 'recOtherClass'), fields: {
      ...attendance(backend, '2026-11-03', '8.1').fields, [F.pClass]: '999'
    } }
  );
  await app.evaluate('prefetchClasses()');
  await app.evaluate('renderPresenceTab()');
  assert.equal(el('pres-date').value, '2026-11-03');
  assert.equal(el('pres-chapitre').value, '4.2');
  assert.equal(el('pres-lecon').value, 'Séance du 2026-11-03');
  assert.equal(el('pres-status').textContent, '✓ נרשם לתאריך זה');
  assert.equal(el('pres-btn').disabled, false);
  assert.match(el('pres-list').innerHTML, / checked/);
  assert.equal(app.evaluate(`Object.values(state.presenceCache['${backend.classId}'].existingMap)[0].recordId`), 'recAttendance');
});

test('au jour du cours, le formulaire conserve la date du jour', async () => {
  const { app, el } = setup('Mardi et jeudi');
  await app.evaluate('prefetchClasses()');
  await app.evaluate('renderPresenceTab()');
  assert.equal(el('pres-date').value, '2026-11-05');
  assert.equal(el('pres-chapitre').value, '');
  assert.equal(el('pres-btn').disabled, false);
});

test('la date reste modifiable et une date hors planning garde son avertissement', async () => {
  const { backend, app, el } = setup();
  backend.data[F.presence].push(attendance(backend, '2026-11-02', '3.1', false));
  await app.evaluate('prefetchClasses()');
  await app.evaluate('renderPresenceTab()');
  el('pres-date').value = '2026-11-02';
  await app.evaluate(`onPresenceDateChange('${backend.classId}')`);
  assert.equal(el('pres-date').value, '2026-11-02');
  assert.equal(el('pres-chapitre').value, '3.1');
  assert.equal(el('pres-date-warning').hidden, false);
  assert.match(el('pres-date-warning').textContent, /כדאי לבדוק/);
  assert.doesNotMatch(el('pres-list').innerHTML, / checked/);
});

test('une réponse tardive ne remplace pas les données de la date choisie ensuite', async () => {
  const { backend, app, el } = setup();
  backend.data[F.presence].push(
    attendance(backend, '2026-11-03', '4.2'),
    attendance(backend, '2026-11-02', '3.1', false, 'recMonday')
  );
  await app.evaluate('prefetchClasses()');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  app.context.__getAll = async (base, table, params) => {
    if (table === F.presence && decodeURIComponent(params).includes('2026-11-03')) await gate;
    return backend.getAll(base, table, params);
  };
  app.evaluate('getAll = __getAll;');
  const initial = app.evaluate('renderPresenceTab()');
  assert.equal(el('pres-btn').disabled, true);
  await app.evaluate(`submitPresence('${backend.classId}')`);
  assert.equal(backend.writes.length, 0);
  el('pres-date').value = '2026-11-02';
  await app.evaluate(`onPresenceDateChange('${backend.classId}')`);
  release();
  await initial;
  assert.equal(el('pres-date').value, '2026-11-02');
  assert.equal(el('pres-chapitre').value, '3.1');
  assert.equal(app.evaluate(`state.presenceCache['${backend.classId}'].dateStr`), '2026-11-02');
});

test('un échec de chargement bloque la sauvegarde et permet un nouvel essai', async () => {
  const { backend, app, el } = setup();
  await app.evaluate('prefetchClasses()');
  backend.failReads = true;
  await app.evaluate('renderPresenceTab()');
  assert.equal(el('pres-btn').disabled, true);
  assert.match(el('pres-error').innerHTML, /ניסיון נוסף/);
  await app.evaluate(`submitPresence('${backend.classId}')`);
  assert.equal(backend.writes.length, 0);
  backend.failReads = false;
  await app.evaluate(`onPresenceDateChange('${backend.classId}')`);
  assert.equal(el('pres-btn').disabled, false);
  assert.equal(el('pres-error').innerHTML, '');
});

test('la sauvegarde met à jour les enregistrements de la séance proposée et conserve sa date', async () => {
  const { backend, app, el } = setup();
  backend.data[F.presence].push(attendance(backend, '2026-11-03', '4.2'));
  await app.evaluate('prefetchClasses()');
  await app.evaluate('renderPresenceTab()');
  const sid = backend.data[F.classes][0].fields[F.classStudents][0];
  app.document.getElementById('pc-' + backend.classId + '-' + sid).checked = true;
  el('pres-chapitre').value = '4.3';
  await app.evaluate(`submitPresence('${backend.classId}')`);
  const writes = backend.writes.filter(write => write.table === F.presence);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].body.records[0].id, 'recAttendance');
  assert.equal(writes[0].body.records[0].fields[F.pDate], '2026-11-03T12:00:00.000Z');
  assert.equal(writes[0].body.records[0].fields[F.pChapter], '4.3');
  assert.equal(el('pres-date').value, '2026-11-03');
});

test('les remplacements proposent aussi la dernière séance, et une date explicite reste prioritaire', async () => {
  const { backend, app } = setup();
  app.document.getElementById('tab-presence').innerHTML = '<div id="remp-results"></div>';
  app.evaluate(`remplacementSelected = {id:'${backend.classId}',num:'101',teacher:'Beth',studentIds:[],jour:'Mardi'}; renderRemplacementConfirm();`);
  assert.equal(app.document.getElementById('remp-date').value, '2026-11-03');
  await app.evaluate('confirmRemplacement("2026-11-01")');
  assert.match(app.document.getElementById('remp-results').innerHTML, /2026-11-01/);
});

test('une réponse après déconnexion ne modifie pas le nouveau compte', async () => {
  const { backend, app } = setup();
  await app.evaluate('prefetchClasses()');
  let release;
  app.context.__getAll = async () => new Promise(resolve => { release = resolve; });
  app.evaluate('getAll = __getAll;');
  const loading = app.evaluate('renderPresenceTab()');
  app.evaluate('resetTeacherState()');
  release([]);
  await loading;
  assert.equal(app.evaluate('Object.keys(state.presenceCache).length'), 0);
  assert.equal(backend.writes.length, 0);
});
