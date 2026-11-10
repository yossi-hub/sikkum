const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, F } = require('./notifications-fixture.cjs');

function setup(status = 'Complete') {
  const b = makeBackend();
  b.alice.fields['Classes 5786'] = [b.classId];
  b.data[F.classes][0].fields[F.classStatus] = status;
  const app = loadApp(b);
  app.feature.start();
  app.evaluate('renderTabsBar();');
  return { b, app };
}
function notes(b) {
  return b.data[F.notifications].filter(r => r.fields[F.nType] === 'sikkum');
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
async function openNote(app, note) {
  await app.feature.toggle();
  app.document.getElementById('notifications-dialog').handlers.click({ target: {
    closest: () => ({ dataset: { notificationKey: note.fields[F.nKey] } })
  } });
  await settle();
}

test('seul le statut Complete déclenche le bilan, même avec une date de fin future', async () => {
  const { b, app } = setup('In Progress');
  b.data[F.classes][0].fields['Se termine le '] = ['2020-01-01'];
  await app.feature.refresh(true);
  await app.evaluate('prefetchClasses()');
  assert.equal(notes(b).length, 0);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, true);
  assert.match(app.evaluate('buildSikkumHtml()'), /אין כרגע כיתות שהסתיימו/);
  b.data[F.classes][0].fields[F.classStatus] = 'Complete';
  b.data[F.classes][0].fields['Se termine le '] = ['2030-01-01'];
  await app.feature.refresh(true);
  await app.evaluate('loadClasses("sikkum")');
  assert.equal(notes(b).length, 1);
  assert.match(app.document.getElementById('tab-sikkum').innerHTML, /כיתה 101/);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  app.evaluate('renderWelcome()');
  assert.equal(app.document.getElementById('sikkum-home-dot').hidden, false);
});

test('une notification unique par classe et professeur, sans envoi au remplaçant ni aux autres comptes', async () => {
  const { b, app } = setup();
  const second = loadApp(b);
  await Promise.all([app.feature.refresh(true), second.feature.refresh(true)]);
  await app.feature.refresh(true);
  assert.equal(notes(b).length, 1);
  assert.deepEqual(Array.from(notes(b)[0].fields[F.nTeacher]), [b.alice.id]);
  const other = loadApp(b, b.carol);
  await other.feature.refresh(true);
  assert.equal(notes(b).length, 1);
});

test('la lecture ouvre directement la bonne classe et conserve le point rouge du bilan', async () => {
  const { b, app } = setup();
  await app.feature.refresh(true);
  await openNote(app, notes(b)[0]);
  assert.ok(notes(b)[0].fields[F.nRead]);
  assert.equal(app.document.getElementById('notifications-dialog').open, false);
  assert.equal(app.document.getElementById('block-' + b.classId).classList.contains('open'), true);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  assert.equal(app.document.getElementById('block-' + b.classId).scrollCount, 1);
  const reload = loadApp(b);
  reload.feature.start();
  reload.evaluate('renderTabsBar();');
  await reload.feature.refresh(true);
  assert.equal(reload.document.getElementById('sikkum-tab-dot').hidden, false);
});

test('le point reste présent après le premier bilan et disparaît après le dernier, y compris après reconnexion', async () => {
  const { b, app } = setup();
  const secondId = 'recJJJJJJJJJJJJJJ';
  b.data[F.classes].push({ id: secondId, fields: {
    ...b.data[F.classes][0].fields, [F.num]: '102'
  } });
  app.evaluate(`state.teacher.classIds.push('${secondId}');`);
  await app.feature.refresh(true);
  await app.evaluate('loadClasses("sikkum")');
  await app.evaluate(`submitClass('${b.classId}')`);
  await settle();
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  assert.ok(notes(b).find(n => n.fields[F.nSource] === b.classId).fields[F.nClosed]);
  assert.ok(!notes(b).find(n => n.fields[F.nSource] === secondId).fields[F.nClosed]);
  await app.evaluate(`submitClass('${secondId}')`);
  await settle();
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, true);
  assert.equal(notes(b).every(n => n.fields[F.nClosed]), true);
  assert.match(app.document.getElementById('tab-sikkum').innerHTML, /כל הכיתות נשלחו/);
  const reload = loadApp(b);
  reload.feature.start();
  reload.evaluate('renderTabsBar();');
  await reload.feature.refresh(true);
  assert.equal(reload.document.getElementById('sikkum-tab-dot').hidden, true);
  assert.equal(notes(b).length, 2);
});

test('les bilans déjà envoyés restent consultables sans nouvelle notification', async () => {
  const { b, app } = setup();
  b.data[F.rapports].push({ id: 'recExisting', fields: {
    [F.rClass]: '101', [F.rTeacher]: b.alice.fields.Name, [F.rStudent]: 'תלמיד לדוגמה'
  } });
  await app.feature.refresh(true);
  await app.evaluate('loadClasses("sikkum")');
  assert.equal(notes(b).length, 0);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, true);
  assert.match(app.document.getElementById('tab-sikkum').innerHTML, /✓ נשלח/);
});

test('une erreur de sauvegarde conserve le bilan en attente', async () => {
  const { b, app } = setup();
  await app.feature.refresh(true);
  await app.evaluate('loadClasses("sikkum")');
  assert.equal(notes(b).length, 1);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  const api = b.api;
  b.api = async (base, table, params, method, body) => {
    if (table === F.rapports && method === 'POST') throw new Error('Sauvegarde indisponible');
    return api(base, table, params, method, body);
  };
  app.context.__api = b.api;
  app.evaluate('api = __api;');
  await app.evaluate(`submitClass('${b.classId}')`);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  assert.ok(!notes(b)[0].fields[F.nClosed]);
});

test('un bilan rempli sur un autre appareil clôture la notification et retire le point', async () => {
  const { b, app } = setup();
  await app.feature.refresh(true);
  b.data[F.rapports].push({ id: 'recRemote', fields: {
    [F.rClass]: '101', [F.rTeacher]: b.alice.fields.Name, [F.rStudent]: 'תלמיד לדוגמה'
  } });
  await app.feature.refresh(true);
  assert.ok(notes(b)[0].fields[F.nClosed]);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, true);
});

test('un retour en In Progress retire la classe du bilan et clôture son rappel', async () => {
  const { b, app } = setup();
  await app.feature.refresh(true);
  b.data[F.classes][0].fields[F.classStatus] = 'In Progress';
  await app.feature.refresh(true);
  await openNote(app, notes(b)[0]);
  assert.ok(notes(b)[0].fields[F.nClosed]);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, true);
  assert.equal(app.document.getElementById('notifications-dialog').open, true);
  assert.match(app.document.getElementById('notifications-message').textContent, /הכיתה אינה ממתינה/);
});

test('une classe en cours ne bloque pas le succès des bilans des classes terminées', async () => {
  const { b, app } = setup();
  const activeId = 'recKKKKKKKKKKKKKK';
  b.data[F.classes].push({ id: activeId, fields: {
    ...b.data[F.classes][0].fields, [F.num]: '999', [F.classStatus]: 'In Progress'
  } });
  app.evaluate(`state.teacher.classIds.push('${activeId}');`);
  await app.evaluate('loadClasses("sikkum")');
  await app.evaluate(`submitClass('${b.classId}')`);
  assert.match(app.document.getElementById('tab-sikkum').innerHTML, /כל הכיתות נשלחו/);
  assert.doesNotMatch(app.document.getElementById('tab-sikkum').innerHTML, /כיתה 999/);
});

test('le changement de professeur efface le point rouge du compte précédent', async () => {
  const { app } = setup();
  await app.feature.refresh(true);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  app.evaluate('resetTeacherState()');
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, true);
});

test('une classe ajoutée au professeur après connexion est détectée sans se reconnecter', async () => {
  const { b, app } = setup('In Progress');
  await app.feature.refresh(true);
  await app.evaluate('loadClasses("sikkum")');
  const addedId = 'recLLLLLLLLLLLLLL';
  b.data[F.classes].push({ id: addedId, fields: {
    ...b.data[F.classes][0].fields, [F.num]: '103', [F.classStatus]: 'Complete'
  } });
  // Airtable renvoie une nouvelle liste de liens ; le compte en mémoire n'a pas encore ce lien.
  b.alice.fields['Classes 5786'] = [b.classId, addedId];
  await app.feature.refresh(true);
  assert.equal(notes(b).length, 1);
  assert.equal(notes(b)[0].fields[F.nSource], addedId);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  await app.evaluate('loadClasses("sikkum")');
  assert.match(app.document.getElementById('tab-sikkum').innerHTML, /כיתה 103/);
  assert.doesNotMatch(app.document.getElementById('tab-sikkum').innerHTML, /כיתה 101/);
});

test('le filtrage du bilan conserve toutes les classes pour les présences', async () => {
  const { b, app } = setup();
  const activeId = 'recMMMMMMMMMMMMMM';
  b.data[F.classes].push({ id: activeId, fields: {
    ...b.data[F.classes][0].fields, [F.num]: '999', [F.classStatus]: 'In Progress'
  } });
  b.alice.fields['Classes 5786'].push(activeId);
  await app.evaluate('loadClasses("sikkum")');
  assert.equal(app.evaluate('const allCourseClasses = state.classes; renderSikkumTab(); state.classes === allCourseClasses'), true);
  assert.equal(app.evaluate('state.classes.length'), 2);
  assert.doesNotMatch(app.document.getElementById('tab-sikkum').innerHTML, /כיתה 999/);
  assert.match(app.document.getElementById('tab-presence').innerHTML, /כיתה 999/);
});

test('le point rouge survit à la reconstruction du menu sans être dupliqué', async () => {
  const { b, app } = setup();
  await app.feature.refresh(true);
  app.evaluate('renderTabsBar(); renderTabsBar();');
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
  assert.equal((app.document.getElementById('tabs-bar').innerHTML.match(/id="sikkum-tab-dot"/g) || []).length, 1);
  await openNote(app, notes(b)[0]);
  assert.equal(app.document.getElementById('sikkum-tab-dot').hidden, false);
});

test('plusieurs démarrages du bandeau ne doublent pas une sauvegarde du bilan', async () => {
  const { b, app } = setup();
  app.feature.start();
  app.feature.start();
  await app.feature.refresh(true);
  await app.evaluate('loadClasses("sikkum")');
  await app.evaluate(`submitClass('${b.classId}')`);
  assert.equal(b.data[F.rapports].length, 1);
  assert.equal(b.writes.filter(w => w.table === F.rapports).length, 1);
});
