const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const NOW = '2026-11-03T08:00:00.000Z';
const F = {
  teachers: 'tbl6i9FU406js7Edw', classes: 'tblTs7XeOJbkEcSf1',
  absences: 'tblwISA3uDmqflwh4', history: 'tblaMErXMYZkVpyRD',
  notifications: 'tblSGA8alJE5Reev4', applications: 'tbl6TtLej3NuJX3ea',
  students: 'tblnFCt3Ne5oHwhlr', presence: 'tblDbn6AT04csXvWd',
  pStudent: 'fldB3PvFigjgvYmWM', pClass: 'fldVLXXtLgaVuEwAo',
  pDate: 'fldMOUWRqgoR0rYe7', pPresent: 'fld6XD60QTpapL0Jq',
  pTeacher: 'fldS9wwl4L5TtJ44z', pChapter: 'flds4EL8IOmAg52LK',
  pLesson: 'fldepIP0jRgERjfZW', pMotif: 'fldTvwnoKFjh0a0sk',
  rapports: 'tblpXR4YXdAhqlCqA', rClass: 'fld5pPY7sfAzWNFJB',
  rTeacher: 'fldUqnBJ4rcoXUZw1', rStudent: 'fldv20CiFCcpI5D0a',
  absClass: 'fld4ydS6ZndZyDcAk', absDate: 'fld1RZ9dTN84WyRhT',
  absTeacher: 'fldCVfLoV3TXvTycH', replacement: 'fldpe4Y3zKJQCrMrK',
  num: 'fldcKQPOroEmSYmwE', level: 'fld2E7XYUsEBuPBPx', chapter: 'fldedo3AHC5u6o7pZ', hours: 'fldOT7CUfWymgpt6x',
  day: 'fldBQEy5J44zTUtbJ', site: 'fldaewXOB571FRk08',
  classStatus: 'fldwfIvxjy0RU9ske', classStudents: 'fldFgC40O96SCnZnG',
  hKey: 'fldfMRaqWZFEMv36M', hClass: 'fldd6JfbXm1gYJF4f',
  hDate: 'fld1AFy3hw88o9wqN', hName: 'fldXcijGPH04eNHrD',
  hEmail: 'fldb1c0Hdm3lSrcxb', hStatus: 'fldxjugPzel0mwARs',
  hChecked: 'fldBGRzkvTan14aPW', hResolved: 'fldqLE6Jp3weuAj4F',
  nKey: 'fldgIP5cNkEC8zT9E', nTeacher: 'fld7IGRMcTaWT1K7U',
  nType: 'fld7tFpIv13V9b9pe', nSource: 'fldMrlkJ2iPyDsD53',
  nRead: 'fldFQ1qb22wDIO14z', nClosed: 'fldkHzcfha3sSQdmg',
  cKey: 'fld2Fcn3KYiZ0R27B', cTeacher: 'fldp7tNexDn8rkZfu',
  cAbsence: 'fld6TmPyz5al6IbPf', cEmail: 'fldL1PtYw5CCcK7WH'
};

function makeBackend() {
  const id = letter => 'rec' + letter.repeat(14);
  const alice = { id: id('A'), fields: { Name: 'מורה לדוגמה', Email: 'alice@example.test' } };
  const beth = { id: id('D'), fields: { Name: 'Beth', Email: 'beth@example.test' } };
  const carol = { id: id('E'), fields: { Name: 'Carol', Email: 'carol@example.test' } };
  const classId = id('B'), offerId = id('C'), pastAbsenceId = id('F');
  const classFields = {
    [F.num]: '101', [F.level]: 'רמה ב', [F.chapter]: '4.2', [F.hours]: '18:00–20:00',
    [F.day]: 'יום שלישי', [F.site]: ['siteDemo'],
    [F.classStatus]: 'In Progress', [F.classStudents]: [id('S')],
    'Numéro de Classe': '101', 'Teacher en texte': 'Beth', Status: 'In Progress',
    Students: [id('S')]
  };
  const data = {
    [F.teachers]: [alice, beth, carol],
    [F.classes]: [{ id: classId, fields: classFields }],
    [F.absences]: [
      { id: offerId, createdTime: NOW, fields: {
        [F.absClass]: [classId], [F.absDate]: '2026-11-10', [F.absTeacher]: [beth.id]
      } },
      { id: pastAbsenceId, createdTime: NOW, fields: {
        [F.absClass]: [classId], [F.absDate]: '2026-11-01',
        [F.absTeacher]: [beth.id], [F.replacement]: [alice.id]
      } }
    ],
    [F.history]: [
      { id: id('G'), fields: { [F.hKey]: '101_2026-11-01', [F.hClass]: '101',
        [F.hDate]: '2026-11-01', [F.hName]: 'Beth', [F.hEmail]: 'beth@example.test',
        [F.hStatus]: 'Manquante', [F.hChecked]: '2026-11-03' } },
      { id: id('H'), fields: { [F.hClass]: '101', [F.hDate]: '2026-10-30',
        [F.hName]: alice.fields.Name, [F.hStatus]: 'À confirmer', [F.hChecked]: '2026-11-03' } },
      { id: id('I'), fields: { [F.hClass]: '101', [F.hDate]: '2026-10-25',
        [F.hName]: alice.fields.Name, [F.hStatus]: 'Saisie', [F.hChecked]: '2026-11-03' } }
    ],
    [F.notifications]: [], [F.applications]: [],
    [F.students]: [{ id: id('S'), fields: { Name: 'תלמיד לדוגמה' } }],
    [F.presence]: [], [F.rapports]: []
  };
  const backend = {
    data, alice, beth, carol, classId, offerId,
    visible: new Set([offerId]), calls: [], writes: [], candidateCreates: 0,
    failReads: false, throwAfterCandidateCommit: false, gate: null
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  backend.getAll = async function (_base, table, params = '') {
    backend.calls.push({ table, params });
    if (backend.gate && table === F.notifications) await backend.gate;
    if (backend.failReads) throw new Error('Network unavailable');
    const q = new URLSearchParams(params.replace(/^\?/, ''));
    let rows = data[table] || [];
    if (table === F.absences && q.get('view')) rows = rows.filter(r => backend.visible.has(r.id));
    const formula = q.get('filterByFormula') || '';
    const prefix = formula.match(/LEFT\([^,]+,\d+\)="([^"]*)"/);
    if (prefix) rows = rows.filter(r => String(r.fields[F.nKey] || '').startsWith(prefix[1]));
    const exact = formula.match(/^\{([^}]+)\}="([^"]*)"$/);
    if (exact) rows = rows.filter(r => String(r.fields[exact[1]] ?? r.fields[{ Prof: F.rTeacher, Classes: F.pClass }[exact[1]]] ?? '') === exact[2]);
    if (table === F.presence) {
      const date = formula.match(/IS_SAME\(\{Date\},"([^"]+)"/);
      if (date) rows = rows.filter(r => String(r.fields[F.pDate] || '').slice(0, 10) === date[1]);
      const classes = [...formula.matchAll(/\{Classes\}="((?:\\.|[^"\\])*)"/g)]
        .map(match => JSON.parse('"' + match[1] + '"'));
      if (classes.length) rows = rows.filter(r => classes.includes(String(r.fields[F.pClass])));
    }
    if (table === F.classes && formula.startsWith('OR(')) {
      rows = rows.filter(r => formula.includes(r.id));
    }
    return clone(rows);
  };
  backend.api = async function (_base, table, params = '', method = 'GET', body) {
    if (method === 'GET') {
      if (params.startsWith('/')) {
        const record = (data[table] || []).find(r => r.id === params.slice(1).split('?')[0]);
        if (!record) throw new Error('Missing record');
        return clone(record);
      }
      return { records: await backend.getAll(_base, table, params) };
    }
    backend.writes.push({ table, method, body: clone(body) });
    if (!data[table]) data[table] = [];
    const records = body.records || [{ id: params.slice(1), fields: body.fields }];
    const saved = [], created = [];
    for (const row of records) {
      const merge = body.performUpsert && body.performUpsert.fieldsToMergeOn;
      let record = row.id ? data[table].find(r => r.id === row.id) :
        merge ? data[table].find(r => merge.every(field => r.fields[field] === row.fields[field])) : null;
      if (!record) {
        record = { id: 'rec' + String(data[table].length + 1).padStart(14, '0'), fields: {}, createdTime: NOW };
        data[table].push(record);
        created.push(record.id);
        if (table === F.applications) backend.candidateCreates++;
      }
      Object.assign(record.fields, row.fields);
      saved.push(record);
    }
    if (table === F.applications && backend.throwAfterCandidateCommit) {
      backend.throwAfterCandidateCommit = false;
      throw new Error('Connection lost after commit');
    }
    return clone({ records: saved, createdRecords: created });
  };
  return backend;
}

function fakeDocument() {
  const elements = new Map();
  const doc = { hidden: false, activeElement: null, addEventListener() {}, querySelector() { return null; } };
  function element(id = '') {
    let contents = '';
    const classes = new Set();
    const el = {
      id, hidden: false, value: '', open: false, isConnected: true, style: {},
      handlers: {}, dataset: {}, scrollCount: 0,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x),
        contains: x => classes.has(x), toggle: x => classes.has(x) ? classes.delete(x) : classes.add(x) },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { this.handlers[name] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; this.handlers.close?.(); },
      remove() { elements.delete(this.id); }, focus() { doc.activeElement = this; },
      scrollIntoView() { this.scrollCount++; }, querySelector() { return null; },
      querySelectorAll() { return []; }, insertAdjacentHTML(_position, value) { this.innerHTML += value; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return contents; },
      set(value) {
        for (const match of contents.matchAll(/id=["']([^"']+)["']/g)) elements.delete(match[1]);
        contents = value;
        for (const match of value.matchAll(/id=["']([^"']+)["']/g)) {
          if (!elements.has(match[1])) elements.set(match[1], element(match[1]));
        }
      }
    });
    return el;
  }
  doc.getElementById = id => elements.get(id) || null;
  doc.createElement = () => element();
  doc.querySelectorAll = () => [];
  doc.body = { appendChild(el) { elements.set(el.id, el); } };
  for (const id of ['root', 'header-right', 'tabs-bar', 'tabs-content', 'remplacement-proposals',
    'notifications-bell', 'notifications-dot', 'tab-presence', 'tab-sikkum']) elements.set(id, element(id));
  return doc;
}

function loadApp(backend = makeBackend(), actor = backend.alice, now = NOW) {
  const NativeDate = Date;
  class Clock extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new NativeDate(now).getTime(); }
  }
  const document = fakeDocument();
  const sandbox = {
    document, Date: Clock, Intl, URLSearchParams, Set, Map, console: { warn() {} },
    setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    addEventListener() {}, scrollTo() {}, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    __getAll: backend.getAll, __api: backend.api, __actor: actor
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'notifications.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(source.replace(/\ninit\(\);\s*$/, '\n'), context);
  vm.runInContext(
    'api = __api; getAll = __getAll; loadLieuxMap = async () => ({siteDemo:"Paris — aperçu"});' +
    'state.teacher = {id:__actor.id,name:__actor.fields.Name,email:__actor.fields.Email,classIds:__actor.fields["Classes 5786"]||[]};',
    context
  );
  return { context, feature: context.LaviNotifications, document,
    evaluate(code) { return vm.runInContext(code, context); } };
}

function buildPreview(destination) {
  let source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  source = source.replace(/const AIRTABLE_KEY\s*=\s*'[^']*';/, "const AIRTABLE_KEY = 'fixture-token';")
    .replace(/<script src="https:\/\/accounts\.google\.com\/gsi\/client" async><\/script>/, '');
  const bootstrap = '<script>const F=' + JSON.stringify(F) + ';const NOW=' + JSON.stringify(NOW) + ';' +
    'const makeBackend=' + makeBackend.toString() + ';const previewBackend=makeBackend();' +
    'const RealDate=Date;window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return new RealDate(NOW).getTime();}};</script>';
  source = source.replace('<script src="notifications.js"></script>', bootstrap + '<script src="notifications.js"></script>');
  const setup =
    'api=previewBackend.api;getAll=previewBackend.getAll;loadLieuxMap=async()=>({siteDemo:"Paris — aperçu"});' +
    'state.teacher={id:previewBackend.alice.id,name:previewBackend.alice.fields.Name,email:previewBackend.alice.fields.Email,classIds:previewBackend.alice.fields["Classes 5786"]||[]};' +
    'renderTabsBar();renderHeaderUser(state.teacher);renderWelcome();';
  source = source.replace(/\ninit\(\);\s*<\/script>/, '\n' + setup + '\n</script>');
  source = source.replace('</body>', '<div style="position:fixed;bottom:0;left:0;right:0;background:#fff4d8;color:#735b11;text-align:center;font:12px sans-serif;padding:6px;z-index:999">Aperçu — données fictives, aucun e-mail envoyé</div></body>');
  if (/pat[A-Za-z0-9]{12,}\./.test(source)) throw new Error('A credential remains in the preview');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'index.html'), source);
  fs.copyFileSync(path.join(ROOT, 'notifications.js'), path.join(destination, 'notifications.js'));
}

module.exports = { makeBackend, loadApp, F, NOW, buildPreview };
if (require.main === module && process.argv[2] === '--preview') {
  buildPreview(process.argv[3]);
  console.log('Aperçu avec données fictives préparé.');
}
