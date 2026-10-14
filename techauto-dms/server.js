// ============================================================
//  TECH'AUTO DMS — Serveur local (réseau du garage, 5 postes)
//  Aucune dépendance : Node.js 18+ suffit.  Lancement : node server.js
//
//  + API « externe » pour l'agent IA (n8n) : /api/ext/*
//    protégée par une clé (data/config.json) ; joignable depuis le
//    réseau du garage et depuis Tailscale (VPN privé du VPS n8n).
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Pieces = require('./pieces.js');

const PORT = process.env.PORT || 8080;
const DATA = process.env.TECHAUTO_DATA || path.join(__dirname, 'data');
const DBF = path.join(DATA, 'db.json');
const BACKUPS = path.join(DATA, 'sauvegardes');
const CONFIG = path.join(DATA, 'config.json');
const OUTBOX = path.join(DATA, 'evenements-en-attente.json');
fs.mkdirSync(BACKUPS, { recursive: true });

// --- État en mémoire (chargé depuis le disque) -----------------------------
let state = { version: 1, data: null };
if (fs.existsSync(DBF)) {
  try { state = JSON.parse(fs.readFileSync(DBF, 'utf8')); }
  catch (e) { console.error('⚠ db.json illisible — restaurez une sauvegarde du dossier data/sauvegardes'); process.exit(1); }
}

// --- Clé de l'API externe (créée au premier lancement, jamais dans db.json) --
let config = {};
if (fs.existsSync(CONFIG)) config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
if (!config.apiKey) {
  config.apiKey = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}

// Écriture atomique : on écrit un fichier temporaire puis on le renomme
// (si le courant saute pendant l'écriture, l'ancien fichier reste intact)
function save() {
  state.version++;
  const tmp = DBF + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DBF);
}

// Sauvegarde quotidienne automatique (une par jour, 60 jours conservés)
function backup() {
  if (!fs.existsSync(DBF)) return;
  const f = path.join(BACKUPS, 'db-' + new Date().toISOString().slice(0, 10) + '.json');
  if (!fs.existsSync(f)) fs.copyFileSync(DBF, f);
  const files = fs.readdirSync(BACKUPS).filter(x => x.startsWith('db-')).sort();
  while (files.length > 60) fs.unlinkSync(path.join(BACKUPS, files.shift()));
}
backup();
setInterval(backup, 3600 * 1000);

// --- Événements vers n8n (boîte d'envoi : rien ne se perd si Internet coupe) --
let outbox = [];
try { outbox = JSON.parse(fs.readFileSync(OUTBOX, 'utf8')); } catch (e) {}
const saveOutbox = () => fs.writeFileSync(OUTBOX, JSON.stringify(outbox));
function queueEvents(events) {
  if (!events || !events.length || !(state.data?.settings?.n8nWebhook)) return;
  outbox.push(...events.map(e => ({ ...e, id: crypto.randomUUID() })));
  if (outbox.length > 500) outbox = outbox.slice(-500);
  saveOutbox(); flushOutbox();
}
let flushing = false;
async function flushOutbox() {
  const url = state.data?.settings?.n8nWebhook;
  if (flushing || !url || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const ev = outbox[0];
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey }, body: JSON.stringify(ev), signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      outbox.shift(); saveOutbox();
    }
  } catch (e) { console.error('  n8n injoignable, nouvel essai dans 1 min :', e.message); }
  flushing = false;
}
setInterval(flushOutbox, 60 * 1000);

// Exécute une action métier (pieces.js) de façon atomique, puis sauvegarde :
// elle travaille sur une copie, qui ne remplace la base que si tout a réussi.
function action(name, args, ctx) {
  ctx.events = [];
  const copie = structuredClone(state.data);
  const result = Pieces.run(copie, name, args, ctx);
  state.data = copie;
  save();
  queueEvents(ctx.events);
  return result;
}

// --- Qui a le droit d'appeler quoi ? ----------------------------------------
const ipOf = req => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const isLocal = ip => ip === '127.0.0.1' || ip === '::1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const isTailscale = ip => { const m = ip.match(/^100\.(\d+)\./); return !!m && +m[1] >= 64 && +m[1] <= 127; };
const keyOk = req => {
  const k = String(req.headers['x-api-key'] || '');
  return k.length === config.apiKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(config.apiKey));
};
// Actions que l'agent a le droit de déclencher (réception et facturation restent au garage)
const EXT_ACTIONS = ['verifierOR', 'lancerRecherche', 'majBesoin', 'ajouterOffre', 'proposerCommande', 'validerCommande', 'annulerCommande', 'majRdv', 'rdvEntrant'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 80e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// --- API externe (n8n / agent IA) --------------------------------------------
async function ext(req, res, p, url) {
  if (!keyOk(req)) return send(res, 401, { error: 'clé API invalide' });
  if (!state.data) return send(res, 409, { error: 'base non initialisée' });
  const d = state.data, Q = k => url.searchParams.get(k) || '';
  const parts = p.split('/').slice(3);                       // /api/ext/<a>/<b>
  const liste = (k) => Q(k) ? Q(k).split(',') : null;

  if (req.method === 'GET') {
    if (parts[0] === 'ping') return send(res, 200, { ok: true, societe: d.settings.societe, version: state.version });
    if (parts[0] === 'stock') {
      const q = Pieces.norm(Q('q') || Q('ref'));
      const arts = (d.articles || []).filter(a => !q || [a.ref, a.refOrigine].some(x => Pieces.norm(x) === q) || Pieces.norm(a.designation).includes(q));
      return send(res, 200, arts.slice(0, 200).map(a => ({ ...a, dispo: Pieces.dispo(a) })));
    }
    if (parts[0] === 'or' && parts[1]) {
      const or = (d.documents || []).find(x => x.type === 'OR' && (x.id === parts[1] || x.numero === parts[1]));
      if (!or) return send(res, 404, { error: 'OR introuvable' });
      return send(res, 200, { ...Pieces.etatOR(d, or.id), client: (d.clients || []).find(c => c.id === or.clientId), vehicule: (d.vehicules || []).find(v => v.id === or.vehiculeId), lignes: or.lignes });
    }
    if (parts[0] === 'besoins' && parts[1]) {
      const b = (d.besoins || []).find(x => x.id === parts[1]);
      return b ? send(res, 200, Pieces.dossierBesoin(d, b)) : send(res, 404, { error: 'besoin introuvable' });
    }
    if (parts[0] === 'besoins') { const st = liste('statut'); return send(res, 200, (d.besoins || []).filter(b => !st || st.includes(b.statut))); }
    if (parts[0] === 'commandes') { const st = liste('statut'); return send(res, 200, (d.commandes || []).filter(c => !st || st.includes(c.statut))); }
    if (parts[0] === 'rdvs') { const dep = Q('depuis'); return send(res, 200, (d.rdvs || []).filter(r => !dep || (r.date || '') >= dep).map(r => ({ ...r, etat: Pieces.etatOR(d, r.orId) }))); }
    if (parts[0] === 'fournisseurs') return send(res, 200, { fournisseurs: d.settings.fournisseurs || [], stats: Pieces.statsFournisseurs(d) });
  }
  if (req.method === 'POST') {
    const b = await readBody(req);
    const ctx = { par: b.par || 'Agent n8n', source: 'api' };
    if (parts[0] === 'rdv') return send(res, 200, action('rdvEntrant', b.rdv || b, ctx));   // accepte aussi {action:'demande', rdv:{…}}
    if (parts[0] === 'action') {
      if (!EXT_ACTIONS.includes(b.name)) return send(res, 403, { error: 'action non autorisée pour l\'API : ' + b.name });
      return send(res, 200, { result: action(b.name, b.args, ctx), version: state.version });
    }
  }
  send(res, 404, { error: 'route inconnue' });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname, ip = ipOf(req);

    // ----- API externe : clé obligatoire -----
    if (p.startsWith('/api/ext/')) {
      if (!isLocal(ip) && !isTailscale(ip)) return send(res, 403, { error: 'réseau non autorisé' });
      return await ext(req, res, p, url);
    }
    // Le reste (écrans des postes, base complète) : réseau du garage uniquement
    if (!isLocal(ip)) return send(res, 403, { error: 'réservé au réseau du garage' });

    // ----- API -----
    if (p === '/api/db' && req.method === 'GET') return send(res, 200, state);
    if (p === '/api/version') return send(res, 200, { version: state.version });

    if (req.method === 'POST' && p.startsWith('/api/')) {
      const b = await readBody(req);

      if (p === '/api/init') {                 // premier lancement uniquement
        if (!state.data) { state.data = b.data; save(); }
        return send(res, 200, state);
      }
      if (p === '/api/replace') {              // restauration d'une sauvegarde
        backup();
        state.data = b.data; save();
        return send(res, 200, { version: state.version });
      }
      if (!state.data) return send(res, 409, { error: 'base non initialisée' });

      if (p === '/api/op') {                   // modification d'un enregistrement
        const d = state.data;
        if (b.op === 'upsert') {
          const arr = d[b.coll] || (d[b.coll] = []);
          const i = arr.findIndex(x => x.id === b.item.id);
          const item = b.coll === 'articles' ? Pieces.fusionArticle(arr[i], b.item) : b.item;   // réservations gérées ici
          if (i >= 0) arr[i] = item; else arr.push(item);
        } else if (b.op === 'delete') {
          d[b.coll] = (d[b.coll] || []).filter(x => x.id !== b.id);
        } else if (b.op === 'settings') {
          d.settings = b.settings;
        }
        save();
        if (b.op === 'settings') flushOutbox();
        return send(res, 200, { version: state.version });
      }
      if (p === '/api/action') {               // logique pièces / commandes / RDV (pieces.js)
        return send(res, 200, { result: action(b.name, b.args, { par: b.par || 'Poste', source: 'poste' }), version: state.version });
      }
      if (p === '/api/next') {                 // numérotation unique (factures, OR...)
        const key = b.type + b.year;
        const c = state.data.compteurs || (state.data.compteurs = {});
        c[key] = (c[key] || 0) + 1;
        save();
        return send(res, 200, { n: c[key], version: state.version });
      }
    }

    // ----- Fichiers -----
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    }
    if (p === '/pieces.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(__dirname, 'pieces.js')).pipe(res);
    }
    res.writeHead(404); res.end('Introuvable');
  } catch (e) {
    if (e.metier) return send(res, 400, { error: e.message });     // règle métier refusée (message lisible)
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  TECH\'AUTO DMS démarré ✔\n');
  console.log('  Sur ce poste      : http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || [])
      if (n.family === 'IPv4' && !n.internal)
        console.log((isTailscale(n.address) ? '  Pour n8n (VPN)    : http://' : '  Sur les 4 autres  : http://') + n.address + ':' + PORT);
  console.log('\n  Données : ' + DBF);
  console.log('  Clé API agent IA : dans ' + CONFIG + '\n  Ne fermez pas cette fenêtre.\n');
  flushOutbox();
});
