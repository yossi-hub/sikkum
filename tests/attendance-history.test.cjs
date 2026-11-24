const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, makeStorage, makeTimers, F, NOW } = require('./notifications-fixture.cjs');

const SAVE_DELAY = 3 * 60 * 1000;
const settle = async () => { for (let turn = 0; turn < 40; turn++) await Promise.resolve(); };

async function setup(studentCount = 2) {
  const backend = makeBackend();
  const studentIds = Array.from({ length: studentCount }, (_, index) => 'recStudent' + String(index).padStart(7, '0'));
  backend.alice.fields['Classes 5786'] = [backend.classId];
  backend.data[F.classes][0].fields[F.classStudents] = studentIds;
  backend.data[F.students] = studentIds.map((id, index) => ({ id, fields: { Name: index ? 'תלמידה נעדרת ' + index : 'תלמיד נוכח' } }));
  const timers = makeTimers();
  const app = loadApp(backend, backend.alice, NOW, { storage: makeStorage(), timers });
  app.evaluate('renderHeaderUser(state.teacher)');
  await app.evaluate('prefetchClasses()');
  await app.evaluate('renderPresenceTab()');
  await app.evaluate(`loadPresenceHistory('${backend.classId}')`);
  const el = name => app.document.getElementById(name + '-' + backend.classId);
  for (const sid of studentIds) app.document.getElementById('pc-' + backend.classId + '-' + sid).checked = false;
  const edit = (chapter = '4.3', lesson = 'שיעור חדש', present = true, motif = 'חולה') => {
    el('pres-chapitre').value = chapter;
    el('pres-lecon').value = lesson;
    app.document.getElementById('pc-' + backend.classId + '-' + studentIds[0]).checked = present;
    if (studentIds[1]) app.document.getElementById('pm-' + backend.classId + '-' + studentIds[1]).value = motif;
    app.evaluate(`onPresenceEdited('${backend.classId}')`);
  };
  const save = () => app.evaluate(`submitPresence('${backend.classId}')`);
  const sessions = () => JSON.parse(app.evaluate(`JSON.stringify(state.presenceHistory['${backend.classId}'])`));
  return { backend, app, timers, el, studentIds, edit, save, sessions };
}

function delayHistory(fixture, options = {}) {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  fixture.app.context.__historyGet = async (base, table, params) => {
    if (table === F.presence && !decodeURIComponent(params).includes('IS_SAME')) {
      entered();
      await gate;
      if (options.fail) throw new Error('History temporarily unavailable');
      if (options.records) return options.records;
    }
    return fixture.backend.getAll(base, table, params);
  };
  fixture.app.evaluate('getAll = __historyGet;');
  return { started, release };
}

test('la séance sélectionnée apparaît dans l’historique dès la sauvegarde confirmée', async () => {
  const fixture = await setup();
  fixture.edit();
  await fixture.timers.advance(SAVE_DELAY);
  const html = fixture.el('pres-hist').innerHTML;
  assert.match(html, /03\/11\/26/);
  assert.match(html, /4\.3/);
  assert.match(html, /שיעור חדש/);
  assert.match(html, /1\/2 ✓/);
  assert.match(html, /תלמיד נוכח/);
  assert.match(html, /תלמידה נעדרת 1/);
  assert.match(html, /חולה/);
  assert.equal(fixture.sessions().length, 1);
  assert.equal(fixture.sessions()[0].date, fixture.el('pres-date').value);
  assert.equal(fixture.backend.writes.some(write => write.table === F.history), false);
});

test('une correction met à jour la séance existante sans ajouter de ligne d’historique', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Première version');
  await fixture.save();
  await settle();
  fixture.edit('4.4', 'Version corrigée', false, 'Absence justifiée');
  await fixture.save();
  await settle();
  assert.equal(fixture.sessions().length, 1);
  assert.equal(fixture.sessions()[0].present, 0);
  assert.match(fixture.el('pres-hist').innerHTML, /4\.4/);
  assert.match(fixture.el('pres-hist').innerHTML, /Version corrigée/);
  assert.match(fixture.el('pres-hist').innerHTML, /0\/2 ✓/);
  assert.match(fixture.el('pres-hist').innerHTML, /Absence justifiée/);
  assert.doesNotMatch(fixture.el('pres-hist').innerHTML, /Première version/);
});

test('un brouillon ou un chapitre incomplet ne crée pas de séance dans l’historique', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Pas encore synchronisé');
  assert.equal(fixture.sessions().length, 0);
  assert.doesNotMatch(fixture.el('pres-hist').innerHTML, /pres-hist-item/);
  fixture.edit('4.', 'Chapitre incomplet');
  await fixture.timers.advance(SAVE_DELAY);
  assert.equal(fixture.sessions().length, 0);
  assert.doesNotMatch(fixture.el('pres-hist').innerHTML, /pres-hist-item/);
});

test('un échec de sauvegarde ne présente pas la séance comme enregistrée', async () => {
  const fixture = await setup();
  fixture.app.context.__failedWrite = async (base, table, params, method, body) => {
    if (table === F.presence && method !== 'GET') throw new Error('Write unavailable');
    return fixture.backend.api(base, table, params, method, body);
  };
  fixture.app.evaluate('api = __failedWrite;');
  fixture.edit();
  assert.equal(await fixture.save(), false);
  assert.equal(fixture.sessions().length, 0);
  assert.doesNotMatch(fixture.el('pres-hist').innerHTML, /pres-hist-item/);
});

test('une sauvegarde partielle attend la confirmation de tous les lots avant d’ajouter la séance', async () => {
  const fixture = await setup(12);
  let createCount = 0;
  fixture.app.context.__partialWrite = async (base, table, params, method, body) => {
    if (table === F.presence && method === 'POST' && ++createCount === 2) throw new Error('Second batch unavailable');
    return fixture.backend.api(base, table, params, method, body);
  };
  fixture.app.evaluate('api = __partialWrite;');
  fixture.edit();
  assert.equal(await fixture.save(), false);
  assert.equal(fixture.backend.data[F.presence].length, 10);
  assert.equal(fixture.sessions().length, 0);
  assert.doesNotMatch(fixture.el('pres-hist').innerHTML, /pres-hist-item/);
  await fixture.timers.advance(30000);
  assert.equal(fixture.sessions().length, 1);
  assert.equal(fixture.sessions()[0].total, 12);
  assert.match(fixture.el('pres-hist').innerHTML, /1\/12 ✓/);
});

test('une lecture lente de l’historique ne retarde pas l’affichage de la séance confirmée', async () => {
  const fixture = await setup();
  const history = delayHistory(fixture);
  fixture.el('pres-hist').classList.add('expanded');
  fixture.edit('4.3', 'Confirmation immédiate');
  await fixture.save();
  await history.started;
  assert.equal(fixture.sessions().length, 1);
  assert.match(fixture.el('pres-hist').innerHTML, /Confirmation immédiate/);
  assert.match(fixture.el('pres-hist').innerHTML, /1\/2 ✓/);
  assert.equal(fixture.el('pres-hist').classList.contains('expanded'), true);
  history.release();
  await settle();
});

test('un échec de rafraîchissement conserve la séance confirmée et l’historique ouvert', async () => {
  const fixture = await setup();
  const history = delayHistory(fixture, { fail: true });
  fixture.el('pres-hist').classList.add('expanded');
  fixture.edit('4.3', 'Historique conservé');
  await fixture.save();
  history.release();
  await settle();
  assert.equal(fixture.sessions().length, 1);
  assert.match(fixture.el('pres-hist').innerHTML, /Historique conservé/);
  assert.equal(fixture.el('pres-hist').classList.contains('expanded'), true);
  fixture.app.evaluate(`togglePresenceClass('${fixture.backend.classId}')`);
  fixture.app.evaluate(`togglePresenceClass('${fixture.backend.classId}')`);
  assert.match(fixture.el('pres-hist').innerHTML, /Historique conservé/);
});

test('le rafraîchissement de l’historique conserve la saisie commencée après la sauvegarde', async () => {
  const fixture = await setup();
  const history = delayHistory(fixture);
  fixture.edit('4.3', 'Version confirmée');
  await fixture.save();
  await history.started;
  fixture.edit('4.4', 'Correction en attente', false, 'Nouveau motif');
  history.release();
  await settle();
  assert.equal(fixture.el('pres-chapitre').value, '4.4');
  assert.equal(fixture.el('pres-lecon').value, 'Correction en attente');
  assert.equal(fixture.app.document.getElementById('pc-' + fixture.backend.classId + '-' + fixture.studentIds[0]).checked, false);
  assert.match(fixture.el('pres-hist').innerHTML, /Version confirmée/);
  assert.doesNotMatch(fixture.el('pres-hist').innerHTML, /Correction en attente/);
});

test('changer la date du formulaire ne masque pas les séances déjà confirmées', async () => {
  const fixture = await setup();
  fixture.edit('4.3', 'Séance du mardi');
  await fixture.save();
  await settle();
  fixture.el('pres-date').value = '2026-11-02';
  await fixture.app.evaluate(`onPresenceDateChange('${fixture.backend.classId}')`);
  assert.match(fixture.el('pres-hist').innerHTML, /03\/11\/26/);
  assert.match(fixture.el('pres-hist').innerHTML, /Séance du mardi/);
  assert.equal(fixture.sessions().length, 1);
});

test('une réponse d’historique après déconnexion ne restaure pas les séances de l’ancien compte', async () => {
  const fixture = await setup();
  const history = delayHistory(fixture);
  fixture.edit();
  await fixture.save();
  await history.started;
  fixture.app.evaluate('resetTeacherState()');
  history.release();
  await settle();
  assert.equal(fixture.app.evaluate('Object.keys(state.presenceHistory).length'), 0);
});
