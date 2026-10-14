// ============================================================
//  TECH'AUTO DMS — Import de la base existante (clients, véhicules, pièces)
//  Usage :  node import.js modeles-import            (import réel)
//           node import.js modeles-import --test     (simulation, n'écrit rien)
//  ⚠ Le serveur (demarrer.bat) doit être ARRÊTÉ pendant l'import.
// ============================================================
const fs = require('fs');
const path = require('path');
const http = require('http');

const DIR = process.argv[2];
const TEST = process.argv.includes('--test');
const DBF = path.join(__dirname, 'data', 'db.json');

if (!DIR || !fs.existsSync(DIR)) {
  console.log('Usage : node import.js <dossier contenant les CSV> [--test]');
  process.exit(1);
}

// ---------- Lecture CSV (Excel FR : séparateur ; et encodage Windows) ----------
function readCSV(file) {
  const f = path.join(DIR, file);
  if (!fs.existsSync(f)) return null;
  const buf = fs.readFileSync(f);
  let txt;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { txt = buf.toString('latin1'); }                 // fichier enregistré par Excel « CSV (point-virgule) »
  txt = txt.replace(/^﻿/, '');
  const sep = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  // parseur qui gère les guillemets ("Rue des Palmiers; Bât. A")
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.filter(r => r.some(x => x.trim()))
    .map((r, i) => ({ _ligne: i + 2, ...Object.fromEntries(head.map((h, j) => [h, (r[j] || '').trim()])) }));
}

// ---------- Nettoyage des valeurs ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nombre = v => { if (v === undefined || v === '') return ''; const n = +String(v).replace(/\s|€/g, '').replace(',', '.'); return isNaN(n) ? '' : n; };
const date = v => {                                        // 25/03/2019 → 2019-03-25
  if (!v) return '';
  let m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
};
const immat = v => (v || '').toUpperCase().replace(/[\s-]/g, '');
const tel = v => (v || '').replace(/[^\d+]/g, '').replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
const g = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return ''; };

// ---------- Programme principal ----------
async function serveurActif() {
  return new Promise(res => {
    const rq = http.get('http://localhost:' + (process.env.PORT || 8080) + '/api/version', () => res(true));
    rq.on('error', () => res(false)); rq.setTimeout(1500, () => { rq.destroy(); res(false); });
  });
}

(async () => {
  if (!fs.existsSync(DBF)) { console.log('✖ data/db.json introuvable : lancez demarrer.bat une première fois, ouvrez l\'appli, puis arrêtez le serveur.'); process.exit(1); }
  if (!TEST && await serveurActif()) { console.log('✖ Le serveur tourne encore. Fermez la fenêtre de demarrer.bat puis relancez l\'import.'); process.exit(1); }

  const state = JSON.parse(fs.readFileSync(DBF, 'utf8'));
  const d = state.data;
  const rapport = { clients: [0, 0], vehicules: [0, 0], articles: [0, 0], erreurs: [] };
  const err = (fichier, ligne, msg) => rapport.erreurs.push(`${fichier} ligne ${ligne} : ${msg}`);

  // 1) CLIENTS — clé de rapprochement : code_client (n° de l'ancien logiciel)
  const clients = readCSV('clients.csv');
  if (clients) for (const r of clients) {
    const nom = g(r, 'nom', 'raison_sociale');
    if (!nom) { err('clients.csv', r._ligne, 'nom vide → ignorée'); continue; }
    const code = g(r, 'code_client', 'code', 'id');
    let c = code && d.clients.find(x => x.codeExterne === code);
    const val = { type: g(r, 'type') || 'Particulier', nom, prenom: g(r, 'prenom'), tel: tel(g(r, 'telephone', 'tel', 'portable')),
      email: g(r, 'email', 'mail').toLowerCase(), adresse: [g(r, 'adresse'), g(r, 'code_postal', 'cp'), g(r, 'ville')].filter(Boolean).join(' '),
      siret: g(r, 'siret'), notes: g(r, 'notes', 'commentaire'), codeExterne: code };
    if (c) { Object.assign(c, val); rapport.clients[1]++; }
    else { d.clients.push({ id: uid(), cree: new Date().toISOString().slice(0, 10), ...val }); rapport.clients[0]++; }
  }

  // 2) VÉHICULES — rattachés au client par code_client ; clé : immatriculation
  const vehicules = readCSV('vehicules.csv');
  if (vehicules) for (const r of vehicules) {
    const im = immat(g(r, 'immatriculation', 'immat', 'plaque'));
    if (!im) { err('vehicules.csv', r._ligne, 'immatriculation vide → ignorée'); continue; }
    const code = g(r, 'code_client', 'code', 'proprietaire');
    const cl = d.clients.find(x => x.codeExterne === code);
    if (!cl) { err('vehicules.csv', r._ligne, `${im} : client « ${code} » introuvable → ignorée`); continue; }
    let v = d.vehicules.find(x => x.immat === im);
    const val = { clientId: cl.id, immat: im, vin: g(r, 'vin', 'numero_de_serie', 'n_serie').toUpperCase(), marque: g(r, 'marque'), modele: g(r, 'modele'),
      energie: g(r, 'energie', 'carburant') || 'Diesel', mec: date(g(r, 'mise_en_circulation', 'mec', 'date_1ere_mise_en_circulation')), km: nombre(g(r, 'kilometrage', 'km')) };
    if (val.vin && val.vin.length !== 17) err('vehicules.csv', r._ligne, `${im} : VIN de ${val.vin.length} caractères (17 attendus) → importé quand même`);
    if (v) { Object.assign(v, val); rapport.vehicules[1]++; } else { d.vehicules.push({ id: uid(), ...val }); rapport.vehicules[0]++; }
  }

  // 3) ARTICLES (pièces) — clé : reference
  const articles = readCSV('articles.csv');
  if (articles) for (const r of articles) {
    const ref = g(r, 'reference', 'ref'), des = g(r, 'designation', 'libelle');
    if (!ref || !des) { err('articles.csv', r._ligne, 'référence ou désignation vide → ignorée'); continue; }
    let a = d.articles.find(x => x.ref === ref);
    const val = { ref, refOrigine: g(r, 'ref_origine', 'reference_origine', 'oem'), designation: des, famille: g(r, 'famille'), fournisseur: g(r, 'fournisseur'),
      emplacement: g(r, 'emplacement'), stock: nombre(g(r, 'stock', 'quantite')) || 0, stockMin: nombre(g(r, 'stock_min', 'stock_minimum')),
      pa: nombre(g(r, 'prix_achat', 'pa')) || 0, pv: nombre(g(r, 'prix_vente', 'pv')) || 0 };
    if (a) { Object.assign(a, val); rapport.articles[1]++; } else { d.articles.push({ id: uid(), ...val }); rapport.articles[0]++; }
  }

  // ---------- Rapport ----------
  console.log(`\n  ${TEST ? 'SIMULATION (rien n\'est écrit)' : 'IMPORT'} — TECH'AUTO DMS\n`);
  console.log(`  Clients   : ${rapport.clients[0]} créés, ${rapport.clients[1]} mis à jour${clients ? '' : '  (clients.csv absent)'}`);
  console.log(`  Véhicules : ${rapport.vehicules[0]} créés, ${rapport.vehicules[1]} mis à jour${vehicules ? '' : '  (vehicules.csv absent)'}`);
  console.log(`  Articles  : ${rapport.articles[0]} créés, ${rapport.articles[1]} mis à jour${articles ? '' : '  (articles.csv absent)'}`);
  console.log(`  Alertes   : ${rapport.erreurs.length}`);
  rapport.erreurs.slice(0, 30).forEach(e => console.log('   - ' + e));
  if (rapport.erreurs.length > 30) console.log(`   … et ${rapport.erreurs.length - 30} autres (voir import-rapport.txt)`);
  fs.writeFileSync(path.join(__dirname, 'import-rapport.txt'), rapport.erreurs.join('\n') || 'Aucune alerte');

  if (TEST) { console.log('\n  Tout est bon ? Relancez sans --test pour importer.\n'); return; }
  const bak = path.join(__dirname, 'data', 'sauvegardes', 'avant-import-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.copyFileSync(DBF, bak);
  state.version++;
  fs.writeFileSync(DBF + '.tmp', JSON.stringify(state)); fs.renameSync(DBF + '.tmp', DBF);
  console.log(`\n  ✔ Import terminé. Copie de sécurité : ${bak}\n  Relancez demarrer.bat.\n`);
})();
