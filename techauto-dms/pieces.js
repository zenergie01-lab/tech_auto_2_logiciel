// ============================================================
//  TECH'AUTO DMS — Logique pièces : réservations, besoins, offres,
//  commandes fournisseurs, réceptions, RDV.
//  Le même fichier tourne sur le serveur (server.js) et dans le
//  navigateur (mode autonome) : une seule règle de calcul partout.
//
//  Analogie : le stock est un compte en banque.
//   - stock    = le solde
//   - reserve  = les chèques déjà signés pour des OR (pas encore encaissés)
//   - dispo    = stock − reserve : ce qu'on peut encore promettre
//   - attendu  = les virements annoncés (commandes fournisseurs validées)
// ============================================================
(function (root) {
  const P = {};
  const num = x => +x || 0;
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const coll = (d, k) => d[k] || (d[k] = []);
  const fail = m => { const e = new Error(m); e.metier = true; throw e; };
  const addDays = (iso, n) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  function addJoursOuvres(iso, n) {                     // saute samedi et dimanche
    let x = iso;
    for (let i = 0; i < n;) { x = addDays(x, 1); const j = new Date(x + 'T12:00:00Z').getUTCDay(); if (j !== 0 && j !== 6) i++; }
    return x;
  }
  Object.assign(P, {num, today, uid, norm, addDays, addJoursOuvres});

  // Statuts d'un besoin (une pièce nécessaire à un OR)
  P.STATUTS = {
    a_verifier:  ['À vérifier', 't-warn'],
    reserve:     ['Réservée en stock', 't-ok'],
    a_commander: ['À commander', 't-bad'],
    a_confirmer: ['Réf. à confirmer', 't-warn'],
    recherche:   ['Trouve-tout cherche…', 't-blue'],
    offres:      ['Offres reçues', 't-blue'],
    commande:    ['Commandée', 't-acc'],
    sorti:       ['Sortie (facturée)', ''],
    libre:       ['Commande sans OR', '']
  };
  const A_TROUVER = ['a_commander', 'a_confirmer', 'recherche', 'offres'];
  P.A_TROUVER = A_TROUVER;

  P.dispo = a => num(a.stock) - num(a.reserve);

  function journal(d, ctx, action, details) {
    const j = coll(d, 'journal');
    j.push({id:uid(), date:new Date().toISOString(), par:ctx.par || '?', source:ctx.source || 'poste', action, details});
    if (j.length > 3000) j.splice(0, j.length - 3000);
  }
  function emit(ctx, type, data) { (ctx.events || (ctx.events = [])).push({type, date:new Date().toISOString(), source:ctx.source || 'poste', par:ctx.par || '', data}); }
  function mouvement(d, a, qte, motif, docId) {
    coll(d, 'mouvements').push({id:uid(), date:today(), articleId:a.id, qte, motif, docId:docId || ''});
  }
  P.next = function (d, type) {                         // même numérotation que /api/next
    const year = new Date().getFullYear(), c = d.compteurs || (d.compteurs = {}), k = type + year;
    c[k] = (c[k] || 0) + 1;
    return `${type}${year}-${String(c[k]).padStart(5, '0')}`;
  };

  // Un poste réenregistre un article : on garde les compteurs gérés par le serveur
  // et on applique la correction de stock en écart (évite d'écraser une sortie faite entre-temps).
  P.fusionArticle = function (old, item) {
    const n = {...item};
    n.reserve = old ? num(old.reserve) : num(item.reserve);
    n.attendu = old ? num(old.attendu) : num(item.attendu);
    if (old && item._base !== undefined && item._base !== '') n.stock = num(old.stock) + (num(item.stock) - num(item._base));
    delete n._base;
    return n;
  };

  // Un poste réenregistre un OR : on garde ce que l'atelier (appli mécano) a saisi entre-temps
  // (photos, prise en charge, compte rendu, opérations cochées, signalements, statut d'avancement).
  const CHAMPS_ATELIER = ['priseEnCharge', 'photos', 'compteRendu', 'signalements', 'debut', 'fin', 'terminePar'];
  P.fusionOR = function (old, item) {
    const n = {...item};
    if (old && old.type === 'OR') {
      for (const k of CHAMPS_ATELIER) if (old[k] !== undefined) n[k] = old[k];
      const faits = Object.fromEntries((old.lignes || []).filter(l => l.lid && l.fait).map(l => [l.lid, l]));
      n.lignes = (n.lignes || []).map(l => faits[l.lid] ? {...l, fait:true, faitPar:faits[l.lid].faitPar} : l);
      if (n._statutLu !== undefined && n.statut === n._statutLu) n.statut = old.statut;   // statut non touché au poste
    }
    delete n._statutLu;
    return n;
  };

  // Meilleur article du stock pour un besoin. La RÉFÉRENCE CONSTRUCTEUR (OE) fait foi :
  //  1. si le besoin a une réf. OE → uniquement les articles de même réf. OE exacte
  //     (un article dont la réf. OE est différente n'est jamais pris, même si la réf. fournisseur colle) ;
  //  2. sinon → id de l'article, puis réf. fournisseur exacte.
  const refOEConflit = (a, o) => o && a.refOrigine && norm(a.refOrigine) !== o;
  function articlePour(d, b) {
    const A = coll(d, 'articles'), r = norm(b.ref), o = norm(b.refOrigine);
    const best = c => c.sort((x, y) => P.dispo(y) - P.dispo(x))[0] || null;
    if (o) {
      const parOE = A.filter(a => norm(a.refOrigine) === o || (!a.refOrigine && norm(a.ref) === o));
      if (parOE.length) return parOE.find(a => a.id === b.articleId) || best(parOE);
    }
    if (b.articleId) { const a = A.find(x => x.id === b.articleId); if (a && !refOEConflit(a, o)) return a; }
    return r ? best(A.filter(a => norm(a.ref) === r && !refOEConflit(a, o))) : null;
  }
  P.refOEConflit = refOEConflit;
  P.articlePour = articlePour;

  function liberer(d, b) {
    if (b.statut !== 'reserve') return;
    const a = coll(d, 'articles').find(x => x.id === b.articleId);
    if (a) a.reserve = Math.max(0, num(a.reserve) - num(b.qte));
    b.statut = 'a_verifier'; b.reserveLe = '';
  }
  function retirerAttendu(d, b) {
    if (!b.attenduCompte) return;
    const a = coll(d, 'articles').find(x => x.id === b.articleId);
    if (a) a.attendu = Math.max(0, num(a.attendu) - num(b.qte));
    b.attenduCompte = false;
  }

  // Met les besoins d'un OR en phase avec ses lignes « Pièce »
  function syncBesoins(d, orId) {
    const or = coll(d, 'documents').find(x => x.id === orId && x.type === 'OR');
    const B = coll(d, 'besoins');
    const lignes = or && or.statut !== 'facture' ? (or.lignes || []).filter(l => l.type === 'PIECE' && l.lid && num(l.qte) > 0) : [];
    const v = or && coll(d, 'vehicules').find(x => x.id === or.vehiculeId);
    for (const l of lignes) {
      let b = B.find(x => x.orId === orId && x.lid === l.lid);
      const ident = {ref:l.ref || '', refOrigine:l.refOrigine || '', designation:l.designation || '', qte:num(l.qte)};
      if (!b) { b = {id:uid(), orId, lid:l.lid, articleId:l.articleId || '', statut:'a_verifier', cree:new Date().toISOString(), ...ident}; B.push(b); }
      else if (b.qte !== ident.qte || norm(b.ref) !== norm(ident.ref) || (l.articleId && l.articleId !== b.articleId)) {
        if (b.statut === 'commande') b.alerte = 'La ligne de l\'OR a changé après la commande : vérifier';
        else if (b.statut !== 'sorti') { liberer(d, b); Object.assign(b, ident, {articleId:l.articleId || '', statut:'a_verifier'}); }
      }
      Object.assign(b, {numeroOR:or.numero || '', clientId:or.clientId, vehiculeId:or.vehiculeId, immat:v ? v.immat : ''});
    }
    // Lignes supprimées de l'OR (ou OR supprimé / facturé)
    for (const b of B.filter(x => x.orId === orId)) {
      if (lignes.some(l => l.lid === b.lid) || b.statut === 'sorti') continue;
      if (b.statut === 'commande') { b.statut = 'libre'; b.ancienOrId = orId; b.orId = ''; continue; }   // la pièce arrivera en stock libre
      liberer(d, b);
      B.splice(B.indexOf(b), 1);
    }
  }

  // Réserve tout ce qui est disponible ; le reste passe « à commander »
  function reserverOR(d, orId, ctx) {
    const res = [];
    for (const b of coll(d, 'besoins').filter(x => x.orId === orId)) {
      const reverif = b.statut === 'a_verifier' || (A_TROUVER.includes(b.statut) && !b.commandeId);
      if (!reverif) continue;
      const a = articlePour(d, b);
      if (a && !b.refOrigine && a.refOrigine) b.refOrigine = a.refOrigine;      // la fiche article connaît la réf. OE
      if (a && P.dispo(a) >= b.qte) {
        a.reserve = num(a.reserve) + b.qte;
        Object.assign(b, {articleId:a.id, statut:'reserve', reserveLe:today(), dispoConstatee:''});
        res.push(`${b.ref || b.designation} ×${b.qte}`);
      } else {
        if (a) b.articleId = a.id;
        b.dispoConstatee = a ? P.dispo(a) : 0;
        if (b.statut === 'a_verifier') b.statut = 'a_commander';
      }
    }
    if (res.length) journal(d, ctx, 'reservation', `OR ${numeroOR(d, orId)} : ${res.join(', ')}`);
  }
  const numeroOR = (d, orId) => (coll(d, 'documents').find(x => x.id === orId) || {}).numero || orId;

  // Date à partir de laquelle toutes les pièces de l'OR seront au garage (+ marge réglable)
  P.datePossible = function (d, orId) {
    const bs = coll(d, 'besoins').filter(b => b.orId === orId && b.statut !== 'sorti');
    const marge = num((d.settings || {}).margeRdv ?? 1);
    if (bs.every(b => b.statut === 'reserve')) return {date:today(), complet:true, texte:bs.length ? 'Toutes les pièces sont réservées' : 'Aucune pièce nécessaire'};
    const sansCmd = bs.filter(b => b.statut !== 'reserve' && b.statut !== 'commande');
    if (sansCmd.length) return {date:null, complet:false, texte:`${sansCmd.length} pièce(s) pas encore commandée(s) : date inconnue`};
    let max = bs.filter(b => b.statut === 'commande').map(b => b.dateLivraisonPrevue || today()).sort().pop();
    const retard = max < today(); if (retard) max = today();
    return {date:addJoursOuvres(max, marge), complet:false, retard, texte:`Pièces attendues le ${max}${retard ? ' (livraison en retard)' : ''} + ${marge} j de marge`};
  };

  // Tout ce qu'il faut savoir d'un OR côté pièces (affichage et API)
  P.etatOR = function (d, orId) {
    const or = coll(d, 'documents').find(x => x.id === orId);
    const besoins = coll(d, 'besoins').filter(b => b.orId === orId);
    const rdv = coll(d, 'rdvs').find(r => r.orId === orId) || null;
    return {orId, numero:or ? or.numero : '', statutOR:or ? or.statut : 'supprime', rdv, besoins,
      manquants:besoins.filter(b => b.statut !== 'reserve' && b.statut !== 'sorti'), ...P.datePossible(d, orId)};
  };

  // Dossier complet envoyé à l'agent Trouve-tout pour un besoin
  P.dossierBesoin = function (d, b) {
    const or = coll(d, 'documents').find(x => x.id === b.orId) || {};
    const v = coll(d, 'vehicules').find(x => x.id === (or.vehiculeId || b.vehiculeId)) || {};
    const rdv = coll(d, 'rdvs').find(r => r.orId === b.orId) || null;
    const a = b.articleId ? coll(d, 'articles').find(x => x.id === b.articleId) : null;
    return {besoin:b, or:{id:or.id, numero:or.numero, activite:or.activite, notes:or.notes}, rdv,
      vehicule:{immat:v.immat, vin:v.vin, marque:v.marque, modele:v.modele, energie:v.energie, mec:v.mec, km:v.km},
      article:a ? {ref:a.ref, refOrigine:a.refOrigine, designation:a.designation, fournisseur:a.fournisseur, pa:a.pa} : null,
      offres:coll(d, 'offres').filter(o => o.besoinId === b.id)};
  };

  // Historique réel des fournisseurs (délai moyen constaté, retards)
  P.statsFournisseurs = function (d) {
    const s = {};
    for (const c of coll(d, 'commandes').filter(c => c.statut === 'recue' && c.dateCommande && c.recueLe)) {
      const k = c.fournisseur, x = s[k] || (s[k] = {nom:k, recues:0, joursTotal:0, retards:0});
      x.recues++; x.joursTotal += Math.max(0, Math.round((new Date(c.recueLe) - new Date(c.dateCommande)) / 864e5));
      if (c.dateLivraisonPrevue && c.recueLe > c.dateLivraisonPrevue) x.retards++;
    }
    return Object.values(s).map(x => ({...x, delaiMoyen:Math.round(x.joursTotal / x.recues * 10) / 10}));
  };

  function trouverBesoin(d, id) { const b = coll(d, 'besoins').find(x => x.id === id); if (!b) fail('Besoin introuvable : ' + id); return b; }
  function trouverCommande(d, id) { const c = coll(d, 'commandes').find(x => x.id === id); if (!c) fail('Commande introuvable : ' + id); return c; }
  const orsDeCommande = (d, c) => [...new Set(c.lignes.map(l => (coll(d, 'besoins').find(b => b.id === l.besoinId) || {}).orId).filter(Boolean))];

  /* ================= ACTIONS (appelées par les postes ou par n8n) ================= */
  const A = {};

  // Après chaque enregistrement d'OR : besoins à jour + réservation de ce qui est en stock
  A.verifierOR = (d, {orId}, ctx) => {
    if (!orId) fail('orId manquant');
    syncBesoins(d, orId); reserverOR(d, orId, ctx);
    const e = P.etatOR(d, orId);
    if (e.besoins.length && e.complet) emit(ctx, 'or.pieces_ok', {orId, numero:e.numero, rdv:e.rdv});
    return e;
  };
  A.libererOR = (d, {orId}, ctx) => { syncBesoins(d, orId); journal(d, ctx, 'liberation', `OR ${orId} : réservations libérées`); return true; };

  // Le poste (ou n8n) demande à l'agent de chercher les pièces manquantes
  A.lancerRecherche = (d, {orId, besoinIds}, ctx) => {
    const bs = coll(d, 'besoins').filter(b => (besoinIds ? besoinIds.includes(b.id) : b.orId === orId) && A_TROUVER.includes(b.statut) && !b.commandeId);
    if (!bs.length) fail('Aucune pièce à rechercher');
    bs.forEach(b => { b.statut = 'recherche'; b.rechercheLe = new Date().toISOString(); });
    emit(ctx, 'trouve_tout.demande', {dossiers:bs.map(b => P.dossierBesoin(d, b)), fournisseurs:(d.settings || {}).fournisseurs || [], stats:P.statsFournisseurs(d)});
    journal(d, ctx, 'trouve_tout', `${bs.length} pièce(s) envoyée(s) à l'agent : ${bs.map(b => b.ref || b.designation).join(', ')}`);
    return {envoyes:bs.length};
  };

  // Retour de l'agent sur l'identification de la référence
  A.majBesoin = (d, {besoinId, refOrigine, certitude, statut, note}, ctx) => {
    const b = trouverBesoin(d, besoinId);
    if (refOrigine) b.refOrigine = refOrigine;
    if (certitude) b.certitude = certitude;                 // {score, sources:[…], valide}
    if (note) b.note = note;
    if (statut) { if (!['recherche', 'a_confirmer', 'a_commander'].includes(statut)) fail('Statut non autorisé : ' + statut); if (!b.commandeId) b.statut = statut; }
    journal(d, ctx, 'besoin', `${b.ref || b.designation} (${b.numeroOR}) : ${statut || ''} ${note || ''}`.trim());
    return b;
  };

  // Une offre fournisseur (agent web, WhatsApp, ou saisie après un coup de fil)
  A.ajouterOffre = (d, o, ctx) => {
    const b = trouverBesoin(d, o.besoinId);
    if (!o.fournisseur) fail('Fournisseur obligatoire');
    if (!(num(o.prixHT) > 0)) fail('Prix HT obligatoire');
    const delai = o.delaiJours === '' || o.delaiJours == null ? null : num(o.delaiJours);
    const dateLivraison = o.dateLivraison || (delai != null ? addDays(today(), delai) : '');
    // La réf. constructeur annoncée par le fournisseur doit être celle du besoin
    const oeOffre = o.refOrigine || '', oeEcart = !!(oeOffre && b.refOrigine && norm(oeOffre) !== norm(b.refOrigine));
    const off = {id:uid(), besoinId:b.id, fournisseur:o.fournisseur, refFournisseur:o.refFournisseur || '', refOrigine:oeOffre, oeEcart, marque:o.marque || '',
      prixHT:num(o.prixHT), fraisPort:num(o.fraisPort), qte:b.qte, delaiJours:delai, dateLivraison, disponible:o.disponible !== false,
      source:o.source || '', canal:o.canal || (ctx.source === 'api' ? 'agent' : 'saisie'), notes:o.notes || '', certitude:o.certitude || null,
      coutTotal:Math.round((num(o.prixHT) * b.qte + num(o.fraisPort)) * 100) / 100, par:ctx.par || '', cree:new Date().toISOString()};
    coll(d, 'offres').push(off);
    if (['a_commander', 'recherche', 'a_confirmer'].includes(b.statut)) b.statut = 'offres';
    journal(d, ctx, 'offre', `${off.fournisseur} : ${b.ref || b.designation} ${off.prixHT} € HT, livré le ${dateLivraison || '?'}`);
    return off;
  };

  // Choisir une ou plusieurs offres → commande(s) « proposée(s) », regroupées par fournisseur
  A.proposerCommande = (d, {offreIds}, ctx) => {
    if (!offreIds || !offreIds.length) fail('Aucune offre choisie');
    const C = coll(d, 'commandes'), touchees = new Set();
    for (const id of offreIds) {
      const o = coll(d, 'offres').find(x => x.id === id); if (!o) fail('Offre introuvable : ' + id);
      const b = trouverBesoin(d, o.besoinId);
      if (b.statut === 'commande' || b.statut === 'reserve' || b.statut === 'sorti') fail(`${b.ref || b.designation} : déjà ${P.STATUTS[b.statut][0].toLowerCase()}`);
      if (!b.refOrigine) fail(`${b.ref || b.designation} : renseignez d'abord la référence constructeur (OE) exacte`);
      if (o.oeEcart) fail(`${o.fournisseur} propose la réf. OE ${o.refOrigine}, différente de ${b.refOrigine} : offre refusée`);
      const ancienne = b.commandeId && C.find(c => c.id === b.commandeId && c.statut === 'proposee');
      if (ancienne) { ancienne.lignes = ancienne.lignes.filter(l => l.besoinId !== b.id); if (!ancienne.lignes.length) C.splice(C.indexOf(ancienne), 1); }
      let c = C.find(x => x.statut === 'proposee' && x.fournisseur === o.fournisseur);
      if (!c) { c = {id:uid(), numero:'', fournisseur:o.fournisseur, statut:'proposee', lignes:[], proposeePar:ctx.par || '', cree:new Date().toISOString()}; C.push(c); }
      c.lignes.push({besoinId:b.id, offreId:o.id, ref:o.refFournisseur || b.ref, refOrigine:b.refOrigine, designation:b.designation, qte:b.qte,
        prixHT:o.prixHT, fraisPort:o.fraisPort, dateLivraison:o.dateLivraison, numeroOR:b.numeroOR, immat:b.immat});
      b.commandeId = c.id; b.offreChoisie = o.id;
      touchees.add(c);
    }
    for (const c of touchees) {
      c.dateLivraisonPrevue = c.lignes.map(l => l.dateLivraison).filter(Boolean).sort().pop() || '';
      c.totalHT = Math.round(c.lignes.reduce((s, l) => s + l.prixHT * l.qte, 0) * 100) / 100;
      c.fraisPort = Math.max(0, ...c.lignes.map(l => num(l.fraisPort)));   // un seul port par commande
    }
    journal(d, ctx, 'commande_proposee', [...touchees].map(c => `${c.fournisseur} (${c.lignes.length} ligne(s))`).join(', '));
    emit(ctx, 'commande.proposee', {commandes:[...touchees]});
    return [...touchees];
  };

  // Validation HUMAINE obligatoire (bouton du DMS, ou bouton WhatsApp relayé par n8n avec le nom de la personne)
  A.validerCommande = (d, {commandeId, numeroFournisseur, par}, ctx) => {
    const c = trouverCommande(d, commandeId);
    if (c.statut !== 'proposee') fail('Cette commande n\'est plus à valider');
    const qui = par || ctx.par;
    if (!qui || (ctx.source === 'api' && !par)) fail('Le nom de la personne qui valide est obligatoire');
    Object.assign(c, {statut:'validee', numero:c.numero || P.next(d, 'CMD'), valideePar:qui, dateCommande:today(), numeroFournisseur:numeroFournisseur || ''});
    for (const l of c.lignes) {
      const b = coll(d, 'besoins').find(x => x.id === l.besoinId); if (!b) continue;
      if (b.statut === 'reserve') liberer(d, b);
      b.statut = 'commande'; b.dateLivraisonPrevue = l.dateLivraison || c.dateLivraisonPrevue || '';
      const a = articlePour(d, b);
      if (a) { b.articleId = a.id; a.attendu = num(a.attendu) + b.qte; b.attenduCompte = true; }
    }
    const ors = orsDeCommande(d, c).map(orId => {
      const e = P.etatOR(d, orId), or = coll(d, 'documents').find(x => x.id === orId) || {}, cl = coll(d, 'clients').find(x => x.id === or.clientId) || {};
      return {orId, numero:e.numero, rdv:e.rdv, datePossible:e.date, texte:e.texte, client:{nom:`${cl.prenom || ''} ${cl.nom || ''}`.trim(), tel:cl.tel || '', email:cl.email || ''}};
    });
    const f = ((d.settings || {}).fournisseurs || []).find(x => x.nom === c.fournisseur) || {nom:c.fournisseur};
    journal(d, ctx, 'commande_validee', `${c.numero} ${c.fournisseur} validée par ${qui}`);
    emit(ctx, 'commande.validee', {commande:c, fournisseur:f, ors, garage:{societe:(d.settings || {}).societe, tel:(d.settings || {}).tel, email:(d.settings || {}).email}});
    return {commande:c, ors};
  };

  A.annulerCommande = (d, {commandeId, motif}, ctx) => {
    const c = trouverCommande(d, commandeId);
    if (!['proposee', 'validee'].includes(c.statut)) fail('Commande déjà ' + c.statut);
    for (const l of c.lignes) {
      const b = coll(d, 'besoins').find(x => x.id === l.besoinId); if (!b || b.commandeId !== c.id) continue;
      retirerAttendu(d, b);
      b.commandeId = ''; b.offreChoisie = ''; b.dateLivraisonPrevue = '';
      if (b.statut === 'libre') { const B = coll(d, 'besoins'); B.splice(B.indexOf(b), 1); continue; }
      if (b.statut === 'commande' || b.statut === 'offres') b.statut = coll(d, 'offres').some(o => o.besoinId === b.id) ? 'offres' : 'a_commander';
    }
    c.statut = 'annulee'; c.annuleeLe = today(); c.motifAnnulation = motif || '';
    journal(d, ctx, 'commande_annulee', `${c.numero || c.fournisseur} ${motif || ''}`);
    return c;
  };

  // Réception d'une commande : entrée en stock, puis réservation automatique pour l'OR qui l'attendait
  A.receptionnerCommande = (d, {commandeId, bl, date}, ctx) => {
    const c = trouverCommande(d, commandeId);
    if (c.statut !== 'validee') fail('Seule une commande validée peut être réceptionnée');
    const jour = date || today(), orsTouches = new Set();
    for (const l of c.lignes) {
      const b = coll(d, 'besoins').find(x => x.id === l.besoinId);
      let a = b ? articlePour(d, b) : articlePour(d, {ref:l.ref, refOrigine:l.refOrigine});
      if (!a) {                                            // pièce jamais stockée : on crée sa fiche article
        const or = b && coll(d, 'documents').find(x => x.id === (b.orId || b.ancienOrId));
        const lo = or && (or.lignes || []).find(x => x.lid === b.lid);
        a = {id:uid(), ref:l.ref || l.refOrigine, refOrigine:l.refOrigine || '', designation:l.designation, famille:'', fournisseur:c.fournisseur,
          emplacement:'', pa:l.prixHT, pv:lo ? lo.pu : '', stock:0, stockMin:'', reserve:0, attendu:0};
        coll(d, 'articles').push(a);
      }
      if (b) retirerAttendu(d, b);
      a.stock = num(a.stock) + num(l.qte); a.pa = l.prixHT;
      mouvement(d, a, num(l.qte), `Réception ${c.numero} ${c.fournisseur}${bl ? ' BL ' + bl : ''}`);
      if (b) {
        b.articleId = a.id; b.recuLe = jour;
        if (b.statut === 'commande' && b.orId) { a.reserve = num(a.reserve) + num(b.qte); b.statut = 'reserve'; b.reserveLe = jour; orsTouches.add(b.orId); }
        else if (b.statut === 'libre') { const B = coll(d, 'besoins'); B.splice(B.indexOf(b), 1); }
      }
    }
    Object.assign(c, {statut:'recue', recueLe:jour, bl:bl || ''});
    journal(d, ctx, 'reception', `${c.numero} ${c.fournisseur} reçue${bl ? ' (BL ' + bl + ')' : ''}`);
    emit(ctx, 'commande.recue', {commande:c});
    for (const orId of orsTouches) { const e = P.etatOR(d, orId); if (e.complet) emit(ctx, 'or.pieces_ok', {orId, numero:e.numero, rdv:e.rdv}); }
    return c;
  };

  // Réception « libre » (bouton 📥 du stock, sans commande enregistrée)
  A.receptionLibre = (d, {articleId, qte, pa, bl}, ctx) => {
    const a = coll(d, 'articles').find(x => x.id === articleId); if (!a) fail('Article introuvable');
    if (!(num(qte) > 0)) fail('Quantité invalide');
    a.stock = num(a.stock) + num(qte); if (pa !== '' && pa != null) a.pa = pa;
    mouvement(d, a, num(qte), 'Réception ' + (bl || ''));
    return a;
  };

  // Facture validée (sign −1) ou avoir validé (sign +1) : mouvements de stock + fin des réservations
  A.mouvementDocument = (d, {docId, sign}, ctx) => {
    const doc = coll(d, 'documents').find(x => x.id === docId); if (!doc) fail('Document introuvable');
    if (coll(d, 'mouvements').some(m => m.docId === docId)) return {deja:true};           // jamais deux fois
    const D = coll(d, 'documents');
    const orId = doc.type === 'FAC' ? doc.origineId : doc.type === 'AVO' ? (D.find(x => x.id === doc.origineId) || {}).origineId : '';
    const or = orId && D.find(x => x.id === orId && x.type === 'OR');
    const B = coll(d, 'besoins');
    for (const l of doc.lignes || []) {
      if (l.type !== 'PIECE') continue;
      const b = or && l.lid && B.find(x => x.orId === or.id && x.lid === l.lid);
      const a = coll(d, 'articles').find(x => x.id === (l.articleId || (b && b.articleId))); if (!a) continue;
      a.stock = num(a.stock) + sign * num(l.qte);
      mouvement(d, a, sign * num(l.qte), `${doc.type === 'FAC' ? 'Facture' : 'Avoir'} ${doc.numero}`, docId);
      if (sign < 0 && b && b.statut === 'reserve') { a.reserve = Math.max(0, num(a.reserve) - num(b.qte)); b.statut = 'sorti'; b.sortiLe = today(); }
    }
    if (sign < 0 && or) {                                  // l'OR est facturé : on libère ce qui reste
      for (const b of B.filter(x => x.orId === or.id && x.statut !== 'sorti')) {
        if (b.statut === 'commande') { b.statut = 'libre'; b.ancienOrId = or.id; b.orId = ''; continue; }
        liberer(d, b); B.splice(B.indexOf(b), 1);
      }
      const r = coll(d, 'rdvs').find(x => x.orId === or.id); if (r) r.statut = 'termine';
    }
    return {ok:true};
  };

  /* ================= PLANNING ATELIER (secrétariat, appli RDV, appli mécano) =================
     Le planning, c'est un parking : chaque mécanicien est une place, chaque RDV une voiture
     garée pour une durée. On ne gare jamais deux voitures sur la même place. */
  const pad2 = n => String(n).padStart(2, '0');
  P.hmin = h => { const m = String(h || '').match(/^\s*(\d{1,2})\s*[h:H]\s*(\d{0,2})/); return m ? +m[1] * 60 + (+m[2] || 0) : null; };
  P.hhmm = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  P.horaires = d => ((d.settings || {}).horaires || [[450, 720], [840, 1020]]);      // 7h30-12h, 14h-17h
  P.personnel = d => ((d.settings || {}).personnel || []).filter(p => p.actif !== false);
  P.mecanos = d => P.personnel(d).filter(p => p.planning);                            // colonnes du planning
  // Équipe au planning : Mécano 1 à 3 + chef d'atelier. Une base créée avec « Mécano 4 » passe sa colonne
  // et ses RDV au chef d'atelier (une seule fois). Renvoie true si la base a changé.
  P.migrerEquipe = d => {
    const s = d && d.settings; if (!s || !s.personnel || s.equipeChef) return false;
    const m4 = s.personnel.find(p => p.id === 'meca4' && p.nom === 'Mécano 4'), chef = s.personnel.find(p => p.id === 'chef');
    if (m4 && chef) { m4.actif = false; m4.planning = false; chef.planning = true; (d.rdvs || []).forEach(r => { if (r.meca === 'meca4') r.meca = 'chef'; }); }
    s.equipeChef = true; return true;
  };
  P.nomPers = (d, id) => (P.personnel(d).find(p => p.id === id) || {}).nom || '';
  const occupe = r => r.date && r.heure && r.meca && !['annule', 'absent'].includes(r.statut);
  P.occupe = occupe;
  P.conflit = (d, {date, heure, duree, meca, exclure}) => {
    const s2 = P.hmin(heure), d2 = num(duree) || 60;
    return coll(d, 'rdvs').find(r => r.id !== exclure && r.meca === meca && r.date === date && occupe(r) &&
      s2 < P.hmin(r.heure) + (num(r.duree) || 60) && P.hmin(r.heure) < s2 + d2) || null;
  };
  P.dansHoraires = (d, heure, duree) => { const s = P.hmin(heure); return s != null && P.horaires(d).some(([a, b]) => s >= a && s + (num(duree) || 60) <= b); };
  const jourOuvre = iso => { const j = new Date(iso + 'T12:00:00Z').getUTCDay(); return j !== 0 && j !== 6; };
  // Créneaux libres d'un jour : [{heure:'08:00', libres:[id mécano…]}]
  P.creneaux = (d, {date, duree, meca, pas, exclure}) => {
    const out = [], du = num(duree) || 60;
    if (!date || !jourOuvre(date)) return out;
    const ms = P.mecanos(d).filter(m => !meca || m.id === meca);
    for (const [a, b] of P.horaires(d)) for (let s = a; s + du <= b; s += num(pas) || 30) {
      const heure = P.hhmm(s), libres = ms.filter(m => !P.conflit(d, {date, heure, duree:du, meca:m.id, exclure})).map(m => m.id);
      if (libres.length) out.push({heure, libres});
    }
    return out;
  };
  // Prestations du catalogue citées par l'appli RDV (« Vidange + filtre + Recharge climatisation »)
  P.prestationsDe = (d, ids, texte) => {
    const cat = (d.settings || {}).prestations || [];
    if (ids && ids.length) return ids.map(id => cat.find(p => p.id === id)).filter(Boolean);
    const t = norm(texte);
    return t ? cat.filter(p => t.includes(norm(p.label))) : [];
  };
  P.totalTTC = doc => {
    const ht = (doc.lignes || []).reduce((s, l) => s + num(l.qte) * num(l.pu) * (1 - num(l.remise) / 100), 0);
    return Math.round(ht * (1 + num(doc.tva) / 100) * 100) / 100;
  };
  const gabarit = (txt, v) => String(txt || '').replace(/\{(\w+)\}/g, (m, k) => v[k] ?? '');
  const eurTxt = n => num(n).toFixed(2).replace('.', ',') + ' €';
  P.fmtImmat = i => { const n = norm(i); return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(n) ? `${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}` : String(i || ''); };
  function verifCreneau(d, r, forcer) {
    if (!occupe(r)) return;
    const c = P.conflit(d, {...r, exclure:r.id});
    if (c) fail(`${P.nomPers(d, r.meca) || 'Ce mécanicien'} est déjà pris à cette heure (${numeroOR(d, c.orId)} à ${c.heure.replace(':', 'h')})`);
    if (!forcer && !P.dansHoraires(d, r.heure, r.duree)) fail('Ce créneau sort des horaires de l\'atelier (ou déborde sur la pause)');
  }

  // Demande de RDV venant de l'application en ligne (même format que son envoi « demande »)
  // {ref, date, heure, client, tel, email, plaque, vehicule, km, prestation, symptome, mode, pieces:"REF x5; REF2"}
  // Depuis le planning du DMS : en plus {prestaIds:[…], meca, duree, canal:'telephone'}
  A.rdvEntrant = (d, r, ctx) => {
    if (!r || !r.date || !(r.plaque || r.immat)) fail('RDV incomplet : date et plaque obligatoires');
    const R = coll(d, 'rdvs'), ref = r.ref || r.idExterne || '';
    const deja = ref && R.find(x => x.idExterne === ref);
    if (deja) return {...P.etatOR(d, deja.orId), deja:true};
    const immat = norm(r.plaque || r.immat), telN = String(r.tel || '').replace(/\D/g, '').slice(-9);
    const V = coll(d, 'vehicules'), C = coll(d, 'clients');
    let v = V.find(x => norm(x.immat) === immat);
    let c = (v && C.find(x => x.id === v.clientId)) || (telN.length === 9 && C.find(x => String(x.tel || '').replace(/\D/g, '').slice(-9) === telN));
    let nouveauClient = false;
    if (!c) {
      const mots = String(r.client || r.nom || 'Client RDV').trim().split(/\s+/);
      c = {id:uid(), type:'Particulier', prenom:mots.length > 1 ? mots[0] : '', nom:(mots.length > 1 ? mots.slice(1) : mots).join(' ').toUpperCase(),
        tel:r.tel || '', email:r.email || '', adresse:'', notes:'Créé par la prise de RDV en ligne', cree:today()};
      C.push(c); nouveauClient = true;
    }
    if (!v) {
      const mv = String(r.vehicule || '').trim().split(/\s+/);
      v = {id:uid(), clientId:c.id, immat:P.fmtImmat(immat), vin:r.vin || '', marque:r.marque || mv[0] || '', modele:r.modele || mv.slice(1).join(' '), energie:'', mec:'', km:num(r.km) || ''};
      V.push(v);
    }
    if (num(r.km) > num(v.km)) v.km = num(r.km);
    const prestas = P.prestationsDe(d, r.prestaIds, r.prestation);
    // "REF x5; REF2" → lignes Pièce. Pièce d'une prestation au forfait : prix inclus (0 €), sauf « pièces en sus » (pneus…)
    const lignesPieces = (txt, inclus) => String(txt || '').split(';').map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.match(/^(.*?)(?:\s+x\s*([\d.,]+))?$/i), pref = m[1].trim(), qte = m[2] ? +m[2].replace(',', '.') : 1;
      const a = articlePour(d, {ref:pref});
      return {lid:uid(), type:'PIECE', ref:a ? a.ref : pref, refOrigine:a ? a.refOrigine || '' : '', designation:(a ? a.designation : pref) + (inclus ? ' (incluse au forfait)' : ''),
        qte, pu:inclus ? 0 : a ? num(a.pv) : 0, remise:0, articleId:a ? a.id : ''};
    });
    const lignes = prestas.length
      ? prestas.flatMap(p => [{lid:uid(), type:'FORF', ref:p.id, refOrigine:'', designation:p.label, qte:1, pu:num(p.prix), remise:0}, ...lignesPieces(p.pieces, !p.piecesEnSus)])
      : lignesPieces(r.pieces, false);
    const s = d.settings || {};
    const or = {id:uid(), type:'OR', numero:P.next(d, 'OR'), date:today(), clientId:c.id, vehiculeId:v.id, activite:r.activite || 'MECA', statut:'attente',
      lignes, km:num(r.km) || '', technicien:'', notes:[`${r.canal && r.canal !== 'en ligne' ? 'RDV ' + (r.canal === 'telephone' ? 'pris au téléphone' : r.canal) : 'RDV en ligne ' + ref} : ${r.prestation || prestas.map(p => p.label).join(' + ')}`.trim(), r.symptome ? 'Symptôme : ' + r.symptome : '', r.mode ? 'Mode : ' + (r.mode === 'attente' ? 'attend sur place' : r.mode === 'depot' ? 'dépose le véhicule' : r.mode) : ''].filter(Boolean).join('\n'),
      tva:s.tva || 0, origineId:'', creePar:r.canal && r.canal !== 'en ligne' ? ctx.par || 'Poste' : 'RDV en ligne', cree:new Date().toISOString()};
    coll(d, 'documents').push(or);
    // Place sur le planning : le mécano demandé s'il est libre, sinon le premier libre (sinon « à placer »)
    const heure = P.hmin(r.heure) != null ? P.hhmm(P.hmin(r.heure)) : '';
    const duree = num(r.duree) || prestas.reduce((s, p) => s + num(p.dur), 0) || 60;
    const libre = id => id && heure && !P.conflit(d, {date:r.date, heure, duree, meca:id});
    const meca = libre(r.meca) ? r.meca : (heure && !r.meca ? (P.mecanos(d).find(m => libre(m.id)) || {}).id || '' : '');
    if (r.meca && !meca) fail(`${P.nomPers(d, r.meca) || 'Ce mécanicien'} n'est plus libre à cette heure : choisissez un autre créneau`);
    const canal = r.canal || 'en ligne';
    const rdv = {id:uid(), orId:or.id, date:r.date, heure, duree, meca, statut:'provisoire', idExterne:ref,
      prestation:r.prestation || prestas.map(p => p.label).join(' + '), mode:r.mode || '', canal, cree:new Date().toISOString()};
    R.push(rdv);
    journal(d, ctx, 'rdv', `RDV ${ref} du ${r.date} ${heure} → ${or.numero} (${immat})${meca ? ' · ' + P.nomPers(d, meca) : ' · à placer'}${nouveauClient ? ', nouveau client' : ''}`);
    const e = A.verifierOR(d, {orId:or.id}, ctx);
    // Pris au téléphone avec toutes les pièces réservées → confirmé tout de suite. En ligne → le secrétariat confirme.
    if (canal !== 'en ligne' && e.complet && meca) rdv.statut = 'confirme';
    return {...e, rdv, clientId:c.id, vehiculeId:v.id, nouveauClient};
  };

  // Site vitrine : « Être rappelé » (pas encore un RDV : le secrétariat rappelle puis le place au planning)
  A.demandeRappel = (d, r, ctx) => {
    if (!r || String(r.tel || '').replace(/\D/g, '').length < 9) fail('Téléphone obligatoire');
    const L = coll(d, 'rappels'), cle = String(r.recu_le || r.ref || '');
    const deja = cle && L.find(x => x.cle === cle); if (deja) return deja;
    const x = {id:uid(), cle, nom:String(r.nom || r.client || '').trim(), tel:r.tel, vehicule:r.vehicule || '', immat:r.immat || r.plaque || '',
      prestation:r.presta || r.prestation || '', dateSouhaitee:r.date || '', message:r.msg || r.message || '', statut:'a_rappeler', recu:new Date().toISOString()};
    L.push(x); if (L.length > 500) L.splice(0, L.length - 500);
    journal(d, ctx, 'rappel', `Demande de rappel : ${x.nom} ${x.tel}`);
    emit(ctx, 'rappel.demande', x);
    return x;
  };
  A.traiterRappel = (d, {id, statut}, ctx) => {
    const x = coll(d, 'rappels').find(y => y.id === id); if (!x) fail('Demande introuvable');
    x.statut = statut || 'rappele'; x.traitePar = ctx.par; x.traiteLe = new Date().toISOString();
    return x;
  };

  /* ================= ATELIER : appli mécano ================= */
  const trouverOR = (d, orId) => {
    const o = coll(d, 'documents').find(x => x.id === orId && x.type === 'OR');
    if (!o) fail('OR introuvable'); if (o.statut === 'facture') fail('Cet OR est déjà facturé');
    return o;
  };
  const maintenant = () => new Date().toISOString();
  // Le mécano prend un véhicule non attribué
  A.prendreOR = (d, {orId}, ctx) => {
    const or = trouverOR(d, orId);
    if (or.technicien && or.technicien !== ctx.par) fail(`Déjà pris par ${or.technicien}`);
    or.technicien = ctx.par;
    const r = coll(d, 'rdvs').find(x => x.orId === orId);
    if (r && ctx.parId && P.mecanos(d).some(m => m.id === ctx.parId) && r.meca !== ctx.parId) {
      const avant = r.meca; r.meca = ctx.parId;
      if (P.conflit(d, {...r, exclure:r.id})) r.meca = avant;           // planning plein : on garde l'ancienne colonne
    }
    journal(d, ctx, 'atelier', `${or.numero} pris en charge par ${ctx.par}`);
    return {ok:true};
  };
  // Prise en charge (état des lieux) + début de l'intervention
  A.demarrerOR = (d, {orId, priseEnCharge}, ctx) => {
    const or = trouverOR(d, orId);
    if (or.statut === 'termine') fail('Intervention déjà terminée');
    if (priseEnCharge) {
      or.priseEnCharge = {...priseEnCharge, par:ctx.par, le:maintenant()};
      const km = num(priseEnCharge.km);
      if (km > num(or.km)) { or.km = km; const v = coll(d, 'vehicules').find(x => x.id === or.vehiculeId); if (v && km > num(v.km)) v.km = km; }
    }
    or.statut = 'en_cours'; or.debut = or.debut || maintenant();
    if (!or.technicien) or.technicien = ctx.par;
    journal(d, ctx, 'atelier', `${or.numero} : intervention démarrée par ${ctx.par}`);
    emit(ctx, 'or.demarre', {orId, numero:or.numero, par:ctx.par});
    return {ok:true};
  };
  // Opérations cochées, compte rendu, photos
  A.atelierMaj = (d, {orId, faits, compteRendu, photo, retirerPhoto, priseEnCharge}, ctx) => {
    const or = trouverOR(d, orId);
    if (faits) for (const l of or.lignes || []) if (l.lid in faits) { l.fait = !!faits[l.lid]; l.faitPar = l.fait ? ctx.par : ''; }
    if (compteRendu !== undefined) or.compteRendu = String(compteRendu).slice(0, 4000);
    if (priseEnCharge) or.priseEnCharge = {...(or.priseEnCharge || {}), ...priseEnCharge, par:ctx.par, le:maintenant()};
    if (photo) { or.photos = or.photos || []; or.photos.push({id:photo.id, fichier:photo.fichier, legende:photo.legende || '', type:photo.type || 'intervention', par:ctx.par, le:maintenant()}); }
    if (retirerPhoto) or.photos = (or.photos || []).filter(p => p.id !== retirerPhoto);
    return {ok:true};
  };
  // Travail supplémentaire constaté par le mécano → le secrétariat fait un devis
  A.signalerTravail = (d, {orId, texte, urgent, photoId}, ctx) => {
    const or = trouverOR(d, orId);
    if (!String(texte || '').trim()) fail('Décrivez le travail constaté');
    const s = {id:uid(), texte:String(texte).trim().slice(0, 1000), urgent:!!urgent, photoId:photoId || '', par:ctx.par, le:maintenant(), statut:'a_chiffrer'};
    or.signalements = or.signalements || []; or.signalements.push(s);
    const c = coll(d, 'clients').find(x => x.id === or.clientId) || {}, v = coll(d, 'vehicules').find(x => x.id === or.vehiculeId) || {};
    journal(d, ctx, 'atelier', `${or.numero} : ${ctx.par} signale « ${s.texte} »`);
    emit(ctx, 'or.signalement', {orId, numero:or.numero, signalement:s, client:{nom:`${c.prenom || ''} ${c.nom || ''}`.trim(), tel:c.tel || ''}, vehicule:{immat:v.immat, marque:v.marque, modele:v.modele}});
    return s;
  };
  A.traiterSignalement = (d, {orId, id, statut}, ctx) => {
    const or = coll(d, 'documents').find(x => x.id === orId); const s = or && (or.signalements || []).find(x => x.id === id);
    if (!s) fail('Signalement introuvable');
    s.statut = statut || 'traite'; s.traitePar = ctx.par; s.traiteLe = maintenant();
    return s;
  };
  // Le mécano ajoute ce qu'il a réellement fait (sans voir les prix) : pièce, main d'œuvre, autre
  const A_CHIFFRER = l => l.ajoutAtelier && !(num(l.pu) > 0);
  A.ajouterLigneAtelier = (d, {orId, type, designation, ref, qte}, ctx) => {
    const or = trouverOR(d, orId);
    if (or.statut === 'termine') fail('Intervention déjà terminée : prévenez le bureau');
    if (!['PIECE', 'MO', 'FORF'].includes(type)) fail('Type de ligne inconnu');
    if (!String(designation || '').trim() && !(type === 'PIECE' && ref)) fail('Décrivez la pièce ou l\'opération');
    const q = num(String(qte).replace(',', '.')) || 1;
    const a = type === 'PIECE' && ref ? articlePour(d, {ref}) : null;
    const taux = num(((d.settings || {}).taux || {})[or.activite || 'MECA']);
    const l = {lid:uid(), type, ref:a ? a.ref : String(ref || '').trim(), refOrigine:a ? a.refOrigine || '' : '',
      designation:String(designation || '').trim() || (a ? a.designation : String(ref)), qte:q,
      pu:type === 'MO' ? taux : a ? num(a.pv) : 0, remise:0, articleId:a ? a.id : '',
      fait:true, faitPar:ctx.par, ajoutAtelier:{par:ctx.par, le:maintenant()}};
    or.lignes = or.lignes || []; or.lignes.push(l);
    journal(d, ctx, 'atelier', `${or.numero} : ${ctx.par} ajoute « ${l.designation} » ×${q}`);
    if (type === 'PIECE') A.verifierOR(d, {orId}, ctx);                 // le stock réserve aussitôt la pièce
    return l;
  };
  A.retirerLigneAtelier = (d, {orId, lid}, ctx) => {
    const or = trouverOR(d, orId);
    if (or.statut === 'termine') fail('Intervention déjà terminée : prévenez le bureau');
    const l = (or.lignes || []).find(x => x.lid === lid);
    if (!l || !l.ajoutAtelier) fail('Seules les lignes ajoutées à l\'atelier peuvent être retirées ici');
    or.lignes = or.lignes.filter(x => x.lid !== lid);
    A.verifierOR(d, {orId}, ctx);                                        // rend la pièce au stock
    return {ok:true};
  };

  function smsPret(d, or, montant) {
    const s = d.settings || {}, c = coll(d, 'clients').find(x => x.id === or.clientId) || {}, v = coll(d, 'vehicules').find(x => x.id === or.vehiculeId) || {};
    const texte = gabarit(s.smsFin, {prenom:c.prenom || '', nom:c.nom || '', vehicule:`${v.marque || ''} ${v.modele || ''}`.trim() || 'véhicule',
      immat:P.fmtImmat(v.immat), montant:eurTxt(montant), societe:s.societe || '', tel:s.tel || ''});
    return {texte, tel:c.tel || '', le:maintenant(), via:s.n8nWebhook ? 'n8n' : 'aucun',
      client:{nom:`${c.prenom || ''} ${c.nom || ''}`.trim(), tel:c.tel || '', email:c.email || ''}, vehicule:{immat:v.immat || '', marque:v.marque || '', modele:v.modele || ''}};
  }

  // Bouton « Terminé » : OR terminé + « devis mis à jour » signalé au bureau.
  // SMS « véhicule prêt » tout de suite si rien n'est à chiffrer, sinon à la confirmation de la facture.
  A.terminerOR = (d, {orId, compteRendu}, ctx) => {
    const or = trouverOR(d, orId);
    if (!(or.lignes || []).length) fail('L\'OR ne contient aucune ligne : prévenez le secrétariat pour compléter avant de terminer');
    if (or.statut === 'termine') return {deja:true};
    if (compteRendu !== undefined) or.compteRendu = String(compteRendu).slice(0, 4000);
    or.statut = 'termine'; or.fin = maintenant(); or.terminePar = ctx.par;
    if (!or.technicien) or.technicien = ctx.par;
    const ajouts = or.lignes.filter(l => l.ajoutAtelier), aChiffrer = ajouts.filter(A_CHIFFRER);
    or.validationAtelier = {par:ctx.par, le:maintenant(), ajouts:ajouts.length, aChiffrer:aChiffrer.length};
    const r = coll(d, 'rdvs').find(x => x.orId === orId); if (r) { r.statut = 'termine'; r.maj = maintenant(); }
    const montant = P.totalTTC(or), sms = aChiffrer.length ? null : smsPret(d, or, montant);
    or.smsFin = sms ? {texte:sms.texte, tel:sms.tel, le:sms.le, via:sms.via} : {enAttente:true};
    journal(d, ctx, 'atelier', `${or.numero} terminé par ${ctx.par} → devis mis à jour (${ajouts.length} ajout(s), ${aChiffrer.length} à chiffrer)`);
    emit(ctx, 'or.termine', {orId, numero:or.numero, montantTTC:montant, par:ctx.par, ajouts:ajouts.length, aChiffrer:aChiffrer.length,
      client:sms && sms.client, vehicule:sms && sms.vehicule, sms:sms ? {tel:sms.tel, texte:sms.texte} : null});
    return {montantTTC:montant, ajouts:ajouts.length, aChiffrer:aChiffrer.length, smsEnvoye:!!sms && sms.via === 'n8n' && !!sms.tel};
  };

  // Bureau : la secrétaire vérifie le devis mis à jour, fixe les prix, et confirme en facture (numérotée, stock déduit)
  // lignes : {lid: {pu, qte, supprimer}}
  A.confirmerFacture = (d, {orId, lignes}, ctx) => {
    const or = trouverOR(d, orId), D = coll(d, 'documents');
    for (const [lid, m] of Object.entries(lignes || {})) {
      const l = (or.lignes || []).find(x => x.lid === lid); if (!l) continue;
      if (m.supprimer) { or.lignes = or.lignes.filter(x => x.lid !== lid); continue; }
      if (m.pu !== undefined && m.pu !== '') l.pu = num(m.pu);
      if (m.qte !== undefined && m.qte !== '') l.qte = num(m.qte);
    }
    if (!(or.lignes || []).length) fail('Aucune ligne à facturer');
    const reste = or.lignes.filter(A_CHIFFRER);
    if (reste.length) fail(`Prix manquant : ${reste.map(l => l.designation).join(', ')}`);
    A.verifierOR(d, {orId}, ctx);
    let f = D.find(x => x.type === 'FAC' && x.origineId === or.id);
    if (f && f.statut !== 'brouillon') fail('Facture déjà validée : ' + f.numero);
    if (!f) { f = {id:uid(), type:'FAC', origineId:or.id, creePar:ctx.par, cree:maintenant()}; D.push(f); }
    Object.assign(f, {numero:P.next(d, 'FAC'), date:today(), clientId:or.clientId, vehiculeId:or.vehiculeId, activite:or.activite, statut:'emise',
      lignes:or.lignes.map(({fait, faitPar, ajoutAtelier, ...l}) => ({...l})), km:or.km, technicien:or.technicien, notes:or.compteRendu || '', tva:or.tva, valideLe:maintenant()});
    A.mouvementDocument(d, {docId:f.id, sign:-1}, ctx);                  // sortie de stock + fin des réservations
    or.statut = 'facture';
    if (or.validationAtelier) or.validationAtelier.confirmePar = ctx.par;
    const montant = P.totalTTC(f);
    journal(d, ctx, 'facture', `${or.numero} → facture ${f.numero} ${eurTxt(montant)} confirmée par ${ctx.par}`);
    if (or.smsFin && or.smsFin.enAttente) {                               // SMS retenu tant que des ajouts étaient à chiffrer
      const sms = smsPret(d, or, montant);
      or.smsFin = {texte:sms.texte, tel:sms.tel, le:sms.le, via:sms.via};
      emit(ctx, 'facture.confirmee', {orId, numero:or.numero, factureId:f.id, facture:f.numero, montantTTC:montant, client:sms.client, vehicule:sms.vehicule, sms:{tel:sms.tel, texte:sms.texte}});
    }
    return {factureId:f.id, numero:f.numero, montantTTC:montant};
  };

  // RDV : date / heure / statut (provisoire, confirme, a_decaler, annule, termine)
  A.majRdv = (d, {orId, date, heure, statut, note, meca, duree, forcer}, ctx) => {
    const R = coll(d, 'rdvs');
    let r = R.find(x => x.orId === orId);
    if (!r) { if (!coll(d, 'documents').some(x => x.id === orId)) fail('OR introuvable'); r = {id:uid(), orId, statut:'provisoire', canal:'atelier', cree:new Date().toISOString()}; R.push(r); }
    if (statut && !['provisoire', 'confirme', 'a_decaler', 'annule', 'absent', 'termine'].includes(statut)) fail('Statut de RDV inconnu');
    if (date !== undefined) r.date = date;
    if (heure !== undefined) r.heure = P.hmin(heure) != null ? P.hhmm(P.hmin(heure)) : heure;
    if (meca !== undefined) r.meca = meca;
    if (duree !== undefined && duree !== '') r.duree = num(duree) || 60;
    if (statut) r.statut = statut;
    if (note !== undefined) r.note = note;
    if ([date, heure, meca, duree].some(x => x !== undefined) || ['provisoire', 'confirme'].includes(statut)) verifCreneau(d, r, forcer);
    r.maj = new Date().toISOString();
    journal(d, ctx, 'rdv', `${numeroOR(d, orId)} : RDV ${r.date || '?'} ${r.heure || ''} ${r.statut}${r.meca ? ' · ' + P.nomPers(d, r.meca) : ''}`);
    emit(ctx, 'rdv.maj', {rdv:r, etat:P.etatOR(d, orId)});
    return r;
  };

  P.actions = A;
  // Point d'entrée unique : exécute une action sur la base, ou lève une erreur métier
  P.run = function (d, name, args, ctx) {
    if (!Object.prototype.hasOwnProperty.call(A, name)) fail('Action inconnue : ' + name);
    return A[name](d, args || {}, ctx);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P; else root.Pieces = P;
})(this);
