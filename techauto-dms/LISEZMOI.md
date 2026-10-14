# TECH'AUTO DMS — Installation (15 min)

## 1. Sur le PC serveur (celui qui reste allumé, ex. l'accueil)
1. Installer Node.js LTS : https://nodejs.org (bouton « LTS », suivant-suivant)
2. Vérifier dans un terminal : `node -v`  → attendu : `v20.x.x` ou plus
3. Copier le dossier `techauto-dms` dans `C:\TECHAUTO\`
4. Double-cliquer `demarrer.bat`. Attendu :
   ```
   TECH'AUTO DMS démarré ✔
   Sur ce poste      : http://localhost:8080
   Sur les 4 autres  : http://192.168.1.XX:8080
   ```
5. Si Windows demande l'autorisation du pare-feu → cocher **Réseau privé** → Autoriser.

## 2. Sur les 4 autres postes
Ouvrir Chrome/Edge à l'adresse `http://192.168.1.XX:8080` (celle affichée à l'étape 4),
puis Paramètres → « Nom du poste » (Atelier 1, Magasin…). Ajouter en favori.

## 3. Démarrage automatique (conseillé)
Win+R → `shell:startup` → y placer un raccourci vers `demarrer.bat`.
Donner une IP fixe au PC serveur dans la box (bail DHCP réservé).

## Données & sauvegardes
- Base : `data/db.json` — copie auto quotidienne dans `data/sauvegardes/` (60 jours)
- Conseillé : copier `data/` chaque semaine sur une clé USB ou un NAS.

## Premiers réglages (Paramètres)
Raison sociale, SIRET, taux horaires par activité, techniciens, TVA
(0 % par défaut en Guyane, mention art. 294-1 CGI), URL de recherche Cattronic.

## Importer la base existante (clients, véhicules, pièces)
1. Remplir (ou exporter depuis l'ancien logiciel) les 3 fichiers du dossier `modeles-import`
   en gardant les mêmes en-têtes de colonnes. Excel → « CSV (séparateur : point-virgule) ».
2. Lancer l'appli une fois (demarrer.bat), puis FERMER la fenêtre du serveur.
3. Simulation : `node import.js modeles-import --test` → lire le rapport, corriger les lignes signalées.
4. Import réel : `node import.js modeles-import` (copie de sécurité automatique avant écriture).
5. Relancer demarrer.bat. Relancer l'import plus tard met à jour sans créer de doublons.
