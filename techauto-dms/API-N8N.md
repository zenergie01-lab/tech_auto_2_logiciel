# TECH'AUTO DMS — API pour n8n et l'agent « Trouve-tout »

Le DMS reste sur le PC serveur du garage. n8n (VPS Hostinger) le joint par **Tailscale** : aucun port n'est ouvert sur la box.

```
Appli RDV (Vercel) ──► n8n (VPS) ◄── Tailscale ──► server.js (PC garage) ── data/db.json
                         ▲                              │
                         └──── événements (webhook) ────┘
```

## 1. Branchement (une fois)

1. **Tailscale** : installez-le sur le PC serveur et sur le VPS (même compte). Au démarrage, `demarrer.bat` affiche la ligne `Pour n8n (VPN) : http://100.x.y.z:8080`.
2. **Clé API** : elle est créée au premier lancement dans `data/config.json` (`apiKey`). Dans n8n, créez un identifiant **Header Auth** : nom `X-API-Key`, valeur = la clé.
3. **Événements** : dans le DMS, ouvrez Paramètres → 🤖 Pièces & agent, puis renseignez l'URL d'un nœud *Webhook* n8n (POST). Chaque événement arrive avec l'en-tête `X-API-Key` : vérifiez-le dans n8n.
4. **Sécurité** : l'API `/api/ext/*` exige la clé et n'accepte que le réseau du garage et Tailscale. Depuis Tailscale, les écrans et la base complète (`/api/db`) sont refusés.

## 2. Lire

| Requête | Réponse |
|---|---|
| `GET /api/ext/ping` | `{ok, societe, version}` |
| `GET /api/ext/stock?ref=410608481R` | articles (réf. fournisseur **ou réf. constructeur** exacte) avec `stock`, `reserve`, `dispo`, `attendu` |
| `GET /api/ext/or/{id ou numéro}` | état pièces de l'OR : `besoins`, `manquants`, `complet`, `date` (RDV possible), `texte`, `rdv`, `client`, `vehicule` |
| `GET /api/ext/besoins?statut=a_commander,recherche` | pièces à trouver |
| `GET /api/ext/besoins/{id}` | **dossier complet pour l'agent** : besoin, véhicule (VIN), OR, RDV, offres déjà reçues |
| `GET /api/ext/commandes?statut=proposee,validee` | commandes |
| `GET /api/ext/rdvs?depuis=2026-10-01` | RDV avec leur état pièces |
| `GET /api/ext/fournisseurs` | liste des fournisseurs + **délais réels constatés** |
| `GET /api/ext/planning?du=2026-10-14&au=…` | pour l'appli RDV : `mecanos[]`, `horaires`, `prestations`, `occupation[]` `{date, heure, duree, meca}`. **Aucune donnée client.** |
| `GET /api/ext/creneaux?date=…&duree=60&meca=` | créneaux libres d'un jour : `[{heure:'08:00', libres:[id mécano…]}]` |
| `GET /api/ext/prestations` | catalogue (durée, prix, pièces) |

## 3. Agir — `POST /api/ext/action`  `{name, args, par?}`

| `name` | `args` | Effet |
|---|---|---|
| `verifierOR` | `{orId}` | réserve ce qui est en stock ; le reste passe « à commander » |
| `lancerRecherche` | `{orId}` ou `{besoinIds:[…]}` | statut « recherche » + événement `trouve_tout.demande` |
| `majBesoin` | `{besoinId, refOrigine?, certitude?:{score, valide, sources:[…]}, statut?:'recherche'\|'a_confirmer'\|'a_commander', note?}` | résultat de l'identification |
| `ajouterOffre` | `{besoinId, fournisseur, prixHT, refOrigine, refFournisseur?, marque?, fraisPort?, delaiJours? ou dateLivraison?, source?(url), canal?, notes?}` | offre enregistrée ; `oeEcart:true` si la réf. OE diffère |
| `proposerCommande` | `{offreIds:[…]}` | commande(s) **proposée(s)**, regroupées par fournisseur |
| `validerCommande` | `{commandeId, par:"Nom de la personne", numeroFournisseur?}` | **validation humaine** (bouton WhatsApp relayé par n8n) ; `par` obligatoire |
| `annulerCommande` | `{commandeId, motif}` | annule et remet les pièces « à commander » |
| `majRdv` | `{orId, date?, heure?, statut?:'provisoire'\|'confirme'\|'a_decaler'\|'annule'}` | met à jour le RDV |

`POST /api/ext/rdv` reçoit **tel quel** l'envoi de l'appli RDV `{action:'demande', rdv:{ref, date, heure, client, tel, email, plaque, vehicule, km, prestation, prestaIds, meca, duree, symptome, mode, pieces:"HUILE-5W30 x5; FH-UNIV"}}`. Avec `prestaIds` (ids du catalogue), l'OR reçoit le forfait de chaque prestation et ses pièces (incluses à 0 €). Le RDV est placé chez `meca` s'il est libre, sinon chez le premier mécano libre, sinon « à placer ».

Le même `POST /api/ext/rdv` reçoit aussi le formulaire **« Être rappelé »** du site vitrine : `{action:'rappel', rappel:{nom, tel, vehicule, immat, presta, date, msg, recu_le}}` → liste « Demandes de rappel » du planning (sans doublon sur `recu_le`). Le DMS retrouve ou crée le client et le véhicule, crée l'OR avec les pièces, réserve ce qui est en stock, puis répond avec l'état des pièces et la date possible. Si la même `ref` est renvoyée, aucun doublon n'est créé.

Réservées au garage, ces actions ne passent pas par l'API : **réception** de marchandise, **facturation** et mouvements de stock.

Une erreur métier renvoie `400 {error:"message lisible"}`, par exemple « renseignez d'abord la référence constructeur (OE) exacte ».

## 4. Règles qui ne se contournent pas

- **La réf. constructeur (OE) fait foi.** Le stock est d'abord cherché par réf. OE exacte, et un article avec une réf. OE différente n'est jamais pris. On ne peut pas proposer de commande sans réf. OE sur le besoin, et une offre dont la réf. OE diffère est refusée.
- **Aucune commande sans un humain.** L'agent propose ; `validerCommande` exige le nom de la personne.
- **Opérations atomiques** : chaque action s'exécute en entier ou pas du tout. Les 5 postes et n8n ne peuvent pas s'écraser mutuellement les réservations.
- **Journal** : toute action de l'agent est tracée (onglet Commandes pièces → Journal, avec 🤖).

## 5. Événements envoyés au webhook n8n

Format : `{id, type, date, source:'poste'|'api', par, data}`. Une boîte d'envoi relance toutes les minutes si n8n est injoignable. **Ignorez `source:'api'`** si vous ne voulez pas réagir à vos propres actions.

| `type` | Quand | Usage n8n |
|---|---|---|
| `trouve_tout.demande` | un poste clique « 🔎 Lancer Trouve-tout » | lancer l'agent : `data.dossiers[]` (VIN, réf., qté, RDV), `data.fournisseurs`, `data.stats` |
| `commande.proposee` | offre choisie | WhatsApp au responsable pièces : boutons Valider / Refuser |
| `commande.validee` | validation humaine | e-mail ou WhatsApp au fournisseur ; `data.ors[]` donne au client sa **date possible** (`datePossible`, `client.tel`) |
| `commande.recue` | réception au garage | informer la secrétaire |
| `or.pieces_ok` | toutes les pièces de l'OR sont réservées | **confirmer le RDV** au client |
| `rdv.maj` | RDV modifié dans le DMS | répercuter dans l'appli RDV, SMS au client |
| `or.demarre` | le mécano démarre l'intervention (appli mécano) | facultatif : SMS « votre véhicule est pris en charge » |
| `or.termine` | le mécano appuie sur **Terminé** | **envoyer le SMS** : `data.sms.tel` et `data.sms.texte` (texte réglable dans Paramètres), `data.montantTTC`, `data.factureId` (brouillon au comptoir) |
| `or.signalement` | le mécano signale un travail supplémentaire | prévenir le chef d'atelier ; `data.signalement.texte`, `urgent` |
| `rappel.demande` | formulaire « Être rappelé » du site | prévenir l'accueil (WhatsApp) |

`source` vaut `'mecano'` pour les actions faites depuis la tablette (`par` = nom du mécano).

## 6. Brancher l'appli RDV

Dans `demo-rdv-techauto.html`, deux constantes sont vides :
- `SHEET_URL` : webhook n8n (POST) qui reçoit les demandes. Le **site vitrine** (`index.html`, constante `ENDPOINT`) peut utiliser le même : il envoie `action:'rappel'`.
- `PLANNING_URL` : webhook n8n (GET) qui relaie `GET /api/ext/planning`. Une fois renseignée, l'appli propose les **vrais créneaux libres** des mécanos et masque l'espace Secrétariat (le planning du secrétariat est dans le DMS).

Le workflow des demandes fait ensuite trois choses :
1. Il appelle `POST /api/ext/rdv` avec le corps reçu.
2. Il répond `{ok:true}` à la page. L'appli attend `j.ok`, et l'option CORS du webhook doit autoriser `https://techauto-one.vercel.app`.
3. Si `complet` est faux, il enchaîne sur `lancerRecherche` pour les pièces manquantes.

Les réf. pièces des prestations de l'appli (`HUILE-5W30`, `FH-UNIV`…) doivent exister dans le stock du DMS avec leur **réf. constructeur**. Sinon, la ligne passe « à commander » avec le libellé reçu.

## 7. Workflow prêt à importer : `n8n/techauto-liaison-dms.json`

Un seul workflow, trois entrées (n8n → Workflows → Import from file) :

| Entrée | URL de production | Rôle |
|---|---|---|
| A · `POST /webhook/rdv-techauto` | à coller dans `SHEET_URL` (appli RDV) et `ENDPOINT` (site vitrine) | transmet RDV et « Être rappelé » au DMS ; lance Trouve-tout si des pièces manquent ; répond `{ok}` à la page |
| B · `GET /webhook/planning-techauto` | à coller dans `PLANNING_URL` (appli RDV) | renvoie les vrais créneaux pris (aucune donnée client) |
| C · `POST /webhook/dms-evenements` | à coller dans DMS › Paramètres › Webhook n8n | `or.termine` → SMS « véhicule prêt » au client ; `or.signalement` → SMS au chef ; `rappel.demande` → SMS à l'accueil |

Avant d'activer :
1. **Identifiants** (Header Auth) : *TECH'AUTO DMS – clé API* (`X-API-Key` = `apiKey` de `data/config.json`, sert aussi à vérifier les appels du DMS sur l'entrée C) et *Brevo – clé API* (`api-key`).
2. Remplacer `IP-TAILSCALE-DU-PC` dans les 3 nœuds HTTP vers le DMS.
3. Renseigner les numéros du chef d'atelier et de l'accueil dans le nœud *Choisir le SMS* (vides = pas d'alerte).

Les numéros sont convertis au format international (0694… → 594694…, DOM et métropole). Autre fournisseur SMS que Brevo : seul le nœud *Envoyer le SMS* change. Pour régénérer le fichier après modification : `node n8n/generer-workflow.js`.
