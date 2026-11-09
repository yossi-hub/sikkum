const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeBackend, F } = require('./notifications-fixture.cjs');
const ORIGIN = 'https://dev.example.test';
const BASE = 'appNbwmEyVQsXA25U';
const SETTINGS = 'tbl4cWV4PlQ8NGslX';
const SETTINGS_RECORD = 'recRw31i389hBWXsX';
const CLIENT_ID = '208792012375-tah7nn3utsgsnbgs9fv2ah5mr17qcr6n.apps.googleusercontent.com';
let createGateway, jose, privateKey, publicKeys;
test.before(async () => {
  jose = await import('jose');
  ({ createGateway } = await import('../server/gateway.mjs'));
  const keys = await jose.generateKeyPair('RS256');
  privateKey = keys.privateKey;
  publicKeys = jose.createLocalJWKSet({ keys: [{ ...await jose.exportJWK(keys.publicKey), kid: 'test-google', use: 'sig', alg: 'RS256' }] });
});
async function fixture(email = 'alice@oulpanlavi.com') {
  const b = makeBackend();
  b.alice.fields.Email = email;
  b.alice.fields['Classes 5786'] = [b.classId];
  b.data[F.classes][0].fields[F.classStatus] = 'Complete';
  b.data[SETTINGS] = [{ id: SETTINGS_RECORD, fields: { fldPl4DXdbAKlf47Y: '' } }];
  const env = { AIRTABLE_TOKEN: 'test-server-only-token', SESSION_SECRET: 'a'.repeat(64) };
  const upstream = [];
  const gateway = createGateway({ googleKeys: publicKeys, fetcher: async (input, options) => {
    const url = new URL(input);
    upstream.push({ url, options });
    assert.equal(url.origin, 'https://api.airtable.com');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.AIRTABLE_TOKEN);
    const [, , base, table, record] = url.pathname.split('/');
    if (table === F.teachers && !record) {
      const formula = url.searchParams.get('filterByFormula') || '';
      const rows = b.data[F.teachers].filter(r => !formula.includes('LOWER(TRIM') || formula.includes('"' + r.fields.Email + '"'));
      return Response.json({ records: rows });
    }
    const data = await b.api(base, table, (record ? '/' + record : '') + url.search, options.method || 'GET', options.body && JSON.parse(options.body));
    return Response.json(data);
  } });
  async function idToken(overrides = {}, signer = privateKey) {
    return new jose.SignJWT({ email, email_verified: true, hd: 'oulpanlavi.com', ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-google' }).setSubject('google-user')
      .setIssuer('https://accounts.google.com').setAudience(CLIENT_ID)
      .setIssuedAt().setExpirationTime('1h').sign(signer);
  }
  async function call(route, { method = 'GET', body, cookie, origin = ORIGIN, headers = {}, host = ORIGIN } = {}) {
    return gateway(new Request(host + route, {
      method, headers: { ...(method === 'GET' ? {} : { Origin: origin }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}), ...headers
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
  }
  async function login() {
    const response = await call('/api/session', { method: 'POST', body: { credential: await idToken() } });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  return { b, env, upstream, gateway, call, login, idToken };
}
const route = table => `/api/airtable/${BASE}/${table}`;

test('aucun accès Airtable sans session authentifiée', async () => {
  const f = await fixture();
  const response = await f.call(route(F.classes));
  assert.equal(response.status, 401);
  assert.equal(f.upstream.length, 0);
});

test('connexion Google vérifiée et session conservée dans un cookie sécurisé', async () => {
  const f = await fixture();
  const response = await f.call('/api/session', { method: 'POST', body: { credential: await f.idToken() } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const text = await response.text();
  assert.ok(!text.includes(f.env.AIRTABLE_TOKEN));
  assert.ok(!text.includes(f.env.SESSION_SECRET));
  assert.equal(JSON.parse(text).email, 'alice@oulpanlavi.com');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('/api/session', { cookie })).status, 200);
});

test('une signature Google falsifiée est rejetée avant tout appel Airtable', async () => {
  const f = await fixture();
  const wrong = await jose.generateKeyPair('RS256');
  const token = await f.idToken({}, wrong.privateKey);
  assert.equal((await f.call('/api/session', { method: 'POST', body: { credential: token } })).status, 401);
  assert.equal(f.upstream.length, 0);
});

test('les jetons expirés, mauvais clients, domaines externes et comptes non vérifiés sont refusés', async () => {
  const f = await fixture();
  for (const claims of [{ exp: 1 }, { aud: 'another-app' }, { hd: 'other.test' }, { email_verified: false }]) {
    // Claims are set after the defaults here so expiration and audience are tested explicitly.
    const token = await new jose.SignJWT({ sub: 'google-user', iss: 'https://accounts.google.com', aud: CLIENT_ID,
      email: 'alice@oulpanlavi.com', hd: 'oulpanlavi.com', email_verified: true,
      iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-google' }).sign(privateKey);
    assert.ok([401,403].includes((await f.call('/api/session', { method: 'POST', body: { credential: token } })).status));
  }
  assert.equal(f.upstream.length, 0);
});

test('un compte du domaine qui ne figure pas parmi les professeurs ne reçoit aucune session', async () => {
  const f = await fixture();
  const token = await f.idToken({ email: 'unknown@oulpanlavi.com' });
  const response = await f.call('/api/session', { method: 'POST', body: { credential: token } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('les sessions falsifiées ou réutilisées sur un autre site sont refusées', async () => {
  const f = await fixture();
  const cookie = await f.login();
  assert.equal((await f.call(route(F.classes), { cookie: cookie + 'modified' })).status, 401);
  assert.equal((await f.call(route(F.classes), { cookie, host: 'https://other.example.test' })).status, 401);
});

test('le proxy utilise la clé serveur, limite les tables et refuse DELETE', async () => {
  const f = await fixture(), cookie = await f.login();
  const response = await f.call(route(F.classes), { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await f.call('/api/airtable/appXXXXXXXXXXXXXX/tblXXXXXXXXXXXXXX', { cookie })).status, 403);
  assert.equal((await f.call(route(F.classes), { cookie, method: 'DELETE' })).status, 405);
});

test('un professeur ne peut pas usurper un autre compte ni modifier les administrateurs', async () => {
  const f = await fixture(), cookie = await f.login();
  assert.equal((await f.call(route(F.classes), { cookie, headers: { 'X-Lavi-Teacher': 'beth@oulpanlavi.com' } })).status, 403);
  assert.equal((await f.call(route(SETTINGS) + '/' + SETTINGS_RECORD, { cookie, method: 'PATCH', body: {
    fields: { fldPl4DXdbAKlf47Y: 'alice@oulpanlavi.com' }
  } })).status, 403);
  assert.equal(f.b.writes.length, 0);
});

test('les notifications sont filtrées par compte et une notification étrangère ne peut pas être fermée', async () => {
  const f = await fixture(), cookie = await f.login();
  const own = { id: 'recNNNNNNNNNNNNNN', fields: { [F.nTeacher]: [f.b.alice.id], [F.nKey]: f.b.alice.id + '|sikkum|class' } };
  const other = { id: 'recOOOOOOOOOOOOOO', fields: { [F.nTeacher]: [f.b.beth.id], [F.nKey]: f.b.beth.id + '|sikkum|class' } };
  f.b.data[F.notifications].push(own, other);
  const read = await f.call(route(F.notifications), { cookie });
  assert.deepEqual((await read.json()).records.map(r => r.id), [own.id]);
  assert.equal((await f.call(route(F.notifications) + '/' + other.id, { cookie, method: 'PATCH', body: { fields: { [F.nClosed]: '2026-11-09' } } })).status, 403);
  assert.equal((await f.call(route(F.notifications) + '/' + own.id, { cookie, method: 'PATCH', body: { fields: { [F.nRead]: '2026-11-09' } } })).status, 200);
});

test('le nouveau rappel de bilan peut être créé une seule fois avec la clé liée au compte', async () => {
  const f = await fixture(), cookie = await f.login();
  const body = { performUpsert: { fieldsToMergeOn: [F.nKey] }, records: [{ fields: {
    [F.nKey]: f.b.alice.id + '|sikkum|' + f.b.classId, [F.nTeacher]: [f.b.alice.id],
    fld7tFpIv13V9b9pe: 'sikkum', [F.nSource]: f.b.classId,
    fldFYuRY1VXbVVSBA: 'Bilan à compléter', fldTqnZpcpjdtzm9P: JSON.stringify({classId:f.b.classId})
  } }] };
  assert.equal((await f.call(route(F.notifications), { cookie, method:'PATCH', body })).status, 200);
  assert.equal((await f.call(route(F.notifications), { cookie, method:'PATCH', body })).status, 200);
  assert.equal(f.b.data[F.notifications].length, 1);
});

test('un bilan peut être enregistré pour sa classe Complete, mais pas pour une classe en cours ou un autre professeur', async () => {
  const f = await fixture(), cookie = await f.login();
  const body = { records: [{ fields: { [F.rClass]: '101', [F.rTeacher]: f.b.alice.fields.Name, [F.rStudent]: 'Élève' } }] };
  assert.equal((await f.call(route(F.rapports), { cookie, method:'POST', body })).status, 200);
  f.b.data[F.classes][0].fields[F.classStatus] = 'In Progress';
  assert.equal((await f.call(route(F.rapports), { cookie, method:'POST', body })).status, 403);
  body.records[0].fields[F.rTeacher] = 'Other teacher';
  assert.equal((await f.call(route(F.rapports), { cookie, method:'POST', body })).status, 403);
});

test('la sauvegarde des présences contrôle le professeur et l’appartenance de l’élève à la classe', async () => {
  const f = await fixture(), cookie = await f.login();
  const body = { records: [{ fields: {
    fldS9wwl4L5TtJ44z: f.b.alice.fields.Name, fldVLXXtLgaVuEwAo: '101',
    fldB3PvFigjgvYmWM: ['recSSSSSSSSSSSSSS'], fld6XD60QTpapL0Jq: true
  } }] };
  assert.equal((await f.call(route(F.presence), { cookie, method:'POST', body })).status, 200);
  body.records[0].fields.fldB3PvFigjgvYmWM = ['recZZZZZZZZZZZZZZ'];
  assert.equal((await f.call(route(F.presence), { cookie, method:'POST', body })).status, 403);
});

test('les mutations intersites et la déconnexion sans origine sont refusées', async () => {
  const f = await fixture(), cookie = await f.login();
  assert.equal((await f.call('/api/session', { cookie, method: 'DELETE', origin: 'https://evil.test' })).status, 403);
  const response = await f.call('/api/session', { cookie, method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('la clé et les réponses privées d’Airtable ne sont jamais renvoyées en cas d’erreur', async () => {
  const f = await fixture(), cookie = await f.login();
  f.env.AIRTABLE_TOKEN = '';
  const response = await f.call(route(F.classes), { cookie });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(f.env.SESSION_SECRET));
});

test('le navigateur ne contient plus de clé Airtable ni d’appel direct à son API', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(/pat[A-Za-z0-9]{12,}\.[a-f0-9]{30,}/.test(html), false, 'Aucune clé Airtable dans le navigateur');
  assert.equal(/api\.airtable\.com/.test(html), false, 'Aucun accès direct à Airtable');
  assert.match(html, /\/api\/airtable\//);
});
