# Chasses du jour · Wallonie

Carte mobile des chasses déclarées en Wallonie (battue, affût, autre), filtrable par jour, week-end ou semaine, avec alerte si la position GPS tombe dans un territoire chassé.

## Données

Source officielle SPW – DNF, service ArcGIS `FAUNE_FLORE/CHASSE_TERRIT_ANONYM` :

- couche 0 : limites des territoires de chasse (version anonymisée) ;
- table 1 : dates de chasse déclarées (date, mode, fermeture de chemins octroyée ou non).

`scripts/build-data.mjs` joint les deux sur `KEYG` jusqu'à la fin de la saison (30 juin) et écrit `data/chasses.json`. Aucune dépendance, Node 18+.

Limites : seules les chasses déclarées au DNF apparaissent ; le DNF synchronise sa base périodiquement (date affichée en bas de l'appli) ; quelques territoires déclarés n'ont pas de tracé dans la couche publique : leurs chasses sont listées en texte au-dessus de la carte, avec le cantonnement déduit du numéro de lot (indicatif). Les panneaux sur le terrain priment toujours.

Fonds de carte : topographique IGN/NGI (CartoWeb), orthophotos SPW (`IMAGERIE/ORTHO_LAST`), OpenTopoMap.

La période affichée (début et fin par mode) vient des premières et dernières dates déclarées de la saison, pas des dates légales d'ouverture. Rien n'est lié à une année : le script suit la saison publiée par le DNF et le workflow se réactive lui-même pour ne pas être suspendu.

## Utilisation locale

```bash
node scripts/build-data.mjs
python3 -m http.server 8931
```

## Déploiement

Le workflow `.github/workflows/donnees.yml` régénère les données deux fois par jour et publie le site sur GitHub Pages (Settings > Pages > Source : GitHub Actions).
