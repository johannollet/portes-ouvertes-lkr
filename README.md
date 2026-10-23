# Portes ouvertes LKR

Outil de préparation et d'accueil des portes ouvertes du collège Lili Keller Rosenberg (Halluin) : inscriptions Evento par créneau, attribution automatique des élèves accompagnateurs avec leurs heures de convocation, pointage du jour J (élèves présents/absents, réattribution automatique), ateliers, rétroplanning et documents (feuillet d'accueil, fiche atelier, flyers, QR code, convocations PDF), et feuillet d'accueil A4 recto-verso paramétrable, alimenté par les fiches des professeurs.

- `public/` : l'appli (fonctionne hors ligne, installable sur l'écran d'accueil).
- `public/?atelier` : formulaire en ligne où les professeurs remplissent la fiche de leur atelier (code profs par défaut : 2026, modifiable dans l'onglet Ateliers). Ils peuvent la modifier ensuite grâce au lien reçu.
- `netlify/functions/fiche.mjs` : réception et stockage des fiches ateliers (Netlify Blobs).
- `netlify/functions/sync.mjs` : synchronisation entre appareils et code d'accès (Netlify Blobs). Code par défaut : 1411, à changer dans l'onglet Documents > Sauvegarde.

Aucune donnée d'élève ni de famille n'est stockée dans ce dépôt : elles sont importées dans l'appli (Excel des volontaires, export Evento) et gardées dans Netlify Blobs derrière le code d'accès.
