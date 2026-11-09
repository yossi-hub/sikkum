import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

const GOOGLE_CLIENT_ID = '208792012375-tah7nn3utsgsnbgs9fv2ah5mr17qcr6n.apps.googleusercontent.com';
const DOMAIN = 'oulpanlavi.com';
const COOKIE = '__Host-lavi_session';
const SESSION_SECONDS = 60 * 86400;
const COURSES = 'appNbwmEyVQsXA25U';
const T = {
  teachers: 'tbl6i9FU406js7Edw', classes: 'tblTs7XeOJbkEcSf1',
  students: 'tblnFCt3Ne5oHwhlr', reports: 'tblpXR4YXdAhqlCqA',
  requests: 'tblB5HHBdDDQbn0Hc', attendance: 'tblDbn6AT04csXvWd',
  locations: 'tbl316ybnRhNr7SE0', absences: 'tblwISA3uDmqflwh4',
  settings: 'tbl4cWV4PlQ8NGslX', notifications: 'tblSGA8alJE5Reev4',
  applications: 'tbl6TtLej3NuJX3ea', history: 'tblaMErXMYZkVpyRD'
};
const SETTINGS_RECORD = 'recRw31i389hBWXsX';
const ADMIN_FIELD = 'fldPl4DXdbAKlf47Y';
const FIELD = {
  classNum: 'fldcKQPOroEmSYmwE', classStatus: 'fldwfIvxjy0RU9ske', classStudents: 'fldFgC40O96SCnZnG',
  reportTeacher: 'fldUqnBJ4rcoXUZw1', reportClass: 'fld5pPY7sfAzWNFJB',
  noteTeacher: 'fld7IGRMcTaWT1K7U', noteKey: 'fldgIP5cNkEC8zT9E',
  appTeacher: 'fldp7tNexDn8rkZfu', appEmail: 'fldL1PtYw5CCcK7WH',
  appKey: 'fld2Fcn3KYiZ0R27B', appAbsence: 'fld6TmPyz5al6IbPf',
  absenceTeacher: 'fldCVfLoV3TXvTycH', absenceClass: 'fld4ydS6ZndZyDcAk',
  presenceTeacher: 'fldS9wwl4L5TtJ44z', presenceClass: 'fldVLXXtLgaVuEwAo', presenceStudent: 'fldB3PvFigjgvYmWM'
};
const WRITABLE = {
  [T.reports]: ['fldv20CiFCcpI5D0a', 'fld5pPY7sfAzWNFJB', 'fldUqnBJ4rcoXUZw1', 'fldcnIaGnFqbmvgCk', 'fldBkPM3GLSEh9ocV', 'fldsjADeAmUvt8zvO', 'fldR4g4kg2q3t1BPr', 'fldMJlONdkB6SJANA', 'fldD7fivLb4cV91Uc', 'fldjrcq6Y3qfsICAi'],
  [T.attendance]: ['fldB3PvFigjgvYmWM','fldVLXXtLgaVuEwAo','fldMOUWRqgoR0rYe7','fld6XD60QTpapL0Jq','fldS9wwl4L5TtJ44z','flds4EL8IOmAg52LK','fldepIP0jRgERjfZW','fldTvwnoKFjh0a0sk'],
  [T.absences]: ['fldCVfLoV3TXvTycH','fld1RZ9dTN84WyRhT','fld4ydS6ZndZyDcAk','fldLGLrkDLTLd1voZ'],
  [T.notifications]: ['fldgIP5cNkEC8zT9E','fld7IGRMcTaWT1K7U','fld7tFpIv13V9b9pe','fldMrlkJ2iPyDsD53','fldFYuRY1VXbVVSBA','fldjy2TQ1RkBriSi3','fldTqnZpcpjdtzm9P','fldg3xnhx7w7iYEg1','fldFQ1qb22wDIO14z','fldkHzcfha3sSQdmg'],
  [T.applications]: ['fldtsbmrCSmGqC4Hb','fld2Fcn3KYiZ0R27B','fld6TmPyz5al6IbPf','fldp7tNexDn8rkZfu','fldL1PtYw5CCcK7WH','fldLUacaxlz2SJQwC','fld6cMZZ9VJfMPqJB','fldNZ5dy8hFX05C25','fldNu6pqmnKeXh4ty'],
  [T.settings]: ['fldfrqe9jhSeQ50vW', ADMIN_FIELD],
  [T.requests]: ['Teacher','המשך שיעורים קיימים','שיעורים שאינך רוצה להמשיך','מספר הכיתות הכולל','ימים מועדפים','ימים שאינם מתאימים','כל מה שחשוב לך לשתף']
};
// Field IDs are fixed server-side; the browser never selects another base or table.
const BASES = {
  [COURSES]: new Set(Object.values(T)),
  appkhAfrnk3fafBwM: new Set(['tblVpk0mZAYBAuCGG']),
  appDIFUhvkazrti2M: new Set(['tblnL1EXuEFAABbfY'])
};
const string = v => String(v ?? '').trim();
const quote = v => '"' + string(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const recordId = v => /^rec[A-Za-z0-9]{14}$/.test(v || '');
const linkedTo = (value, id) => Array.isArray(value) && value.length === 1 && value[0] === id;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function requireThat(condition, status = 403, message = 'Accès refusé.') {
  if (!condition) throw new HttpError(status, message);
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers
  } });
}
async function readBody(request) {
  requireThat(request.headers.get('content-type')?.startsWith('application/json'), 415, 'JSON requis.');
  const text = await request.text();
  requireThat(text.length <= 131072, 413, 'Requête trop volumineuse.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'JSON invalide.'); }
}
function sessionKey(env) {
  requireThat(typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32, 503, 'Service de connexion non configuré.');
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export function createGateway({ fetcher = globalThis.fetch, googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')) } = {}) {
  const identityCache = new Map();
  async function airtable(env, base, table, suffix = '', options = {}) {
    requireThat(!!env.AIRTABLE_TOKEN, 503, 'Accès aux données non configuré.');
    const response = await fetcher(`https://api.airtable.com/v0/${base}/${table}${suffix}`, {
      ...options, redirect: 'error', headers: {
        Authorization: 'Bearer ' + env.AIRTABLE_TOKEN, 'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, 'Service de données temporairement indisponible.');
    return response.json();
  }
  async function findTeacher(env, email) {
    const q = new URLSearchParams({ filterByFormula: `LOWER(TRIM({Email}))=${quote(email)}` });
    for (const field of ['Name', 'Email', 'Classes 5786']) q.append('fields[]', field);
    const { records = [] } = await airtable(env, COURSES, T.teachers, '?' + q);
    const matches = records.filter(r => string(r.fields.Email).toLowerCase() === email);
    requireThat(matches.length <= 1);
    if (!matches.length) return null;
    const r = matches[0];
    return { id: r.id, email, name: string(r.fields.Name), classIds: r.fields['Classes 5786'] || [] };
  }
  async function identity(env, email) {
    const key = env.AIRTABLE_TOKEN + '|' + email;
    const old = identityCache.get(key);
    if (old && old.until > Date.now()) return old.value;
    const [teacher, settings] = await Promise.all([
      findTeacher(env, email),
      airtable(env, COURSES, T.settings, `/${SETTINGS_RECORD}?returnFieldsByFieldId=true&fields%5B%5D=${ADMIN_FIELD}`)
    ]);
    const admins = string(settings.fields[ADMIN_FIELD]).toLowerCase().split(/[\s,;]+/);
    const isAdmin = email === 'yossi@oulpanlavi.com' || admins.includes(email);
    requireThat(!!teacher || isAdmin);
    const value = { email, teacher, isAdmin };
    // Bounded, short cache: role and class changes take effect within 30 seconds.
    if (identityCache.size >= 200) identityCache.clear();
    identityCache.set(key, { value, until: Date.now() + 30000 });
    return value;
  }
  async function readSession(request, env) {
    const token = request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    requireThat(!!token, 401, 'Connexion requise.');
    try {
      const { payload } = await jwtVerify(token, sessionKey(env), {
        algorithms: ['HS256'], issuer: 'lavi-app', audience: new URL(request.url).origin,
        requiredClaims: ['sub', 'email', 'iat', 'exp']
      });
      requireThat(typeof payload.email === 'string' && payload.email.endsWith('@' + DOMAIN), 401);
      return await identity(env, payload.email);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(401, 'Session expirée. Veuillez vous reconnecter.');
    }
  }
  async function session(request, env, url) {
    if (request.method === 'DELETE') return json({ ok: true }, 200, {
      'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    });
    if (request.method === 'GET') return json(await readSession(request, env));
    requireThat(request.method === 'POST', 405);
    const body = await readBody(request);
    requireThat(typeof body.credential === 'string' && body.credential.length < 12000, 400);
    let claims;
    try {
      const result = await jwtVerify(body.credential, googleKeys, {
        algorithms: ['RS256'], audience: GOOGLE_CLIENT_ID,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        requiredClaims: ['sub', 'email', 'email_verified', 'hd', 'iat', 'exp']
      });
      claims = result.payload;
    } catch { throw new HttpError(401, 'Connexion Google invalide ou expirée.'); }
    const email = string(claims.email).toLowerCase();
    requireThat(claims.email_verified === true && claims.hd === DOMAIN && email.endsWith('@' + DOMAIN));
    const user = await identity(env, email);
    const token = await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub).setIssuer('lavi-app').setAudience(url.origin)
      .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_SECONDS).sign(sessionKey(env));
    return json(user, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}` });
  }
  async function proxy(request, env, url, user) {
    const match = url.pathname.match(/^\/api\/airtable\/(app[A-Za-z0-9]{14})\/(tbl[A-Za-z0-9]{14})(?:\/(rec[A-Za-z0-9]{14}))?$/);
    requireThat(!!match, 404);
    const [, base, table, id] = match;
    requireThat(BASES[base]?.has(table));
    requireThat(['GET', 'POST', 'PATCH'].includes(request.method), 405);
    const target = string(request.headers.get('X-Lavi-Teacher')).toLowerCase();
    requireThat(!target || target === user.email || user.isAdmin);
    const teacher = target && target !== user.email ? await findTeacher(env, target) : user.teacher;
    const q = new URLSearchParams(url.search);
    for (const key of q.keys()) requireThat(['fields[]','filterByFormula','returnFieldsByFieldId','offset','view','pageSize','maxRecords'].includes(key) || /^sort\[\d+\]\[(field|direction)\]$/.test(key), 400);
    const single = async (record) => airtable(env, base, table, '/' + record + '?returnFieldsByFieldId=true');
    function constrain(formula) {
      const previous = q.get('filterByFormula');
      q.set('filterByFormula', previous ? `AND(${previous},${formula})` : formula);
    }
    if (request.method === 'GET') {
      if (table === T.teachers && !user.isAdmin) {
        const fields = q.getAll('fields[]');
        if (!fields.length || fields.some(f => !['Name','Email'].includes(f))) constrain(`LOWER(TRIM({Email}))=${quote(user.email)}`);
        requireThat(!id);
      }
      if ([T.notifications, T.reports, T.requests, T.applications].includes(table)) {
        requireThat(!!teacher);
        if (id) {
          const record = await single(id), f = record.fields;
          requireThat(table === T.notifications ? linkedTo(f[FIELD.noteTeacher], teacher.id) :
            table === T.reports ? f[FIELD.reportTeacher] === teacher.name :
            table === T.applications ? f[FIELD.appEmail] === teacher.email : f.Teacher === teacher.email);
          return json(record);
        }
        if (table === T.notifications) constrain(`LEFT({${FIELD.noteKey}},${teacher.id.length + 1})=${quote(teacher.id + '|')}`);
        if (table === T.reports) constrain(`{Prof}=${quote(teacher.name)}`);
        if (table === T.applications) constrain(`{${FIELD.appEmail}}=${quote(teacher.email)}`);
        if (table === T.requests) constrain(`{Teacher}=${quote(teacher.email)}`);
      }
      return json(await airtable(env, base, table, (id ? '/' + id : '') + (q.size ? '?' + q : '')));
    }
    requireThat(base === COURSES && !!WRITABLE[table]);
    requireThat(table !== T.settings || user.isAdmin);
    requireThat(table === T.settings || !!teacher);
    const body = await readBody(request);
    requireThat(body && typeof body === 'object' && !Array.isArray(body), 400);
    requireThat(Object.keys(body).every(k => ['records','fields','performUpsert','typecast','returnFieldsByFieldId'].includes(k)), 400);
    const rows = id ? [{ id, fields: body.fields }] : body.records;
    requireThat(Array.isArray(rows) && rows.length > 0 && rows.length <= 10, 400);
    requireThat(!id || !body.records, 400);
    if (body.performUpsert) {
      const mergeKey = table === T.notifications ? FIELD.noteKey : table === T.applications ? FIELD.appKey : null;
      requireThat(request.method === 'PATCH' && !id && !!mergeKey && linkedTo(body.performUpsert.fieldsToMergeOn, mergeKey));
    }
    const ownClasses = new Map();
    async function course(num) {
      if (!ownClasses.has(num)) {
        const cq = new URLSearchParams({filterByFormula:`{${FIELD.classNum}}=${quote(num)}`,returnFieldsByFieldId:'true'});
        const result = await airtable(env, COURSES, T.classes, '?' + cq);
        ownClasses.set(num, result.records || []);
      }
      return ownClasses.get(num);
    }
    for (const row of rows) {
      requireThat(row && (!row.id || recordId(row.id)) && row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields), 400);
      requireThat(Object.keys(row.fields).length > 0 && Object.keys(row.fields).every(f => WRITABLE[table].includes(f)));
      const f = row.fields;
      if (table === T.settings) {
        requireThat(request.method === 'PATCH' && row.id === SETTINGS_RECORD && !body.performUpsert);
      } else if (table === T.notifications) {
        requireThat(request.method === 'PATCH');
        if (row.id) {
          requireThat(Object.keys(f).every(k => ['fldFQ1qb22wDIO14z','fldkHzcfha3sSQdmg'].includes(k)));
          requireThat(linkedTo((await single(row.id)).fields[FIELD.noteTeacher], teacher.id));
        } else {
          requireThat(!!body.performUpsert && linkedTo(f[FIELD.noteTeacher], teacher.id) && string(f[FIELD.noteKey]).startsWith(teacher.id + '|'));
        }
      } else if (table === T.applications) {
        requireThat(request.method === 'PATCH' && !!body.performUpsert && !row.id && linkedTo(f[FIELD.appTeacher], teacher.id) && f[FIELD.appEmail] === teacher.email);
        const absence = f[FIELD.appAbsence]?.[0];
        requireThat(recordId(absence) && linkedTo(f[FIELD.appAbsence], absence) && f[FIELD.appKey] === absence + '|' + teacher.id);
      } else if (table === T.reports) {
        requireThat(!body.performUpsert && f[FIELD.reportTeacher] === teacher.name);
        const classes = await course(string(f[FIELD.reportClass]));
        requireThat(classes.some(c => teacher.classIds.includes(c.id) && c.fields[FIELD.classStatus] === 'Complete'));
        if (row.id) requireThat((await single(row.id)).fields[FIELD.reportTeacher] === teacher.name);
      } else if (table === T.attendance) {
        requireThat(!body.performUpsert && f[FIELD.presenceTeacher] === teacher.name);
        const classes = await course(string(f[FIELD.presenceClass]));
        requireThat(classes.some(c => ['In Progress','Complete'].includes(c.fields[FIELD.classStatus]) && linkedTo(f[FIELD.presenceStudent], f[FIELD.presenceStudent]?.[0]) && (c.fields[FIELD.classStudents] || []).includes(f[FIELD.presenceStudent][0])));
        if (row.id) {
          const old = (await single(row.id)).fields;
          requireThat(string(old[FIELD.presenceClass]) === string(f[FIELD.presenceClass]) && linkedTo(old[FIELD.presenceStudent], f[FIELD.presenceStudent][0]));
        }
      } else if (table === T.absences) {
        requireThat(request.method === 'POST' && !row.id && linkedTo(f[FIELD.absenceTeacher], teacher.id));
        requireThat(Array.isArray(f[FIELD.absenceClass]) && f[FIELD.absenceClass].length > 0 && f[FIELD.absenceClass].every(c => teacher.classIds.includes(c)));
      } else if (table === T.requests) {
        requireThat(request.method === 'POST' && !row.id && f.Teacher === teacher.email);
      }
    }
    return json(await airtable(env, base, table, id ? '/' + id : '', { method: request.method, body: JSON.stringify(body) }));
  }
  return async function handleRequest(request, env) {
    try {
      const url = new URL(request.url);
      requireThat(url.protocol === 'https:', 400, 'HTTPS requis.');
      requireThat(request.headers.get('sec-fetch-site') !== 'cross-site');
      if (!['GET','HEAD'].includes(request.method)) requireThat(request.headers.get('origin') === url.origin);
      if (url.pathname === '/api/session') return await session(request, env, url);
      const user = await readSession(request, env);
      return await proxy(request, env, url, user);
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : 'Service temporairement indisponible.' }, error instanceof HttpError ? error.status : 503);
    }
  };
}
