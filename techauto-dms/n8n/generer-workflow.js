// Génère techauto-liaison-dms.json (workflow n8n à importer).  Lancement : node generer-workflow.js
// Écrit en JS plutôt qu'en JSON pour garder le code des nœuds lisible.
const fs = require('fs'), path = require('path');

const DMS = 'http://IP-TAILSCALE-DU-PC:8080';          // ← adresse « Pour n8n (VPN) » affichée par demarrer.bat
const ORIGINE = 'https://techauto-one.vercel.app';      // site qui a le droit de lire les réponses (CORS)
const CRED_DMS = { httpHeaderAuth: { name: "TECH'AUTO DMS – clé API" } };
const CRED_BREVO = { httpHeaderAuth: { name: 'Brevo – clé API' } };
const neverError = { response: { response: { fullResponse: true, neverError: true } }, timeout: 15000 };

let n = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) =>
  ({ id: `5e0c9b1a-0000-4000-8000-${String(++n).padStart(12, '0')}`, name, type: 'n8n-nodes-base.' + type, typeVersion, position, parameters, ...extra });
const respond = (name, position, body) => node(name, 'respondToWebhook', 1.1, position, {
  respondWith: 'json', responseBody: body,
  options: { responseHeaders: { entries: [{ name: 'Access-Control-Allow-Origin', value: ORIGINE }, { name: 'Cache-Control', value: 'no-store' }] } }
});

/* ---------------- A. Demandes de l'appli RDV et du site vitrine ---------------- */
const lireDemande = `// L'appli RDV envoie du texte (text/plain) pour éviter la pré-vérification CORS : on relit le JSON.
let b = $input.first().json.body;
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (b && typeof b === 'object' && !b.action && Object.keys(b).length === 1) {   // texte rangé comme une clé
  try { b = JSON.parse(Object.keys(b)[0]); } catch (e) {}
}
b = b || {};
const rappel = b.action === 'rappel';
return [{ json: {
  action: rappel ? 'rappel' : 'demande',
  corps: rappel ? { action: 'rappel', rappel: b.rappel || b } : { action: 'demande', rdv: b.rdv || b }
} }];`;

const A = [
  node('Demande RDV / rappel', 'webhook', 2.1, [0, 0], { httpMethod: 'POST', path: 'rdv-techauto', responseMode: 'responseNode', options: {} }, { webhookId: '7a1c2e40-5b3d-4f6e-9a01-1c2d3e4f5a61', onError: 'continueRegularOutput' }),
  node('Lire la demande', 'code', 2, [220, 0], { jsCode: lireDemande }),
  node('Envoyer au DMS', 'httpRequest', 4.2, [440, 0], {
    method: 'POST', url: `${DMS}/api/ext/rdv`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.corps) }}', options: neverError
  }, { credentials: CRED_DMS, onError: 'continueRegularOutput' }),
  node('Pièces manquantes ?', 'if', 2.2, [660, 0], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [
      { id: 'c1', leftValue: "={{ $json.statusCode === 200 && $('Lire la demande').first().json.action === 'demande' && !$json.body.deja && $json.body.complet === false && ($json.body.manquants || []).length > 0 }}", rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }
    ] }, options: {}
  }),
  node('Lancer Trouve-tout', 'httpRequest', 4.2, [880, -100], {
    method: 'POST', url: `${DMS}/api/ext/action`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify({ name: 'lancerRecherche', args: { orId: $json.body.orId }, par: 'Appli RDV (n8n)' }) }}", options: neverError
  }, { credentials: CRED_DMS, onError: 'continueRegularOutput' }),
  respond('Répondre à la page', [1100, 0], `={{ JSON.stringify((() => {
  const r = $('Envoyer au DMS').first().json;
  if (r.statusCode !== 200) return { ok: false, erreur: (r.body && r.body.error) || "L'atelier est injoignable" };
  const b = r.body || {};
  return { ok: true, numero: b.numero || '', complet: b.complet, datePossible: b.date || null };
})()) }}`)
];

/* ---------------- B. Planning public (créneaux libres pour l'appli RDV) ---------------- */
const B = [
  node('Planning public', 'webhook', 2.1, [0, 300], { httpMethod: 'GET', path: 'planning-techauto', responseMode: 'responseNode', options: {} }, { webhookId: '7a1c2e40-5b3d-4f6e-9a01-1c2d3e4f5a62', onError: 'continueRegularOutput' }),
  node('Lire le planning du DMS', 'httpRequest', 4.2, [220, 300], {
    method: 'GET', url: `=${DMS}/api/ext/planning?du={{ $json.query.du || $now.toFormat('yyyy-MM-dd') }}`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: neverError
  }, { credentials: CRED_DMS, onError: 'continueRegularOutput' }),
  respond('Répondre au site', [440, 300], "={{ JSON.stringify($json.statusCode === 200 ? $json.body : { mecanos: [], occupation: [], erreur: \"Planning de l'atelier injoignable\" }) }}")
];

/* ---------------- C. Événements envoyés par le DMS → SMS ---------------- */
const choisirSms = `// 🔧 RÉGLAGES — numéros qui reçoivent les alertes internes (laisser vide pour ne rien envoyer)
const NUMERO_CHEF = '';      // chef d'atelier : travaux signalés par un mécano
const NUMERO_ACCUEIL = '';   // accueil : demandes « Être rappelé » du site
const EXPEDITEUR = 'TECHAUTO'; // nom affiché sur le téléphone (11 caractères max, lettres et chiffres)

// 0694 12 34 56 → 594694123456 (format international attendu par Brevo, sans le +)
const PREFIXES = { '594': ['0594', '0694'], '590': ['0590', '0690', '0691'], '596': ['0596', '0696', '0697'], '262': ['0262', '0692', '0693', '0269', '0639'] };
function international(tel) {
  let d = String(tel || '').replace(/\\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) {
    const pays = Object.keys(PREFIXES).find(p => PREFIXES[p].some(x => d.startsWith(x))) || '33';
    d = pays + d.slice(1);
  }
  return d.length >= 11 ? d : '';
}

const ev = $input.first().json.body || {}, d = ev.data || {}, sms = [];
// SMS « véhicule prêt » : au Terminé si rien n'est à chiffrer, sinon quand le bureau confirme la facture
if (['or.termine', 'facture.confirmee'].includes(ev.type) && d.sms && d.sms.texte)
  sms.push({ tel: d.sms.tel, texte: d.sms.texte, tag: 'vehicule-pret' });
if (ev.type === 'or.signalement' && d.signalement)
  sms.push({ tel: NUMERO_CHEF, tag: 'atelier', texte: \`\${d.signalement.urgent ? '🚨 URGENT ' : ''}\${d.signalement.par} sur \${(d.vehicule || {}).immat || d.numero} : \${d.signalement.texte}. Devis à faire (DMS > Planning).\` });
if (ev.type === 'rappel.demande')
  sms.push({ tel: NUMERO_ACCUEIL, tag: 'rappel', texte: \`📞 Site web : rappeler \${d.nom || '?'} au \${d.tel}\${d.prestation ? ' (' + d.prestation + ')' : ''}\${d.message ? ' - ' + d.message : ''}\` });

// Les autres événements (rdv.maj, commande.*, trouve_tout.demande…) seront traités par les prochains workflows.
return sms.map(s => ({ json: { recipient: international(s.tel), content: s.texte.slice(0, 600), sender: EXPEDITEUR, tag: s.tag, evenement: ev.type, ref: d.numero || '' } }))
  .filter(x => x.json.recipient);`;

const C = [
  node('Événements du DMS', 'webhook', 2.1, [0, 560], { httpMethod: 'POST', path: 'dms-evenements', authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    { webhookId: '7a1c2e40-5b3d-4f6e-9a01-1c2d3e4f5a63', credentials: CRED_DMS }),
  node('Choisir le SMS', 'code', 2, [220, 560], { jsCode: choisirSms }),
  node('Envoyer le SMS (Brevo)', 'httpRequest', 4.2, [440, 560], {
    method: 'POST', url: 'https://api.brevo.com/v3/transactionalSMS/sms', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ type: 'transactional', sender: $json.sender, recipient: $json.recipient, content: $json.content, tag: $json.tag }) }}",
    options: { timeout: 15000 }
  }, { credentials: CRED_BREVO, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 })
];

const notes = [
  node('Notice', 'stickyNote', 1, [-420, -120], { width: 380, height: 820, content:
`## TECH'AUTO — Liaison DMS
**1. Identifiants** (Credentials → Header Auth)
- *TECH'AUTO DMS – clé API* : nom \`X-API-Key\`, valeur = \`apiKey\` de \`data/config.json\` sur le PC serveur
- *Brevo – clé API* : nom \`api-key\`, valeur = clé API Brevo (SMS)

**2. Adresse du DMS** : remplacer \`IP-TAILSCALE-DU-PC\` dans les 3 nœuds HTTP vers le DMS (ligne « Pour n8n (VPN) » de demarrer.bat)

**3. Numéros internes** : nœud *Choisir le SMS*

**4. Activer** le workflow, puis coller les URL de production :
- \`…/webhook/rdv-techauto\` → \`SHEET_URL\` (appli RDV) et \`ENDPOINT\` (site vitrine)
- \`…/webhook/planning-techauto\` → \`PLANNING_URL\` (appli RDV)
- \`…/webhook/dms-evenements\` → DMS › Paramètres › Webhook n8n` }),
  node('A', 'stickyNote', 1, [-20, -160], { width: 1260, height: 300, color: 5, content: '### A · RDV en ligne et « Être rappelé » → DMS (+ Trouve-tout si pièces manquantes)' }),
  node('B', 'stickyNote', 1, [-20, 180], { width: 640, height: 260, color: 4, content: "### B · Créneaux libres pour l'appli RDV (aucune donnée client)" }),
  node('C', 'stickyNote', 1, [-20, 460], { width: 640, height: 260, color: 6, content: '### C · Événements du DMS → SMS (véhicule prêt, travaux signalés, rappel)' })
];

const link = (...names) => Object.fromEntries(names.slice(0, -1).map((a, i) => [a, { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }]));
const connections = {
  ...link('Demande RDV / rappel', 'Lire la demande', 'Envoyer au DMS', 'Pièces manquantes ?'),
  'Pièces manquantes ?': { main: [[{ node: 'Lancer Trouve-tout', type: 'main', index: 0 }], [{ node: 'Répondre à la page', type: 'main', index: 0 }]] },
  'Lancer Trouve-tout': { main: [[{ node: 'Répondre à la page', type: 'main', index: 0 }]] },
  ...link('Planning public', 'Lire le planning du DMS', 'Répondre au site'),
  ...link('Événements du DMS', 'Choisir le SMS', 'Envoyer le SMS (Brevo)')
};

const wf = { name: "TECH'AUTO — Liaison DMS (RDV, planning, SMS)", nodes: [...notes, ...A, ...B, ...C], connections,
  settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' }, pinData: {} };
fs.writeFileSync(path.join(__dirname, 'techauto-liaison-dms.json'), JSON.stringify(wf, null, 2));
console.log('techauto-liaison-dms.json écrit (' + wf.nodes.length + ' nœuds)');
