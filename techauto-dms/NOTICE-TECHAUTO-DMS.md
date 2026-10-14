# TECH'AUTO DMS — Notice d'utilisation et d'installation

> Logiciel de gestion de garage (DMS) pour **TECH'AUTO, Kourou**.
> Activités couvertes : **Mécanique · Carrosserie · Vitrage · VN / VO**.
> Fonctionne **en local**, sur le réseau du garage, pour **5 postes**. Pas besoin d'Internet.
> Réalisé par **Automatisation Consciente**.

---

## Sommaire

1. [Le principe en une image](#1-le-principe-en-une-image)
2. [Ce que contient l'application](#2-ce-que-contient-lapplication)
3. [Contenu du dossier](#3-contenu-du-dossier)
4. [Installation (PC serveur + 4 postes)](#4-installation-pc-serveur--4-postes)
5. [Premiers réglages](#5-premiers-réglages)
6. [Le circuit d'un véhicule : cas pratique](#6-le-circuit-dun-véhicule--cas-pratique)
7. [Guide module par module](#7-guide-module-par-module)
8. [Pièces et catalogues externes (Cattronic…)](#8-pièces-et-catalogues-externes-cattronic)
9. [Importer la base de données existante](#9-importer-la-base-de-données-existante)
10. [Sauvegardes et sécurité des données](#10-sauvegardes-et-sécurité-des-données)
11. [Qui fait quoi dans le garage](#11-qui-fait-quoi-dans-le-garage)
12. [Dépannage](#12-dépannage)
13. [Limites actuelles et évolutions prévues](#13-limites-actuelles-et-évolutions-prévues)

---

## 1. Le principe en une image

> **Le PC serveur, c'est le tableau d'affichage de l'accueil. Les 4 autres postes sont des mécanos qui le regardent.**
> Quand quelqu'un écrit dessus, tout le monde le voit en **4 secondes**.

```
                 ┌──────────────────────────────┐
                 │  PC SERVEUR (reste allumé)   │
                 │  demarrer.bat → server.js    │
                 │  données : data/db.json      │
                 └──────────────┬───────────────┘
                     réseau du garage (box / Wi-Fi)
      ┌──────────────┬──────────┴───┬──────────────┐
   Accueil       Atelier 1      Atelier 2       Magasin pièces
  (navigateur)  (navigateur)   (navigateur)    (navigateur)
```

- **Une seule base de données**, sur le PC serveur. Pas de doublons, pas de fichiers Excel qui circulent.
- **Les autres postes n'installent rien** : ils ouvrent simplement une adresse dans Chrome ou Edge.
- **Numérotation unique garantie** : même si deux postes créent une facture à la même seconde, elles n'auront jamais le même numéro.

---

## 2. Ce que contient l'application

- **Clients, véhicules et historique d'entretien.**
- **Stock** : alertes de minimum, réceptions, import CSV de tarifs.
- **VN/VO** : marge et jours en stock, vente qui génère la facture de cession.
- **Véhicules de prêt.**
- **Règlements et impayés.**
- **Comptabilité** : journaux des ventes et des encaissements à exporter pour l'expert-comptable.
- **Statistiques** : entrées atelier, panier pièces moyen, CA par activité et par technicien, taux de transformation des devis.

Et, au cœur de tout ça :

- **La chaîne documentaire** : Devis → Ordre de réparation (OR) → Facture → Avoir, plus la Facture de cession pour les VN/VO.
- **L'atelier en temps réel** : un tableau à 3 colonnes (En attente / En cours / Terminé) partagé par les 5 postes.
- **Le chiffre d'affaires sur la page d'accueil** : jour, mois, année, graphique sur 12 mois, alertes.

---

## 3. Contenu du dossier

| Fichier / dossier | Rôle |
|---|---|
| `index.html` | L'application (l'écran que voient les 5 postes) |
| `server.js` | Le serveur local qui partage les données entre les postes |
| `mecano.html` | L'appli des mécaniciens (tablette / téléphone) : `http://IP-DU-SERVEUR:8080/mecano` |
| `pieces.js` | Les règles communes : stock réservé, commandes, planning, fin d'intervention |
| `demarrer.bat` | Double-clic pour lancer le serveur sous Windows |
| `import.js` | Script d'import de la base existante (clients, véhicules, pièces) |
| `modeles-import/` | 3 modèles CSV à remplir : `clients.csv`, `vehicules.csv`, `articles.csv` |
| `LISEZMOI.md` | Mémo d'installation rapide |
| `data/` | **Créé au premier lancement.** Contient la base `db.json` et les `sauvegardes/` |

> 💡 **Mode démo sans serveur** : ouvert seul (double-clic sur `index.html`), le logiciel fonctionne en **« mode autonome »**. Les données restent alors sur ce poste uniquement. C'est pratique pour une présentation, mais **pas pour l'usage réel**.

---

## 4. Installation (PC serveur + 4 postes)

### 4.1 Choisir le PC serveur
Prenez le PC qui **reste allumé toute la journée**, en général celui de l'accueil. C'est lui qui garde les données.

### 4.2 Installer Node.js (une seule fois)
1. Allez sur **https://nodejs.org** et cliquez sur le bouton **LTS**. Installez avec « Suivant, Suivant… ».
2. Ouvrez un terminal (touche Windows, tapez `cmd`, Entrée) et tapez :
   ```
   node -v
   ```
   **Résultat attendu :**
   ```
   v20.x.x    (ou un numéro plus élevé)
   ```

✅ **Point de contrôle 1** : un numéro de version s'affiche.

### 4.3 Installer le logiciel
1. Dézippez `techauto-dms.zip` dans **`C:\TECHAUTO\`**.
2. Double-cliquez sur **`demarrer.bat`**. Une fenêtre noire s'ouvre. **Résultat attendu :**
   ```
     TECH'AUTO DMS démarré ✔

     Sur ce poste      : http://localhost:8080
     Sur les 4 autres  : http://192.168.1.XX:8080

     Données : C:\TECHAUTO\techauto-dms\data\db.json
     Ne fermez pas cette fenêtre.
   ```
3. Si Windows affiche l'alerte du **pare-feu**, cochez **Réseau privé** puis cliquez sur **Autoriser l'accès**.
4. Notez l'adresse **`http://192.168.1.XX:8080`** : c'est celle des autres postes.

> ⚠ **Ne fermez jamais la fenêtre noire** pendant la journée. Si elle est fermée, les autres postes passent en rouge (« Serveur injoignable »).

✅ **Point de contrôle 2** : sur le PC serveur, ouvrez `http://localhost:8080`. Le voyant **vert « Connecté au serveur »** doit s'afficher en haut à droite.

### 4.4 Brancher les 4 autres postes
1. Ouvrez **Chrome ou Edge** à l'adresse `http://192.168.1.XX:8080`.
2. Ajoutez la page **en favori**, ou créez un raccourci sur le bureau.
3. Allez dans **Paramètres → « Nom du poste »** et nommez le poste (Accueil, Atelier 1, Atelier 2, Magasin…).

✅ **Point de contrôle 3** : les 5 postes affichent le voyant **vert** avec leur nom. Faites un test : créez un client sur un poste. Il doit apparaître sur un autre poste en moins de 5 secondes.

### 4.5 Rendre l'installation robuste (conseillé)
- **Démarrage automatique** : appuyez sur Win+R, tapez `shell:startup`, Entrée. Placez dans ce dossier un **raccourci** vers `demarrer.bat`.
- **Adresse IP fixe** : dans l'interface de la box, réservez une adresse (bail DHCP réservé) pour le PC serveur. Sinon, son adresse peut changer et les favoris des autres postes ne marchent plus.
- **Mise en veille** : désactivez la mise en veille automatique du PC serveur.

---

## 5. Premiers réglages

> **Paramètres → 👥 Équipe** : 4 mécanos, un chef d'atelier et un magasinier sont créés d'office. Renommez-les, réglez leur spécialité, cochez **Au planning** pour ceux qui ont une colonne. **Paramètres → 📅 Planning, prestations & SMS** : horaires (7h30-12h / 14h-17h), catalogue des prestations (durée, prix, pièces du stock) et texte du SMS « véhicule prêt ».

Menu **⚙️ Paramètres**, à faire **avant la première facture** :

| Réglage | À renseigner |
|---|---|
| Raison sociale, SIRET, adresse, téléphone, e-mail | Les vraies coordonnées de TECH'AUTO (elles s'impriment sur les documents) |
| **Taux de TVA** | **0 % par défaut** (Guyane), avec la mention « TVA non applicable — art. 294-1 du CGI ». **À faire confirmer par l'expert-comptable.** |
| **Taux horaires** par activité | Valeurs d'exemple : Méca 60 €, Carrosserie 65 €, Vitrage 55 €, VN/VO 60 €. **Mettez les vrais tarifs.** |
| Techniciens | La liste des mécaniciens, séparés par des virgules |
| Validité des devis | 30 jours par défaut |
| Conditions (bas de facture) | Texte légal ou commercial |
| Connecteurs pièces | Voir [section 8](#8-pièces-et-catalogues-externes-cattronic) |

> 🧪 **Pour s'entraîner** : bouton **« Charger des données de démo »**. Il ajoute 3 clients, 3 véhicules, 5 pièces, 1 VO et 1 véhicule de prêt, tous fictifs. **À ne pas faire sur la base réelle**, ou alors à supprimer ensuite.

---

## 6. Le circuit d'un véhicule : cas pratique

> **Analogie** : un dossier de réparation, c'est **un relais**. Le devis est le témoin. Il passe de main en main (secrétaire → chef d'atelier → mécano → secrétaire) **sans jamais être recopié**.

### Exemple : la Clio de Mme Brunet (plaquettes de frein)

```
 DEVIS  ──►  ORDRE DE RÉPARATION  ──►  FACTURE  ──►  ENCAISSEMENT
(en attente)  (attente→en cours→terminé) (brouillon→validée)  (CB, espèces…)
                                              │
                                              └──► AVOIR (si erreur / geste commercial)
```

| Étape | Qui | Action dans l'application |
|---|---|---|
| 1. Devis | Secrétaire | Accueil → **+ Devis**. Elle choisit la cliente (en tapant son nom ou son téléphone) et le véhicule. Elle ajoute **1 h de main d'œuvre** (le taux est rempli automatiquement) et les **plaquettes** prises dans le stock. Elle **imprime**, la cliente signe « Bon pour accord ». |
| 2. Accord | Secrétaire | Clic sur **➜ Transformer en OR**. Le devis passe en « Transformé », l'OR reçoit son numéro. |
| 3. Atelier | Chef d'atelier | Il affecte un **technicien** dans l'OR. Le véhicule apparaît sur l'écran **Atelier** de tous les postes. |
| 4. Travaux | Mécano | Il imprime la **🖨 Fiche atelier (sans prix)**, puis fait avancer la carte avec ▶ : *En attente → En cours → Terminé*. |
| 5. Prêt (option) | Secrétaire | Dans l'OR : **🔑 Véhicule de prêt**. Elle note le km et le carburant au départ. |
| 6. Facture | Secrétaire | Clic sur **➜ Facturer**. Une facture **brouillon** est préparée avec les lignes de l'OR. Elle vérifie, puis **✔ Valider la facture**. |
| 7. Paiement | Secrétaire | Clic sur **💶 Encaisser** et choix du mode : CB, espèces, chèque ou virement. Le paiement partiel est possible. |

**Ce qui se passe automatiquement à la validation de la facture :**
- elle reçoit un **numéro définitif** (ex. `FAC2026-00012`), sans trou dans la numérotation ;
- elle devient **non modifiable** (obligation légale) ;
- les **pièces sortent du stock** ;
- l'OR passe en « Facturé » et disparaît du tableau Atelier ;
- le **kilométrage du véhicule** est mis à jour ;
- le **CA du jour** se met à jour sur la page d'accueil.

> ❗ **Une facture validée ne se modifie plus.** Pour corriger une erreur, faites un **↩ Avoir** depuis la facture : il copie les lignes, vous retirez ce qui ne doit pas être remboursé, puis vous validez. L'avoir remet les pièces en stock.

**La facture « comptoir »** : pour une vente de pièce sans passage à l'atelier, utilisez Accueil → **+ Facture comptoir**.

---

## 7. Guide module par module

### 🏠 Accueil — le tableau de bord
- **CA atelier HT** du jour, du mois et de l'année. Les avoirs sont déduits.
- **Ventes VN/VO** du mois.
- Véhicules à l'atelier, devis en attente, **impayés**, véhicules de prêt sortis.
- **Graphique du CA sur 12 mois.**
- Listes : véhicules en cours, **stock sous le minimum**, **prêts en cours** (avec retards en rouge).
- Boutons rapides : + Devis, + OR, + Facture comptoir.

### 📅 Planning RDV — secrétariat et chef d'atelier
Le planning, c'est un parking : **une colonne par mécanicien**, un bloc par rendez-vous. On ne gare jamais deux voitures sur la même place : le logiciel refuse tout chevauchement et tout débordement sur la pause.
- **Prendre un RDV** : cliquez une case vide (ou « + Nouveau RDV »). Tapez la plaque : un client déjà venu est reconnu. Cochez les prestations : la durée se calcule, seules les heures libres sont proposées.
- **Le stock décide** : si toutes les pièces sont réservées, le RDV est **confirmé**. S'il en manque, il reste **à confirmer** (jaune) et la fiche propose **🔎 Lancer Trouve-tout**.
- **Couleurs** : 🟡 à confirmer · 🔵 confirmé · 🟠 en cours (le mécano a démarré) · 🟢 prêt à encaisser · gris = facturé.
- **Cliquer un bloc** : confirmer, déplacer (autre heure, autre jour, autre mécano), marquer absent ou annuler, voir les photos de l'atelier, **ouvrir la facture**.
- **Bandeau « À traiter »** en haut :
  - ✅ **Véhicules prêts — à encaisser** : le mécano a appuyé sur « Terminé ». La facture est préparée en brouillon : vérifiez, **validez**, encaissez.
  - 🔧 **Travaux signalés par l'atelier** : bouton **Devis** (le devis s'ouvre avec le constat du mécano).
  - 📞 **Demandes de rappel** du site vitrine : rappeler, puis **Placer** au planning.
  - 🌐 **RDV en ligne à confirmer**.
- Des **annonces sonores** s'affichent en bas à droite sur tous les postes : véhicule terminé, travail signalé, nouvelle demande.

### 📱 Appli mécano (tablette ou téléphone)
Sur le Wi-Fi du garage, ouvrez `http://IP-DU-SERVEUR:8080/mecano` (adresse affichée par `demarrer.bat`), puis « Ajouter à l'écran d'accueil ».
1. **Connexion** : toucher son nom, taper son code à 4 chiffres (**0000** la première fois, puis chacun choisit le sien). Le code se change aussi dans Paramètres → Équipe → 🔑.
2. **Mes véhicules** : les RDV du jour du mécano, plus « À prendre » (véhicules sans mécano). Le chef d'atelier voit tout l'atelier.
3. **Prise en charge** : kilométrage, carburant, contrôles à l'arrivée, remarques et **photos de l'état** → **▶ Démarrer**. Le planning passe en orange.
4. **Intervention** : cocher chaque opération, **📷 photos** (pièce usée, travail fini), compte rendu, **⚠ Signaler un travail supplémentaire** (arrive tout de suite au secrétariat), **🔎 Pièce manquante** (prévient le magasin / Trouve-tout).
5. **✅ Terminé — véhicule prêt** : en un geste, le planning passe au vert, **la facture brouillon est prête au comptoir** et **le SMS « véhicule prêt »** part au client (via n8n ; sinon le secrétariat a le texte à envoyer).

La tablette ne voit pas les prix et ne peut ni facturer ni commander : ces actions restent au comptoir.

### 🔧 Atelier (temps réel)
- 3 colonnes : **En attente / En cours / Terminé — à facturer**.
- Filtre par activité : Mécanique, Carrosserie, Vitrage.
- **Charge par technicien** : total des heures prévues sur les OR non terminés.
- Chaque carte affiche : immatriculation, véhicule, client, n° d'OR, technicien, heures, date d'entrée.
- Boutons ◀ ▶ pour déplacer une carte, **Facturer** dans la dernière colonne.
- L'écran se met à jour tout seul sur tous les postes. Idéal sur un écran fixe dans l'atelier.

### 📝 Devis · 📋 OR · 🧾 Factures · ↩️ Avoirs
- Recherche par **n°, nom du client ou immatriculation**.
- Chaque document contient : client, véhicule, kilométrage, date, **activité**, technicien, demande du client ou constat.
- 3 types de lignes : **Main d'œuvre** (en heures, au taux de l'activité), **Pièce**, **Forfait / divers**. Une **remise %** est possible par ligne.
- Totaux : MO HT, Pièces HT, Total HT, TVA, **TTC**, déjà réglé, **reste dû**.
- **Impression** : en-tête du garage, bloc client et véhicule (avec VIN), mention TVA, conditions, zone de signature « Bon pour accord » sur les devis et les OR.
- Statuts :
  - Devis : En attente / Accepté / Refusé / Transformé en OR
  - OR : En attente / En cours / Terminé / Facturé
  - Facture : Brouillon / À régler / Partiel / Payée

### 👤 Clients
- Fiche : type (Particulier, Professionnel, Flotte / société, Administration), nom, prénom, téléphone, e-mail, adresse, SIRET, notes.
- La recherche fonctionne aussi **par immatriculation**.
- La fiche client affiche : **CA total HT**, **solde dû**, ses véhicules et l'**historique complet** de ses documents.

### 🚗 Véhicules
- Immatriculation (mise en majuscules et sans espaces automatiquement), **VIN**, marque, modèle, énergie, mise en circulation, kilométrage, propriétaire.
- **Historique d'entretien** : tous les devis, OR et factures du véhicule, avec le km à chaque passage.

### 📦 Stock pièces
- Article : référence fournisseur, **référence d'origine constructeur**, désignation, famille, fournisseur, emplacement (rayon), stock, **stock minimum**, prix d'achat et de vente HT. La **marge %** est calculée automatiquement.
- **Alertes** : filtre « Sous le minimum », avec rappel sur la page d'accueil.
- **📥 Réception** : entrée en stock, mise à jour du prix d'achat, n° de bon de livraison.
- **Mouvements** : historique de toutes les entrées et sorties (factures, avoirs, réceptions).
- **Import tarif CSV** : voir [section 8](#8-pièces-et-catalogues-externes-cattronic).
- **Valeur du stock** (au prix d'achat) affichée en permanence.

### 🏷️ VN / VO
- Entrée en stock : VN ou VO, immatriculation, VIN, marque, modèle, année, km, **prix d'achat**, **frais de remise en état**, prix de vente affiché, statut (En stock / Réservé).
- **Marge** calculée : prix de vente − (achat + frais).
- **Jours en stock** avec code couleur : vert < 45 j, orange 45–90 j, **rouge > 90 j**.
- **Vendre** : choix de l'acheteur et du prix final. Le logiciel crée alors la **facture de cession**, ajoute le véhicule à la fiche de l'acheteur, puis passe le VO en « Vendu ».
- ⚠ Le **certificat de cession officiel (Cerfa 15776)** reste à faire en parallèle sur le site de l'ANTS.

### 🔑 Véhicules de prêt
- **Flotte** : les véhicules de courtoisie, avec leur état (Disponible / Prêté à…).
- **Sortie** : véhicule, client, OR lié, date de départ, **retour prévu**, km et **carburant au départ**, état et rayures constatées.
- **Retour** : km et carburant au retour, observations (dégâts, PV…). Les km parcourus sont calculés.
- **Retards** signalés en rouge, ici et sur l'accueil.

### 💶 Règlements
- **Factures à encaisser**, avec leur **ancienneté** : orange au-delà de 7 jours, rouge au-delà de 30 jours.
- **Encaissements du mois**, avec le total par mode (CB, Espèces, Chèque, Virement).
- Paiements **partiels** possibles. Un règlement peut être annulé (bouton ✕).

### 📒 Comptabilité
- Choix du mois. Affichage : Total HT, **TVA collectée**, TTC, encaissé.
- **Journal des ventes** : factures, avoirs (en négatif) et cessions.
- Exports **CSV pour l'expert-comptable** (ils s'ouvrent dans Excel) :
  - `journal-ventes-AAAA-MM.csv` : date, pièce, type, client, activité, MO HT, Pièces HT, Total HT, TVA, TTC
  - `journal-encaissements-AAAA-MM.csv` : date, facture, client, mode, référence, montant
- **Routine conseillée** : le 1er de chaque mois, exporter les deux fichiers du mois précédent et les envoyer au comptable.

### 📊 Statistiques
Sur un **mois** ou une **année** au choix :
- **Entrées atelier** (nombre d'OR)
- **CA atelier HT**, **ticket moyen**, **panier pièces moyen**
- **Main d'œuvre HT** et **heures vendues**
- **Taux de transformation des devis**
- **Ventes VN/VO et marge**
- Graphiques : **CA par activité**, **CA par technicien**, **prestations les plus vendues**

---

## 8. Pièces et catalogues externes (Cattronic…)

> **Analogie** : le logiciel est un **standard téléphonique**. Il ne contient pas tous les catalogues du monde, mais il **compose le bon numéro** (catalogue, référence, VIN) en un clic.

### 8.1 Ajouter une pièce dans un document
Bouton **+ Pièce (stock / catalogues)**. Une fenêtre s'ouvre avec 3 options :
1. **Rechercher dans le stock** par référence, référence d'origine ou désignation. Le stock disponible s'affiche.
2. **Ouvrir un catalogue externe** (Cattronic, recherche web…) déjà positionné sur la référence et le véhicule.
3. **Pièce hors stock (commandée)** : référence fournisseur, **réf. d'origine constructeur**, désignation, prix, quantité.

### 8.2 Configurer les connecteurs
Dans **Paramètres → Connecteurs pièces**, mettez une ligne par catalogue, au format `Nom | URL`. Variables possibles dans l'URL :

| Variable | Remplacée par |
|---|---|
| `{ref}` | la référence tapée dans la recherche |
| `{vin}` | le n° de série du véhicule du document |
| `{immat}` | l'immatriculation |
| `{marque}` / `{modele}` | marque et modèle |

Exemple fourni par défaut :
```
Recherche web réf. origine | https://www.google.com/search?q={ref}+{marque}+r%C3%A9f%C3%A9rence+origine
```
Pour **Cattronic (réseau Antilles-Guyane)** : faites une recherche sur leur site, copiez l'adresse de la page de résultats et remplacez la référence par `{ref}`.

> ℹ À ce jour, **aucune API publique Cattronic** n'est connue. D'où le choix de deux solutions : le **bouton de recherche configurable** et l'**import CSV** de leurs tarifs. Si Cattronic (ou un autre fournisseur) fournit un accès **EDI ou API**, on pourra le brancher dans `server.js` pour récupérer les prix et la disponibilité automatiquement.

### 8.3 Importer un tarif fournisseur (CSV)
**Stock → Import tarif CSV**. Format : séparateur `;`, première ligne d'en-têtes ignorée :
```
ref;ref_origine;designation;fournisseur;prix_achat;prix_vente;stock
```
Si la référence existe déjà, ses **prix sont mis à jour**. Sinon, l'article est **créé**.

---

## 9. Importer la base de données existante

> **Analogie : le déménagement.**
> - L'ancienne base du garage, c'est **l'ancien local**.
> - Les **fichiers CSV** sont les **cartons** : un pour les clients, un pour les véhicules, un pour les pièces.
> - Le **`code_client`** est **l'étiquette** sur chaque carton : « cette voiture appartient à ce client ».
> - **`import.js`** est le **déménageur** : il range tout et rend un rapport des cartons abîmés.

### 9.1 Le format : 3 fichiers CSV
Dans Excel : **Fichier → Enregistrer sous → « CSV (séparateur : point-virgule) »**. Les accents et les virgules décimales (`12,50`) sont gérés. Les modèles sont dans `modeles-import/`.

**`clients.csv`**

| Colonne | Obligatoire | Exemple |
|---|---|---|
| code_client | ✅ | C0001 (le n° de l'ancien logiciel) |
| type | | Particulier / Professionnel |
| nom | ✅ | BRUNET |
| prenom, telephone, email | | Lucie · 0694123456 · lucie@exemple.fr |
| adresse, code_postal, ville | | 12 rue des Palmiers · 97310 · Kourou |
| siret, notes | | (pour les pros) · « appeler le matin » |

**`vehicules.csv`**

| Colonne | Obligatoire | Exemple |
|---|---|---|
| code_client | ✅ | C0001 ← le lien vers le propriétaire |
| immatriculation | ✅ | GA-123-AB (nettoyée automatiquement) |
| vin | | VF15RBF0A12345678 (17 caractères, vérifié) |
| marque, modele, energie | | Renault · Clio IV · Diesel |
| mise_en_circulation | | 25/03/2019 |
| kilometrage | | 84 200 |

**`articles.csv`**

| Colonne | Obligatoire | Exemple |
|---|---|---|
| reference | ✅ | FH-1023 |
| designation | ✅ | Filtre à huile Clio IV |
| ref_origine | | 7701478543 |
| famille, fournisseur, emplacement | | Filtration · Cattronic · A1 |
| stock, stock_min | | 8 · 2 |
| prix_achat, prix_vente | | 4,20 · 12,50 (HT) |

> **Règle d'or** : gardez exactement ces en-têtes de colonnes. Quelques variantes sont aussi reconnues (`immat`, `tel`, `libelle`, `km`…).

### 9.2 Où trouver les données ?
- **Cas idéal** : l'ancien logiciel a un menu « Exporter » vers Excel ou CSV. On réorganise ensuite les colonnes selon les modèles.
- **Cas fréquent** : les données sont dans un Excel « maison ». On copie-colle les colonnes dans les modèles.
- **Cas difficile** : pas d'export possible. On saisit directement dans l'application, les clients réguliers d'abord, les autres au fil des passages.

### 9.3 La procédure (sur le PC serveur)

**Étape 1 : créer la base vide.** Lancez `demarrer.bat`, ouvrez l'application une fois, puis **fermez la fenêtre noire**.
✅ Le fichier `data\db.json` doit exister.

**Étape 2 : simuler.** Ouvrez un terminal dans `C:\TECHAUTO\techauto-dms` et tapez :
```
node import.js modeles-import --test
```
**Résultat attendu (exemple) :**
```
  SIMULATION (rien n'est écrit) — TECH'AUTO DMS

  Clients   : 2 créés, 0 mis à jour
  Véhicules : 2 créés, 0 mis à jour
  Articles  : 2 créés, 0 mis à jour
  Alertes   : 1
   - vehicules.csv ligne 4 : GC789 : client « C9999 » introuvable → ignorée

  Tout est bon ? Relancez sans --test pour importer.
```
✅ **Point de contrôle** : lisez les alertes. La liste complète est dans `import-rapport.txt`. Corrigez les lignes concernées dans Excel et relancez la simulation jusqu'à ce que le rapport soit propre.

**Étape 3 : importer pour de vrai.**
```
node import.js modeles-import
```
**Résultat attendu :**
```
  ✔ Import terminé. Copie de sécurité : data\sauvegardes\avant-import-….json
  Relancez demarrer.bat.
```

**Étape 4 : relancer et vérifier.** Lancez `demarrer.bat`. Allez dans **Clients**, recherchez un nom : sa fiche doit afficher ses véhicules.

### 9.4 Sécurités intégrées
- Le script **refuse de tourner si le serveur est allumé**. Sinon le serveur écraserait l'import, comme deux personnes qui écrivent sur la même page en même temps.
- Une **copie de sécurité automatique** est faite avant chaque import.
- **Pas de doublons** : relancer l'import met les fiches à jour. Les clients sont reconnus par `code_client`, les véhicules par immatriculation, les pièces par référence. On peut donc importer en plusieurs fois.
- **Alertes** : VIN qui n'a pas 17 caractères, client introuvable, champs obligatoires vides.

### 9.5 Les anciennes factures : à ne pas importer
Une facture validée doit garder son numéro et ne plus bouger. Les réimporter fausserait aussi la comptabilité et les statistiques. Bonne pratique :
- **Gardez l'ancien logiciel en lecture seule**, ou un export PDF des factures, pour consulter l'historique.
- **Démarrez la nouvelle numérotation** (`FAC2026-00001`…) à une date nette, par exemple le **1er du mois**.
- Faites **valider ce point par l'expert-comptable**.

---

## 10. Sauvegardes et sécurité des données

### 10.1 Où sont les données ?
Tout est dans **un seul fichier** : `data\db.json`. C'est comme **un classeur avec un onglet par sujet** : clients, véhicules, articles, documents (devis, OR, factures, avoirs, cessions), mouvements de stock, règlements, VN/VO, flotte de prêt, prêts, paramètres, compteurs de numérotation.

Pour un garage de 5 postes (quelques milliers de clients et de factures), c'est largement suffisant. Si le volume explose un jour, on pourra passer à une vraie base SQL **sans changer l'interface**.

### 10.2 Protections automatiques
| Protection | Fonctionnement |
|---|---|
| Écriture « atomique » | Le fichier est écrit à côté puis échangé. **Une coupure de courant ne corrompt pas la base.** |
| Sauvegarde quotidienne | Une copie par jour dans `data\sauvegardes\`, **60 jours conservés** |
| Copie avant import | `avant-import-….json` |
| Copie avant restauration | Faite automatiquement |

### 10.3 Ce qu'il faut faire en plus (indispensable)
- **Chaque semaine**, copiez le dossier `data\` sur une **clé USB** ou un **NAS**, rangé hors du garage si possible. Un PC peut tomber en panne, être volé ou griller (orages, surtensions).
- Ou utilisez **Paramètres → ⬇ Exporter tout**, qui produit un fichier `.json` complet.

### 10.4 Restaurer
**Paramètres → ⬆ Restaurer une sauvegarde**, puis choisissez un fichier `.json`.
⚠ Les données des **5 postes** sont remplacées.

---

## 11. Qui fait quoi dans le garage

| Rôle | Écrans principaux | Tâches |
|---|---|---|
| **Gérant / PDG** | Accueil, Statistiques, Comptabilité, VN/VO | Suivi du CA, marges VO, export mensuel pour le comptable, paramètres |
| **Secrétaire (accueil, RDV, factures)** | Accueil, Devis, Factures, Règlements, Clients, Prêts | Devis, transformation en OR, facturation, encaissement, véhicules de prêt, relance des impayés |
| **Chef d'atelier** | Atelier, OR | Affectation des techniciens, charge par mécano, priorités |
| **Mécaniciens (5)** | Atelier, fiche atelier imprimée | Avancement des OR (▶), constats, heures |
| **Responsable pièces** | Stock, catalogues | Réceptions, alertes de minimum, références d'origine, import des tarifs |

---

## 12. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Voyant **rouge** « Serveur injoignable » | Fenêtre noire fermée, PC serveur éteint ou en veille | Relancer `demarrer.bat` sur le PC serveur |
| Voyant **orange** « Mode autonome » | Le fichier `index.html` a été ouvert directement, sans passer par l'adresse du serveur | Ouvrir `http://192.168.1.XX:8080` |
| Les postes ne trouvent plus le serveur | L'adresse IP du PC serveur a changé | Relire l'adresse dans la fenêtre noire. Réserver une IP fixe dans la box |
| Les autres postes n'accèdent pas, le serveur oui | Pare-feu Windows | Autoriser Node.js sur les **réseaux privés** |
| `'node' n'est pas reconnu…` | Node.js absent | Installer Node.js LTS (§ 4.2) |
| `⚠ db.json illisible` au démarrage | Fichier abîmé | Copier la dernière sauvegarde de `data\sauvegardes\` vers `data\db.json` |
| `✖ Le serveur tourne encore` (import) | Le serveur est allumé | Fermer la fenêtre noire puis relancer l'import |
| Une facture validée contient une erreur | Normal : elle est verrouillée | Créer un **avoir** depuis la facture |
| Accents bizarres dans un CSV ouvert sous Excel | Encodage | Les exports sont en UTF-8 avec BOM : ouvrir par double-clic. Sinon, Données → À partir d'un fichier texte |

---

## 13. Limites actuelles et évolutions prévues

### Limites de la version actuelle (v1)
- **Pas de connexion par mot de passe** : tout appareil branché au réseau du garage accède à l'application. **Le Wi-Fi « clients » doit être séparé** du réseau des postes. → Priorité de la prochaine version.
- **Cattronic** : lien de recherche et import CSV, mais pas de connexion directe (aucune API publique connue).
- **Certificat de cession** (Cerfa 15776) à établir sur le site de l'ANTS.
- **TVA** à 0 % par défaut, à **faire confirmer par l'expert-comptable**.
- **Taux horaires** d'exemple, à remplacer par les vrais tarifs.

### Évolutions envisagées
- 🔐 Comptes utilisateurs par rôle (gérant, secrétaire, atelier, magasin)
- 📱 **SMS / WhatsApp automatiques** au client quand l'OR passe à « Terminé », en réutilisant le module SMS déjà réalisé (Google Sheets + passerelle Android)
- 🗓 Liaison avec l'application de **prise de rendez-vous**
- 🔧 **Rappels d'entretien** au kilométrage ou à la durée, avec les pièces prévues
- 👷 Gestion des imprévus : mécano absent, formation, panne d'outillage → réaffectation des OR
- 🔌 Connexion EDI/API fournisseurs dès qu'un accès est disponible
- 🎓 **Formations par rôle** : secrétaires, gestion des stocks, présentation aux mécaniciens

---

*TECH'AUTO DMS — Automatisation Consciente — Kourou, Guyane française.*
*Ce logiciel est un outil de gestion. Les règles fiscales (TVA, conservation des factures, numérotation) et comptables doivent être validées par l'expert-comptable du garage.*
