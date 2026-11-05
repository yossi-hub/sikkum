const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBackend, loadApp, F } = require('./notifications-fixture.cjs');

function replacementSearch(classes) {
  const backend = makeBackend();
  backend.data[F.classes] = classes.map((cls, index) => ({
    id: `recSearch${index}`,
    fields: {
      'Numéro de Classe': cls.num,
      'Teacher en texte': cls.teacher || 'Professeur',
      Status: cls.status || 'In Progress'
    }
  }));
  const app = loadApp(backend);
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
    { num: '4', teacher: 'Ancien professeur', status: 'Complete' }
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
