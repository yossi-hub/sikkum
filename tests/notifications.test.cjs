const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, F } = require('./notifications-fixture.cjs');

test('J+2 calendaire, seuil 9 h à Paris et changements d’heure', () => {
  const { feature } = loadApp();
  const r = feature.rules, H = r.H;
  const fields = { [H.date]: '2026-10-30', [H.status]: 'Manquante', [H.checked]: '2026-11-01' };
  assert.equal(r.addDays('2026-10-30', 2), '2026-11-01'); // vendredi → dimanche
  assert.equal(r.reportDue(fields, new Date('2026-11-01T07:59:59Z')), false);
  assert.equal(r.reportDue(fields, new Date('2026-11-01T08:00:00Z')), true);
  assert.equal(r.dueInstant('2026-10-30'), '2026-11-01T08:00:00.000Z');
  assert.equal(r.dueInstant('2026-03-27'), '2026-03-29T07:00:00.000Z');
  assert.equal(r.addDays('2026-02-30', 2), '');
  assert.equal(r.reportDue({ ...fields, [H.checked]: '2026-10-31' }, new Date('2026-11-01T09:00Z')), false);
  assert.equal(r.reportDue({ ...fields, [H.status]: 'À confirmer' }, new Date('2026-11-01T09:00Z')), false);
});

test('le remplaçant choisi reçoit le rappel à la place du titulaire', async () => {
  const b = makeBackend(), app = loadApp(b);
  await app.feature.refresh();
  const reminders = b.data[F.notifications].filter(r => r.fields[F.nType] === 'presence');
  assert.equal(reminders.length, 1);
  assert.deepEqual(Array.from(reminders[0].fields[F.nTeacher]), [b.alice.id]);
  const original = loadApp(b, b.beth);
  await original.feature.refresh();
  assert.equal(b.data[F.notifications].filter(r => r.fields[F.nType] === 'presence').length, 1);
});

test('un nom ambigu ou plusieurs remplaçants ne provoquent pas de mauvaise attribution', () => {
  const b = makeBackend(), { feature } = loadApp(b);
  const report = b.data[F.history][0], info = new Map([[b.classId, { num: '101' }]]);
  b.data[F.absences][1].fields[F.replacement] = [b.alice.id, b.carol.id];
  assert.equal(feature.rules.responsibleTeacher(report, b.data[F.teachers], b.data[F.absences], info), null);
  delete b.data[F.absences][1].fields[F.replacement];
  delete report.fields[F.hEmail];
  b.data[F.teachers].push({ id: 'recDuplicate00000', fields: { Name: 'Beth' } });
  assert.equal(feature.rules.responsibleTeacher(report, b.data[F.teachers], b.data[F.absences], info), null);
});

test('les contrôles successifs et deux onglets créent une seule notification par source et compte', async () => {
  const b = makeBackend(), a = loadApp(b), second = loadApp(b);
  await Promise.all([a.feature.refresh(), second.feature.refresh()]);
  assert.equal(b.data[F.notifications].length, 2);
  await a.feature.refresh(true);
  assert.equal(b.data[F.notifications].length, 2);
  const otherUser = loadApp(b, b.carol);
  await otherUser.feature.refresh();
  assert.equal(b.data[F.notifications].length, 3);
  assert.equal(otherUser.document.getElementById('notifications-dot').hidden, false);
});

test('un double clic et deux appareils ne créent qu’une candidature (et un déclenchement e-mail)', async () => {
  const b = makeBackend(), a = loadApp(b), second = loadApp(b);
  await Promise.all([a.feature.refresh(), second.feature.refresh()]);
  await Promise.all([a.feature.apply(b.offerId), a.feature.apply(b.offerId), second.feature.apply(b.offerId)]);
  assert.equal(b.candidateCreates, 1);
  assert.equal(b.data[F.applications].length, 1);
  assert.deepEqual(Array.from(b.data[F.applications][0].fields[F.cAbsence]), [b.offerId]);
  const reloaded = loadApp(b);
  await reloaded.feature.refresh();
  assert.match(reloaded.document.getElementById('remplacement-proposals').innerHTML, /המועמדות נשלחה/);
});

test('une réponse réseau perdue après enregistrement ne provoque pas un deuxième e-mail', async () => {
  const b = makeBackend(), a = loadApp(b);
  await a.feature.refresh();
  b.throwAfterCandidateCommit = true;
  await a.feature.apply(b.offerId);
  await a.feature.apply(b.offerId);
  assert.equal(b.candidateCreates, 1);
});

test('une offre attribuée entre affichage et clic ne reçoit pas de candidature', async () => {
  const b = makeBackend(), app = loadApp(b);
  await app.feature.refresh();
  b.data[F.absences][0].fields[F.replacement] = [b.carol.id];
  await app.feature.apply(b.offerId);
  assert.equal(b.candidateCreates, 0);
  assert.ok(b.data[F.notifications].find(r => r.fields[F.nSource] === b.offerId).fields[F.nClosed]);
});

test('lecture persistante par compte, point rouge et ancienne offre pourvue consultable', async () => {
  const b = makeBackend(), app = loadApp(b);
  await app.feature.refresh();
  const note = b.data[F.notifications].find(r => r.fields[F.nType] === 'remplacement');
  await app.feature.toggle();
  const dialog = app.document.getElementById('notifications-dialog');
  await dialog.handlers.click({ target: { closest: () => ({ dataset: { notificationKey: note.fields[F.nKey] } }) } });
  // Le gestionnaire UI déclenche une promesse ; laisser les microtâches se terminer.
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(note.fields[F.nRead]);
  b.data[F.absences][0].fields[F.replacement] = [b.carol.id];
  b.visible.delete(b.offerId);
  await app.feature.refresh(true);
  assert.match(app.document.getElementById('notifications-content').innerHTML, /השיעור כבר אויש/);
  const next = loadApp(b);
  await next.feature.refresh();
  const same = b.data[F.notifications].find(r => r.fields[F.nKey] === note.fields[F.nKey]);
  assert.ok(same.fields[F.nRead]);
});

test('la sauvegarde clôture le rappel, sans modifier le rapport ni en recréer au prochain passage', async () => {
  const b = makeBackend(), app = loadApp(b);
  await app.feature.refresh();
  await app.feature.presenceSaved('101', '2026-11-01');
  const reminder = b.data[F.notifications].find(r => r.fields[F.nType] === 'presence');
  assert.ok(reminder.fields[F.nClosed]);
  assert.equal(b.writes.some(w => w.table === F.history), false);
  const again = loadApp(b);
  await again.feature.refresh();
  assert.equal(b.data[F.notifications].filter(r => r.fields[F.nType] === 'presence').length, 1);
  assert.ok(reminder.fields[F.nClosed]);
});

test('une régularisation du rapport clôture automatiquement le rappel', async () => {
  const b = makeBackend(), app = loadApp(b);
  await app.feature.refresh();
  b.data[F.history][0].fields[F.hStatus] = 'Saisie';
  await app.feature.refresh(true);
  assert.ok(b.data[F.notifications].find(r => r.fields[F.nType] === 'presence').fields[F.nClosed]);
});

test('le rappel du remplaçant ouvre directement la bonne classe et la date de la séance', async () => {
  const b = makeBackend(), app = loadApp(b);
  await app.feature.refresh();
  const note = b.data[F.notifications].find(r => r.fields[F.nType] === 'presence');
  await app.feature.toggle();
  const dialog = app.document.getElementById('notifications-dialog');
  dialog.handlers.click({ target: { closest: () => ({ dataset: { notificationKey: note.fields[F.nKey] } }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.document.getElementById('remp-results').innerHTML, /2026-11-01/);
  assert.match(app.document.getElementById('remp-results').innerHTML, /101/);
  assert.match(app.document.getElementById('remp-results').innerHTML, /Beth/);
  assert.equal(dialog.open, false);
  assert.equal(b.calls.some(call => {
    const q = new URLSearchParams(call.params.replace(/^\?/, ''));
    return call.table === F.classes && q.get('returnFieldsByFieldId') === 'false' &&
      q.get('filterByFormula') === '{Numéro de Classe}="101"';
  }), true);
});

test('une déconnexion pendant la lecture empêche les écritures et l’affichage sous un autre compte', async () => {
  const b = makeBackend(), app = loadApp(b);
  let release;
  b.gate = new Promise(resolve => { release = resolve; });
  const loading = app.feature.refresh();
  app.feature.reset();
  app.context.__actor = b.carol;
  app.evaluate('state.teacher = {id:__actor.id,name:__actor.fields.Name,email:__actor.fields.Email,classIds:[]};');
  release();
  await loading;
  assert.equal(b.writes.length, 0);
});

test('l’échec Airtable reste visible et ne crée aucun faux succès', async () => {
  const b = makeBackend(), app = loadApp(b);
  b.failReads = true;
  await app.feature.refresh();
  assert.equal(b.writes.length, 0);
  assert.match(app.document.getElementById('remplacement-proposals').innerHTML, /לא ניתן לעדכן/);
});

test('les titres et détails provenant d’Airtable sont échappés', async () => {
  const b = makeBackend(), app = loadApp(b);
  b.data[F.classes][0].fields[F.num] = '<img src=x onerror=alert(1)>';
  await app.feature.refresh();
  const rendered = app.document.getElementById('remplacement-proposals').innerHTML;
  assert.equal(rendered.includes('<img src=x'), false);
  assert.ok(rendered.includes('&lt;img'));
});
