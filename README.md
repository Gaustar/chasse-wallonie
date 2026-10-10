# Chasses du jour · Wallonie et Ardennes françaises

Carte mobile des chasses déclarées en Wallonie (battue, affût, autre), filtrable par jour, week-end ou semaine, avec alerte si la position GPS tombe dans un territoire chassé.

## Données

Source officielle SPW – DNF, service ArcGIS `FAUNE_FLORE/CHASSE_TERRIT_ANONYM` :

- couche 0 : limites des territoires de chasse (version anonymisée) ;
- table 1 : dates de chasse déclarées (date, mode, fermeture de chemins octroyée ou non).

`scripts/build-data.mjs` joint les deux sur `KEYG` jusqu'à la fin de la saison (30 juin) et écrit `data/chasses.json`. Aucune dépendance, Node 18+.

Limites : seules les chasses déclarées au DNF apparaissent ; le DNF synchronise sa base périodiquement (date affichée en bas de l'appli) ; quelques territoires déclarés n'ont pas de tracé dans la couche publique : leurs chasses sont listées en texte au-dessus de la carte, avec le cantonnement déduit du numéro de lot (indicatif). Les panneaux sur le terrain priment toujours.

### France (ONF)

`scripts/onf.mjs` ajoute les jours chassés des forêts domaniales situées à moins de 50 km de Sedan et de Charleville-Mézières, d'après les calendriers publiés sur onf.fr (liste des forêts par la recherche du site, dates dans chaque page, contours par le service cartographique des lots de chasse). Une requête par lot (le pare-feu de l'ONF refuse `IN`/`OR`), réessais sur ses erreurs intermittentes, une récupération par jour au plus (`data/onf.json` publié sert de cache et de secours si l'ONF est en panne).

Limites : forêts domaniales uniquement (rien sur les forêts privées ou communales) ; actions collectives de chasse au grand gibier, données indicatives selon l'ONF ; pas d'information de fermeture de chemins.

Fonds de carte : topographique IGN/NGI (CartoWeb), orthophotos SPW (`IMAGERIE/ORTHO_LAST`), OpenTopoMap.

La période affichée (début et fin par mode) vient des premières et dernières dates déclarées de la saison, pas des dates légales d'ouverture. Rien n'est lié à une année : le script suit la saison publiée par le DNF et le workflow se réactive lui-même pour ne pas être suspendu.

## Calendrier

`ics.js` (partagé par le site et le build) produit des fichiers iCalendar : journées entières (le DNF ne publie pas d'heures), identifiants stables, jours consécutifs regroupés en période.

- Téléchargement depuis le site : zone visible, cantonnement, Wallonie ou territoire ; période affichée ou saison ; résumé par jour ou détail par territoire ; rappel optionnel.
- Abonnements régénérés à chaque build dans `cal/` : `wallonie.ics`, `cantonnement-<code>.ics` (+ `-detail`), `t/<lot>.ics`.
- Les événements renvoient vers la carte par lien profond : `#du=AAAA-MM-JJ&au=AAAA-MM-JJ&lot=<lot>` ou `&can=<code>`.

## Utilisation locale

```bash
node scripts/build-data.mjs
python3 -m http.server 8931
```

## Déploiement

Le workflow `.github/workflows/donnees.yml` régénère les données trois fois par jour (03:15, 10:15, 16:15 UTC) et publie le site sur GitHub Pages (Settings > Pages > Source : GitHub Actions).
