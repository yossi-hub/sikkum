const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, F, NOW } = require('./notifications-fixture.cjs');

function replacementSearch(classes, now = NOW) {
  const backend = makeBackend();
  backend.data[F.classes] = classes.map((cls, index) => ({
    id: `recSearch${index}`,
    fields: {
      'Numéro de Classe': cls.num,
      'Teacher en texte': cls.teacher || 'Professeur',
      Status: cls.status || 'In Progress',
      'Se termine le ': cls.endDate === undefined ? [] : [cls.endDate]
    }
  }));
  const app = loadApp(backend, backend.alice, now);
  app.document.getElementById('tab-presence').innerHTML =
    '<input id="remp-search"><div id="remp-results"></div>';
  return async query => {
    app.document.getElementById('remp-search').value = query;
    await app.evaluate('onRemplacementSearch()');
    const html = app.document.getElementById('remp-results').innerHTML;
    return {
      html,
      numbers: [...html.matchAll(/classe-title">כיתה ([^<]+)</g)].map(match => match[1])
    };
  };
}

test('le numéro exact reste visible au-delà des huit premiers résultats Airtable', async () => {
  const search = replacementSearch([
    ...['124', '24', '140', '43', '204', '164', '42', '304'].map(num => ({ num })),
    { num: '4', teacher: 'Professeur actuel' },
    { num: '4', teacher: 'Ancien professeur', status: 'Complete', endDate: '2026-10-30' }
  ]);
  const result = await search('4');
  assert.deepEqual(result.numbers, ['4', '4']);
  assert.match(result.html, /Professeur actuel/);
  assert.match(result.html, /Ancien professeur/);
});

test('le numéro saisi ne renvoie aucun autre numéro contenant les mêmes chiffres', async () => {
  const search = replacementSearch(
    ['124', '24', '140', '43', '204', '42', '400', '40', '4'].map(num => ({ num }))
  );
  assert.deepEqual((await search(' 4 ')).numbers, ['4']);
  assert.deepEqual((await search('24')).numbers, ['24']);
  assert.deepEqual((await search('40')).numbers, ['40']);
  assert.deepEqual((await search('14')).numbers, []);
});

test('la recherche conserve ses filtres de statut, ignore la casse et efface les résultats vides', async () => {
  const search = replacementSearch([
    { num: 'IL04' },
    { num: '4', status: 'Upcoming' }
  ]);
  assert.deepEqual((await search('il04')).numbers, ['IL04']);
  const missing = await search('999');
  assert.deepEqual(missing.numbers, []);
  assert.match(missing.html, /לא נמצאה כיתה/);
  assert.equal((await search('')).html, '');
  assert.deepEqual((await search('4')).numbers, []);
});

test('seules les classes en cours ou terminées depuis moins de sept jours sont proposées', async () => {
  const search = replacementSearch([
    { num: '4', teacher: 'En cours' },
    { num: '4', teacher: 'Terminée aujourd’hui', status: 'Complete', endDate: '2026-11-05' },
    { num: '4', teacher: 'Terminée il y a six jours', status: 'Complete', endDate: '2026-10-30' },
    { num: '4', teacher: 'Terminée il y a sept jours', status: 'Complete', endDate: '2026-10-29' },
    { num: '4', teacher: 'Ancienne classe', status: 'Complete', endDate: '2026-07-02' },
    { num: '4', teacher: 'Fin future', status: 'Complete', endDate: '2026-11-06' },
    { num: '4', teacher: 'Sans date', status: 'Complete' },
    { num: '4', teacher: 'Date invalide', status: 'Complete', endDate: 'invalide' },
    { num: '4', teacher: 'À venir', status: 'Upcoming', endDate: '2026-11-04' }
  ], '2026-11-05T12:00:00Z');
  const result = await search('4');
  assert.deepEqual(result.numbers, ['4', '4', '4']);
  for (const teacher of ['En cours', 'Terminée aujourd’hui', 'Terminée il y a six jours']) {
    assert.ok(result.html.includes(teacher), teacher);
  }
  for (const teacher of ['Terminée il y a sept jours', 'Ancienne classe', 'Fin future', 'Sans date', 'Date invalide', 'À venir']) {
    assert.ok(!result.html.includes(teacher), teacher);
  }
});

test('le seuil suit minuit à Paris et reste exact au changement d’heure', async () => {
  const classes = [{ num: '4', status: 'Complete', endDate: '2026-10-19' }];
  const beforeMidnight = replacementSearch(classes, '2026-10-25T22:59:59Z');
  const atMidnight = replacementSearch(classes, '2026-10-25T23:00:00Z');
  assert.deepEqual((await beforeMidnight('4')).numbers, ['4']);
  assert.deepEqual((await atMidnight('4')).numbers, []);
});

test('une classe terminée expire même si elle est déjà chargée dans le cache', async () => {
  const { evaluate } = loadApp();
  evaluate(`allClassesLight = [{ id: 'recCached', num: '4', status: 'Complete', endDate: '2026-10-27' }];
    document.getElementById('tab-presence').innerHTML = '<input id="remp-search"><div id="remp-results"></div>';
    document.getElementById('remp-search').value = '4';`);
  await evaluate('onRemplacementSearch()');
  assert.equal(evaluate('document.getElementById("remp-results").innerHTML.includes("classe-title")'), false);
  assert.equal(evaluate('isReplacementClassSearchable({status: "Complete", endDate: "2026-02-30"})'), false);
});

test('un cache issu d’un rappel est rechargé pour vérifier le statut et la date de fin', async () => {
  const { evaluate } = loadApp();
  evaluate(`allClassesLight = [{ id: 'recFromReminder', num: '101', teacher: 'Beth' }];
    document.getElementById('tab-presence').innerHTML = '<input id="remp-search"><div id="remp-results"></div>';
    document.getElementById('remp-search').value = '101';`);
  await evaluate('onRemplacementSearch()');
  assert.equal(evaluate('document.getElementById("remp-results").innerHTML.includes("classe-title")'), true);
  assert.equal(evaluate('allClassesLight[0].status'), 'In Progress');
});
