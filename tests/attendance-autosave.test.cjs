const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, makeStorage, makeTimers, F, NOW } = require('./notifications-fixture.cjs');

async function setup(options = {}) {
  const backend = options.backend || makeBackend();
  const actor = options.actor || backend.alice;
  actor.fields['Classes 5786'] = [backend.classId];
  const storage = options.storage || makeStorage();
  const timers = options.timers || makeTimers();
  const app = loadApp(backend, actor, options.now || NOW, { storage, timers });
  app.evaluate('renderHeaderUser(state.teacher)');
  await app.evaluate('prefetchClasses()');
  await app.evaluate('renderPresenceTab()');
  const el = name => app.document.getElementById(name + '-' + backend.classId);
  const studentIds = backend.data[F.classes][0].fields[F.classStudents];
  // The shared fake DOM creates element IDs; browser input properties are set
  // explicitly so the tests exercise the same values a teacher edits.
  for (const sid of studentIds) {
    const checkbox = app.document.getElementById('pc-' + backend.classId + '-' + sid);
    if (typeof checkbox.checked !== 'boolean') checkbox.checked = false;
  }
  const edit = (chapter = '4.3', lesson = '') => {
    el('pres-chapitre').value = chapter;
    el('pres-lecon').value = lesson;
    app.document.getElementById('pc-' + backend.classId + '-' + studentIds[0]).checked = true;
    app.evaluate(`onPresenceEdited('${backend.classId}')`);
  };
  return { backend, storage, timers, app, el, studentIds, edit,
    storageKey: 'lavi_presence_drafts_v1:' + actor.id };
}

const SAVE_DELAY = 3 * 60 * 1000;

const presenceWrites = backend => backend.writes.filter(write => write.table === F.presence);
const draftText = fixture => fixture.storage.getItem(fixture.storageKey) || '';

test('ouvrir les présences ne crée rien et ne propose plus de bouton de sauvegarde', async () => {
  const { backend, timers, el } = await setup();
  await timers.advance(SAVE_DELAY + 1000);
  assert.equal(presenceWrites(backend).length, 0);
  assert.equal(el('pres-btn'), null);
});

test('chaque saisie est mémorisée immédiatement et repousse la synchronisation de trois minutes', async () => {
  const fixture = await setup();
  const { backend, timers, edit, el } = fixture;
  edit('4.3', 'Diapositive 12');
  assert.match(draftText(fixture), /4\.3/);
  assert.match(draftText(fixture), /Diapositive 12/);
  await timers.advance(SAVE_DELAY - 1);
  assert.equal(presenceWrites(backend).length, 0);
  edit('4.3', 'Diapositive 14');
  await timers.advance(SAVE_DELAY - 1);
  assert.equal(presenceWrites(backend).length, 0);
  await timers.advance(1);
  assert.equal(presenceWrites(backend).length, 1);
  const record = backend.data[F.presence][0];
  assert.equal(record.fields[F.pChapter], '4.3');
  assert.equal(record.fields[F.pLesson], 'Diapositive 14');
  assert.equal(record.fields[F.pPresent], true);
  assert.equal(el('pres-lecon').value, 'Diapositive 14');
});

test('un chapitre incomplet reste en mémoire sans être envoyé à Airtable', async () => {
  const fixture = await setup();
  fixture.edit('4.', 'À compléter');
  await fixture.timers.advance(SAVE_DELAY + 1000);
  assert.equal(presenceWrites(fixture.backend).length, 0);
  assert.match(draftText(fixture), /À compléter/);
  assert.notEqual(fixture.app.document.activeElement, fixture.el('pres-chapitre'));
});

test('les motifs des absences sont synchronisés avec la présence', async () => {
  const fixture = await setup();
  const { backend, app, timers, studentIds, el } = fixture;
  el('pres-chapitre').value = '4.3';
  app.document.getElementById('pc-' + backend.classId + '-' + studentIds[0]).checked = false;
  app.document.getElementById('pm-' + backend.classId + '-' + studentIds[0]).value = 'Malade';
  app.evaluate(`onPresenceEdited('${backend.classId}')`);
  await timers.advance(SAVE_DELAY);
  assert.equal(backend.data[F.presence][0].fields[F.pPresent], false);
  assert.equal(backend.data[F.presence][0].fields[F.pMotif], 'Malade');
});

test('un changement de date conserve chaque brouillon sous la date de sa séance', async () => {
  const fixture = await setup();
  const { backend, app, el, edit, timers, studentIds } = fixture;
  edit('4.3', 'Séance du mardi');
  el('pres-date').value = '2026-11-02';
  await app.evaluate(`onPresenceDateChange('${backend.classId}')`);
  edit('3.1', 'Séance du lundi');
  el('pres-date').value = '2026-11-03';
  await app.evaluate(`onPresenceDateChange('${backend.classId}')`);
  assert.equal(el('pres-chapitre').value, '4.3');
  assert.equal(el('pres-lecon').value, 'Séance du mardi');
  assert.equal(app.document.getElementById('pc-' + backend.classId + '-' + studentIds[0]).checked, true);
  await timers.advance(SAVE_DELAY);
  const sessions = Object.fromEntries(backend.data[F.presence].map(record => [
    record.fields[F.pDate].slice(0, 10), record.fields[F.pLesson]
  ]));
  assert.deepEqual(sessions, { '2026-11-03': 'Séance du mardi', '2026-11-02': 'Séance du lundi' });
  assert.equal(el('pres-date').value, '2026-11-03');
  assert.equal(el('pres-lecon').value, 'Séance du mardi');
});

test('un échec conserve le brouillon, qui est restauré et synchronisé après rechargement', async () => {
  const fixture = await setup();
  fixture.app.context.__failingApi = async (base, table, params, method, body) => {
    if (table === F.presence && method !== 'GET') throw new Error('Network unavailable');
    return fixture.backend.api(base, table, params, method, body);
  };
  fixture.app.evaluate('api = __failingApi;');
  fixture.edit('4.3', 'Brouillon conservé');
  await fixture.timers.advance(SAVE_DELAY);
  assert.equal(fixture.backend.data[F.presence].length, 0);
  assert.match(draftText(fixture), /Brouillon conservé/);

  const restored = await setup({ backend: fixture.backend, storage: fixture.storage });
  assert.equal(restored.el('pres-chapitre').value, '4.3');
  assert.equal(restored.el('pres-lecon').value, 'Brouillon conservé');
  assert.equal(restored.app.document.getElementById('pc-' + restored.backend.classId + '-' + restored.studentIds[0]).checked, true);
  await restored.timers.advance(SAVE_DELAY);
  assert.equal(restored.backend.data[F.presence][0].fields[F.pLesson], 'Brouillon conservé');
});

test('les modifications pendant un envoi restent affichées et sont ensuite envoyées', async () => {
  const fixture = await setup();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let waiting = true;
  fixture.app.context.__delayedApi = async (base, table, params, method, body) => {
    if (waiting && table === F.presence && method !== 'GET') {
      waiting = false;
      entered();
      await gate;
    }
    return fixture.backend.api(base, table, params, method, body);
  };
  fixture.app.evaluate('api = __delayedApi;');
  fixture.edit('4.3', 'Première version');
  const saving = fixture.app.evaluate(`submitPresence('${fixture.backend.classId}')`);
  await started;
  fixture.edit('4.4', 'Dernière version');
  release();
  await saving;
  assert.equal(fixture.el('pres-chapitre').value, '4.4');
  assert.equal(fixture.el('pres-lecon').value, 'Dernière version');
  await fixture.timers.advance(SAVE_DELAY);
  assert.equal(fixture.backend.data[F.presence].length, 1);
  assert.equal(fixture.backend.data[F.presence][0].fields[F.pChapter], '4.4');
  assert.equal(fixture.backend.data[F.presence][0].fields[F.pLesson], 'Dernière version');
});

test('une connexion perdue après création ne duplique pas les présences au nouvel essai', async () => {
  const fixture = await setup();
  let loseResponse = true;
  fixture.app.context.__uncertainApi = async (base, table, params, method, body) => {
    const result = await fixture.backend.api(base, table, params, method, body);
    if (loseResponse && table === F.presence && method === 'POST') {
      loseResponse = false;
      throw new Error('Connection lost after commit');
    }
    return result;
  };
  fixture.app.evaluate('api = __uncertainApi;');
  fixture.edit('4.3', 'Réponse perdue');
  await fixture.timers.advance(SAVE_DELAY);
  assert.equal(fixture.backend.data[F.presence].length, 1);
  assert.match(draftText(fixture), /Réponse perdue/);
  await fixture.timers.advance(30000);
  assert.equal(fixture.backend.data[F.presence].length, 1);
  assert.deepEqual(presenceWrites(fixture.backend).map(write => write.method), ['POST', 'PATCH']);
});

test('un échec après un premier lot reprend sans recréer les élèves déjà enregistrés', async () => {
  const backend = makeBackend();
  const studentIds = Array.from({ length: 12 }, (_, index) => 'recStudent' + String(index).padStart(7, '0'));
  backend.data[F.classes][0].fields[F.classStudents] = studentIds;
  backend.data[F.students] = studentIds.map((id, index) => ({ id, fields: { Name: 'Élève ' + index } }));
  const fixture = await setup({ backend });
  let creates = 0;
  fixture.app.context.__partialApi = async (base, table, params, method, body) => {
    if (table === F.presence && method === 'POST' && ++creates === 2) throw new Error('Second batch unavailable');
    return backend.api(base, table, params, method, body);
  };
  fixture.app.evaluate('api = __partialApi;');
  fixture.edit('4.3', 'Douze élèves');
  await fixture.timers.advance(SAVE_DELAY);
  assert.equal(backend.data[F.presence].length, 10);
  await fixture.timers.advance(30000);
  assert.equal(backend.data[F.presence].length, 12);
  assert.equal(new Set(backend.data[F.presence].map(record => record.fields[F.pStudent][0])).size, 12);
});

test('un remplacement est sauvegardé automatiquement et reste ouvert pour les corrections', async () => {
  const fixture = await setup();
  const { app, backend, timers, studentIds } = fixture;
  app.context.__replacement = { id: backend.classId, num: '101', teacher: 'Beth',
    studentIds, jour: 'Mardi' };
  app.evaluate('remplacementSelected = __replacement;');
  await app.evaluate('confirmRemplacement("2026-11-01")');
  assert.equal(app.document.getElementById('remp-submit-btn'), null);
  app.document.getElementById('remp-chapitre').value = '4.3';
  app.document.getElementById('remp-lecon').value = 'Remplacement';
  app.document.getElementById('rc-' + studentIds[0]).checked = true;
  app.evaluate('onReplacementPresenceEdited()');
  await timers.advance(SAVE_DELAY);
  assert.equal(backend.data[F.presence][0].fields[F.pDate], '2026-11-01T12:00:00.000Z');
  assert.equal(backend.data[F.presence][0].fields[F.pLesson], 'Remplacement');
  await timers.advance(2000);
  assert.ok(app.document.getElementById('remp-chapitre'));
  assert.equal(app.document.getElementById('remp-lecon').value, 'Remplacement');
});

test('la déconnexion arrête les envois et garde les brouillons isolés par enseignant', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Brouillon Alice');
  fixture.app.evaluate('resetTeacherState()');
  await fixture.timers.advance(SAVE_DELAY + 1000);
  assert.equal(presenceWrites(fixture.backend).length, 0);
  assert.match(draftText(fixture), /Brouillon Alice/);
  const other = await setup({ backend: fixture.backend, storage: fixture.storage, actor: fixture.backend.beth });
  assert.equal(other.el('pres-chapitre').value, '');
  assert.equal(other.el('pres-lecon').value, '');
  await other.timers.advance(SAVE_DELAY + 1000);
  assert.equal(presenceWrites(other.backend).length, 0);
});

test('un brouillon déjà synchronisé ne masque pas une correction ultérieure dans Airtable', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Ancienne saisie');
  await fixture.timers.advance(SAVE_DELAY);
  fixture.backend.data[F.presence][0].fields[F.pChapter] = '5.2';
  fixture.backend.data[F.presence][0].fields[F.pLesson] = 'Correction sur Airtable';
  await fixture.app.evaluate(`onPresenceDateChange('${fixture.backend.classId}')`);
  assert.equal(fixture.el('pres-chapitre').value, '5.2');
  assert.equal(fixture.el('pres-lecon').value, 'Correction sur Airtable');
});

test('une déconnexion pendant un lot empêche les lots suivants de partir', async () => {
  const backend = makeBackend();
  const studentIds = Array.from({ length: 12 }, (_, index) => 'recStudent' + String(index).padStart(7, '0'));
  backend.data[F.classes][0].fields[F.classStudents] = studentIds;
  backend.data[F.students] = studentIds.map((id, index) => ({ id, fields: { Name: 'Élève ' + index } }));
  const fixture = await setup({ backend });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  fixture.app.context.__delayedApi = async (base, table, params, method, body) => {
    const result = await backend.api(base, table, params, method, body);
    if (table === F.presence && method === 'POST') {
      entered();
      await gate;
    }
    return result;
  };
  fixture.app.evaluate('api = __delayedApi;');
  fixture.edit('4.3', 'Douze élèves');
  const saving = fixture.app.evaluate(`submitPresence('${backend.classId}')`);
  await started;
  fixture.app.evaluate('resetTeacherState()');
  release();
  await saving;
  await fixture.timers.advance(SAVE_DELAY);
  assert.equal(backend.data[F.presence].length, 10);
  assert.equal(presenceWrites(backend).length, 1);
});

test('une réponse tardive de l’historique après sauvegarde ne modifie pas le compte déconnecté', async () => {
  const fixture = await setup();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  fixture.app.context.__delayedHistory = async (base, table, params) => {
    if (table === F.presence && !decodeURIComponent(params).includes('IS_SAME')) {
      entered();
      await gate;
    }
    return fixture.backend.getAll(base, table, params);
  };
  fixture.app.evaluate('getAll = __delayedHistory;');
  fixture.edit('4.3', 'Historique tardif');
  await fixture.app.evaluate(`submitPresence('${fixture.backend.classId}')`);
  await started;
  fixture.app.evaluate('resetTeacherState()');
  release();
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  assert.equal(fixture.app.evaluate('Object.keys(state.presenceHistory).length'), 0);
});

test('recharger après deux minutes conserve la minute restante avant synchronisation', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Délai conservé');
  const restored = await setup({ backend: fixture.backend, storage: fixture.storage,
    now: new Date(new Date(NOW).getTime() + 2 * 60 * 1000).toISOString() });
  await restored.timers.advance(59999);
  assert.equal(presenceWrites(restored.backend).length, 0);
  await restored.timers.advance(1);
  assert.equal(restored.backend.data[F.presence][0].fields[F.pLesson], 'Délai conservé');
});

test('un brouillon vieux de plus de trois minutes est synchronisé dès la reprise', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Délai écoulé');
  const restored = await setup({ backend: fixture.backend, storage: fixture.storage,
    now: new Date(new Date(NOW).getTime() + 4 * 60 * 1000).toISOString() });
  await restored.timers.advance(0);
  assert.equal(restored.backend.data[F.presence][0].fields[F.pLesson], 'Délai écoulé');
});
