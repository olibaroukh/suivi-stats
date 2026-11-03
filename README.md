# Suivi statistique

Application de suivi statistique mensuel du réseau (remplace le fichier Numbers « Suivi 2026 »).

**Le code est publié ici, les données jamais.** L'appli s'ouvre depuis GitHub Pages ; les données sont sur Cloudflare (Worker `suivi-stats-api`, dossier `worker/`), accessibles uniquement après connexion avec les identifiants Zimbra. Les administrateurs voient et modifient tout ; les autres comptes ne voient que les magasins de leur périmètre. L'ancien mode (dossier Dropbox choisi dans Chrome) reste disponible depuis l'écran de connexion.

Le Worker est déployé automatiquement par Cloudflare à chaque fusion sur `main`. Secrets saisis dans Cloudflare : `SESSION_KEY` ; variable `ADMINS` (adresses des administrateurs).

## Organisation des données (Cloudflare, même arborescence que l'ancien dossier Dropbox)

```
Suivi Stats/
  config/referentiel.json       ← importé depuis le référentiel Excel (onglet Magasins)
  config/objectifs-2026.json    ← importé depuis le fichier d'objectifs Excel
  config/mr-qualite.json        ← dernier fichier Mr Qualité reçu, repris tant qu'aucun nouveau n'est déposé
  donnees/2026/etat.json        ← cumuls de l'année (Lyleoo, OCM, site internet, fichiers avis Google)
  donnees/2026-10/photo.json    ← photo figée du mois (tableau central N et N-1)
  donnees/2026-10/imports/      ← copie des fichiers reçus et des copier-coller
  sorties/2026-10/fiches/       ← PDF des fiches magasins
  sorties/2026-10/envois.csv    ← liste des envois (magasin, e-mail, fichier)
```

## Chaque mois

1. **Import du mois** : choisir le mois, déposer en vrac les ZIP Cosium et les fichiers Excel / CSV, coller Lyleoo, OCM et site internet.
2. **Calculer le mois**, lire le rapport de contrôle (sources reçues / reprises du mois précédent / absentes, points à vérifier), cocher les listes Confidence.
3. **Enregistrer la photo du mois**.
4. **Fiches magasins** : consulter, filtrer, générer les PDF (langue locale + français pour les magasins non francophones).

## Structure du code

- `js/engine/` : lecture des sources (Cosium, Excel, copier-coller) et tableau central.
- `js/pipeline.js` : chaîne de calcul mensuelle et rapport de contrôle.
- `js/engine/equipe.js` : données par personne (export RH + stats Cosium par vendeur, rattachées par matricule).
- `js/fiche.js` : indicateurs et rendu de la fiche magasin (2 pages A4).
- `js/store.js` : accès au dossier local.
- `data/` : correspondances des colonnes Cosium, traductions, règles métier.
- `lib/` : librairies intégrées (SheetJS, JSZip, jsPDF, html2canvas) pour un fonctionnement hors ligne.
