# Bookshelf

Journal de lecture personnel. Tu scannes le code-barres au dos d'un livre, sa fiche se remplit toute seule, tu l'ajoutes à ta bibliothèque. Tout reste sur ton téléphone.

C'est une **PWA** : une application web installable sur l'écran d'accueil, qui fonctionne hors-ligne. Pas de compte développeur Apple à 99 €/an, pas de validation App Store, pas d'expiration au bout de 7 jours — et le même code tourne sur iPhone et sur Android.

---

# Installation sur téléphone

## Étape 1 — publier l'app (une seule fois)

**C'est l'étape qui donne l'URL.** Une PWA s'installe en ouvrant une adresse web dans le navigateur du téléphone. Tant que l'app n'est publiée nulle part, il n'y a pas d'adresse à ouvrir : pousser le code sur GitHub ne suffit pas, GitHub **stocke** le code mais ne le **sert** pas.

Il faut donc un hébergeur, qui prendra le dépôt, lancera `npm run build` et publiera le résultat. **Aucun VPS, aucun serveur à administrer, aucun paiement** : l'app est un simple dossier de fichiers statiques, et c'est l'hébergeur qui fabrique l'URL.

### Option A — GitHub Pages (zéro compte supplémentaire)

Le workflow `.github/workflows/deploy.yml` est déjà dans le dépôt. Il ne reste qu'à l'activer :

1. Pousser le dépôt sur GitHub.
2. **Settings → Pages → Build and deployment → Source : « GitHub Actions »**.
3. Pousser un commit, ou onglet **Actions** → « Déployer sur GitHub Pages » → **Run workflow**.
4. Attendre ~2 minutes. L'onglet Actions affiche l'URL une fois la publication terminée.

L'adresse obtenue est **`https://<pseudo-github>.github.io/<nom-du-dépôt>/`**, par exemple `https://mon-pseudo.github.io/bookshelf/`. Elle ne change plus. Le workflow lance les tests, construit l'app avec le bon préfixe de chemin et publie : ensuite, chaque `git push` met l'app à jour toute seule.

> ⚠️ **Le dépôt doit être public.** GitHub Pages sur un dépôt privé demande un abonnement payant (GitHub Pro). Publier le code ne publie pas tes données : ta bibliothèque vit uniquement sur ton téléphone, elle n'est jamais dans le dépôt.

### Option B — Cloudflare Pages (pour garder le dépôt privé)

Gratuit aussi, compatible avec un dépôt privé, au prix d'un compte à créer :

1. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Pages → Connect to Git.
2. Choisir le dépôt. Build command : `npm run build`, Output directory : `dist`.
3. Deploy.

L'adresse est du type `https://bookshelf.pages.dev`. Cloudflare sert à la racine, donc aucun préfixe à configurer.

### Option C — hébergeurs français

**Framagit (Framasoft)** — association française, dépôt privé autorisé, GitLab Pages inclus, gratuit. Le fichier `.gitlab-ci.yml` est déjà dans le dépôt : pousser le projet sur [framagit.org](https://framagit.org), puis **Deploy → Pages**. L'URL est de la forme `https://<utilisateur>.frama.io/<projet>/`. C'est la seule option qui combine gratuité, dépôt privé et hébergement français. Le même fichier fonctionne sur n'importe quelle instance GitLab.

**OVHcloud** — l'hébergement web intègre un déploiement depuis GitHub (dépôt lié dans l'espace client + webhook pour republier à chaque push) et un certificat Let's Encrypt gratuit sur toutes les offres. À partir de quelques euros par mois ; l'intégration Git demande une offre Pro ou supérieure. Attention : héberger le site sur **Object Storage** plutôt que sur l'hébergement web ne donne **pas** de HTTPS natif — il faudrait un Load Balancer en plus, donc un coût supplémentaire. Sans HTTPS, pas de PWA ni de caméra.

**Alwaysdata** — hébergeur français éco-responsable, plan gratuit de 100 Mo avec HTTPS et accès SSH (usage personnel uniquement). Le build fait ~1,5 Mo, donc le quota est très largement suffisant. Le déploiement passe par SSH/rsync plutôt que par une intégration Git native : il s'automatise depuis une action CI.

**Scaleway** — Object Storage avec la fonction *Bucket Website*, et Edge Services pour le domaine et le cache. Les conditions du palier gratuit ont changé et les sources se contredisent ; à vérifier sur leur page de tarifs. Pour un site de 1,5 Mo, le coût réel reste de toute façon de quelques centimes par mois.

### À propos du préfixe de chemin

GitHub Pages sert le site dans un sous-dossier portant le nom du dépôt, pas à la racine du domaine. Tout doit donc être préfixé, sinon le service worker et les icônes partent en 404 et l'app refuse de s'installer. `vite.config.ts` lit ce préfixe dans la variable `BASE_PATH`, que le workflow renseigne automatiquement — rien à modifier à la main. Pour un build local destiné à un sous-chemin :

```bash
BASE_PATH=/bookshelf/ npm run build
```

> **L'adresse doit être en `https://`.** C'est une contrainte du navigateur, pas un confort : la caméra et le service worker sont refusés sur une origine non sécurisée. Les deux hébergeurs fournissent le certificat automatiquement.

## Étape 2 — installer sur iPhone

1. Ouvrir l'URL **dans Safari**. Chrome et Firefox sur iOS ne savent pas installer de PWA — iOS leur interdit cette fonction.
2. Bouton **Partager** (le carré avec la flèche, en bas de l'écran).
3. Faire défiler, choisir **« Sur l'écran d'accueil »**.
4. Valider.

L'icône apparaît parmi les applications. Au lancement, pas de barre d'adresse, pas d'onglets : l'app occupe l'écran comme n'importe quelle autre.

Au premier scan, Safari demande l'autorisation d'accéder à la caméra — il faut l'accorder, sinon le scanner reste noir.

## Étape 3 — installer sur Android

Chrome propose **« Installer l'application »** spontanément à la première visite. Si la bannière a disparu : menu **⋮** → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil »).

Android est le cas facile : pas de limite de stockage à 7 jours, et le décodage des codes-barres passe par l'API native du navigateur, donc le scan y est plus rapide que sur iPhone.

## Mettre à jour l'app

Rien à faire. À chaque publication, le service worker télécharge la nouvelle version en arrière-plan et l'applique au lancement suivant. Pas de passage par un store, pas de validation, pas de réinstallation.

## Utiliser l'app sur les deux téléphones

Chaque appareil garde sa propre bibliothèque : il n'y a pas de serveur, donc pas de synchronisation automatique. Pour transférer une bibliothèque d'un téléphone à l'autre aujourd'hui : **Réglages → Exporter en JSON** sur le premier, puis **Importer un fichier** sur le second.

---

# Utilisation

**Ajouter un livre** — onglet Scanner, viser le code-barres au dos du livre. Le code EAN-13 imprimé *est* l'ISBN. La fiche se remplit, tu choisis l'état (Lu, En cours, À lire, Abandonné) et c'est ajouté. Pour un livre sans code-barres ou emprunté, la saisie manuelle d'ISBN et la recherche par titre/auteur sont là pour ça.

**Retrouver un livre** — onglet Bibliothèque : filtre texte sur titre, auteur, éditeur et tags, filtres par état, filtres par tag, tri par date d'ajout, titre, auteur, année ou note.

**Enrichir une fiche** — appuyer sur une couverture : note sur 5, dates de début et de fin, tags personnels, notes de lecture.

**Importer depuis une autre application** — Réglages → Importer un fichier. Accepte le CSV ou le JSON exporté par ClassBook, Goodreads, BookBuddy, Libib ou un simple tableur. Les colonnes sont devinées d'après leurs intitulés (français et anglais), un écran permet de corriger la correspondance, et un aperçu montre le résultat avant d'écrire quoi que ce soit. Les fiches incomplètes peuvent être complétées automatiquement via leur ISBN — compte environ une seconde par livre à compléter.

**Exporter** — trois formats :

| Format | Pour quoi |
|---|---|
| JSON | sauvegarde complète, se réimporte sans créer de doublons |
| CSV « Excel FR » | ouverture directe dans Excel en configuration française (point-virgule) |
| CSV « standard » | alimenter une autre application (virgule) |

---

# Sauvegarde — à lire

Tes livres vivent dans le stockage du navigateur, sur le téléphone. **Exporte régulièrement** (Réglages → Exporter en JSON).

Deux raisons :

1. Si tu perds le téléphone, tu perds tout. Il n'y a pas de serveur.
2. Safari efface le stockage d'un site après 7 jours d'inactivité. L'équipe WebKit a indiqué que les apps **ajoutées à l'écran d'accueil** échappent à cette règle, mais Apple ne l'a jamais clairement documenté, et iOS peut toujours purger sous pression mémoire. En pratique ça tient — mais pas au point d'y confier dix ans de lectures sans copie.

Le bouton « Demander un stockage persistant » réclame au navigateur de ne pas purger. Android accepte souvent, iOS rarement.

L'export JSON est aussi ta porte de sortie : le format est lisible et documenté, tu peux reprendre tes données ailleurs sans rien ressaisir.

---

# Développement et tests

## Prérequis

Node 20 ou plus (développé et testé sur Node 22). Aucun autre outil.

```bash
npm install
npm run dev        # http://localhost:5180
```

| Commande | Effet |
|---|---|
| `npm run dev` | serveur de développement avec rechargement à chaud |
| `npm run build` | vérification de types + bundle de production dans `dist/` |
| `npm run preview` | sert `dist/` pour tester le build réel |
| `npm test` | tests du parseur CSV et de la correspondance d'import |
| `npm run typecheck` | TypeScript seul |
| `npm run icons` | régénère les icônes PWA |

Le port est 5180 et non le 5173 par défaut de Vite, souvent déjà pris par un autre projet.

## Tester le scanner

L'accès à la caméra (`getUserMedia`) n'est autorisé que dans un **contexte sécurisé** : `https://` ou `localhost`.

- **Sur le PC** : `http://localhost:5180` est un contexte sécurisé. La webcam fonctionne, il suffit de présenter un code-barres de livre devant l'objectif.
- **Sur un téléphone** : l'adresse IP locale (`http://192.168.x.x`) n'est **pas** un contexte sécurisé, le scanner refusera de démarrer. Il faut un tunnel HTTPS :

  ```bash
  npm run dev
  # dans un second terminal :
  npx cloudflared tunnel --url http://localhost:5180
  ```

  Cloudflare renvoie une URL `https://…trycloudflare.com` temporaire, valable le temps de la session. C'est la seule méthode utilisable sur iPhone. Sur Android uniquement, il existe un raccourci : `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, y saisir `http://192.168.x.x:5180`.

La saisie manuelle d'ISBN fonctionne sans caméra : elle suffit à tester toute la chaîne de récupération des métadonnées depuis le PC.

## Tests automatisés

```bash
npm test
```

70 vérifications sur les deux modules qui traitent des données non maîtrisées — le fichier exporté par une application tierce — et où une erreur passe inaperçue : un ISBN mal découpé donne un livre importé de travers, pas une exception. Couvre le parseur CSV (guillemets, virgules et sauts de ligne dans les champs, détection du séparateur, enrobage Excel `="…"`), la détection automatique des colonnes sur les formats Goodreads et français, et la normalisation des statuts, notes, dates, auteurs, ISBN et langues.

Le reste du code se vérifie à l'œil ou dans le navigateur. Les trois sources de métadonnées ont été validées à la main contre les API réelles, pas dans une suite rejouable.

## Note sur les systèmes de fichiers montés

Si le dépôt est cloné sur un lecteur réseau ou un partage Windows monté sous WSL, les notifications inotify ne remontent pas et le rechargement à chaud reste muet. `vite.config.ts` détecte le cas (chemin sous `/mnt/`) et bascule sur une scrutation active. Sur un disque local, rien ne s'active.

---

# Architecture

```
src/
├── api/                  Récupération des métadonnées
│   ├── types.ts          BookDraft : la forme normalisée commune
│   ├── openlibrary.ts    Open Library — source principale
│   ├── googlebooks.ts    Google Books — résumés, éditions récentes
│   ├── bnf.ts            BnF SRU/UNIMARC — fonds français
│   └── index.ts          Cascade, fusion et déduplication
├── db/
│   ├── schema.ts         Types + base Dexie (IndexedDB)
│   └── repo.ts           CRUD, couvertures, export/import, stats
├── scan/
│   ├── scanner.ts        Choix du moteur + accès caméra
│   └── wasmScanner.ts    ZXing WebAssembly (chargé à la demande)
├── lib/
│   ├── isbn.ts           Validation, conversion ISBN-10 ↔ 13
│   ├── language.ts       Codes MARC/ISO → nom de langue
│   ├── csv.ts            Lecture/écriture CSV (RFC 4180)
│   └── importMapping.ts  Détection des colonnes, normalisation des valeurs
├── components/           Écrans et UI
└── App.tsx               Navigation par onglets
```

## Les sources de métadonnées

Pour une recherche par ISBN, **Open Library et Google Books sont interrogés en parallèle puis fusionnés**, plutôt qu'en cascade. Leurs lacunes ne se recouvrent pas : Open Library a la meilleure donnée bibliographique et des couvertures libres, Google a plus souvent le résumé et la pagination des éditions françaises récentes. Deux requêtes parallèles coûtent le même temps qu'une seule et donnent une fiche nettement plus complète.

La **BnF** n'intervient que si les deux échouent. C'est la référence pour l'édition française ancienne, mais ses notices n'ont pas d'image et son index se comporte différemment (voir ci-dessous).

## Pièges vérifiés sur les services réels

**La BnF indexe les ISBN-10, pas les ISBN-13.** Chercher `9782070360024` renvoie zéro résultat là où `2070360024` renvoie la notice. Le code convertit donc en ISBN-10 et essaie cette forme en premier. Vérifié sur plusieurs notices.

**Open Library ne remplit pas toujours le champ `cover`** même quand l'image existe sur `covers.openlibrary.org`. On retombe systématiquement sur l'URL construite depuis l'ISBN. Sans ce repli, beaucoup de livres s'afficheraient sans couverture pour rien.

**Google Books renvoie des 429 depuis certaines IP** (entreprise, VPN, datacenter) sans aucune clé. L'app le supporte — les sources sont interrogées en parallèle et un échec est silencieusement ignoré — mais les résumés manquent alors. Voir `.env.example` pour ajouter une clé.

**Les trois sources ne codent pas les langues pareil** : Open Library et la BnF renvoient du MARC sur trois lettres (`fre`), Google de l'ISO 639-1 (`fr`), et la BnF parfois un chemin complet (`/languages/fre`). Tout est ramené à l'ISO 639-1 à l'entrée, et affiché en toutes lettres (« Français »).

**L'enrobage `="…"` des exports pensés pour Excel** casse le découpage CSV quand la valeur contient une virgule : la RFC ne rend le guillemet spécial qu'en début de champ, donc `="Camus, Albert"` se scinde en deux et décale toutes les colonnes suivantes. Le parseur traite ce cas explicitement.

## Le scanner

Deux moteurs, choisis automatiquement :

- **`BarcodeDetector`**, l'API native du navigateur (Chrome/Android). Décodage dans le code natif, quasi gratuit en CPU.
- **ZXing en WebAssembly**, pour Safari qui n'implémente pas `BarcodeDetector` — donc tout iPhone.

Le binaire ZXing pèse ~940 Ko. Il est volontairement **exclu du précache** et importé dynamiquement : Android ne le télécharge jamais, iOS le récupère au premier scan puis le garde en cache définitivement. Sans ça, chaque installation paierait 940 Ko d'entrée de jeu. Le précache total est de ~430 Ko.

Sur le chemin WebAssembly, seule la bande centrale visée est analysée, réduite à 640 px de large : ça divise le travail par ~10 sans perte de fiabilité, un EAN-13 restant largement lisible à cette résolution.

## Le modèle de données

Chaque livre porte quatre champs qui ne servent à rien aujourd'hui — tout est local — mais qui sont là **pour que la synchronisation multi-appareils soit ajoutable plus tard sans migration** :

| Champ | Rôle |
|---|---|
| `createdAt` | date d'ajout |
| `updatedAt` | départage les conflits (dernier écrivain gagne) |
| `deletedAt` | tombstone : une suppression n'efface jamais la ligne |
| `dirty` | la ligne n'a pas encore été poussée au serveur |

Le tombstone est le point important. Sans lui, supprimer un livre sur l'appareil A le verrait « ressusciter » à la première synchro avec l'appareil B, qui l'a encore. `dirty` vaut `0 | 1` et non un booléen parce qu'**IndexedDB n'indexe pas les booléens**.

La logique d'import suit déjà cette règle : réimporter le même fichier ne crée pas de doublons, et un livre n'est remplacé que si la version importée est plus récente. C'est exactement l'algorithme que fera la synchro.

---

# Et la synchro multi-appareils ?

Pas implémentée, volontairement. Le schéma est prêt (voir ci-dessus), mais construire le serveur avant d'en avoir besoin, c'est payer de la complexité pour un problème qu'on n'a peut-être pas. En attendant, l'export/import JSON transfère une bibliothèque d'un appareil à l'autre.

Le jour où ça manque, il faut :

1. un petit VPS (~4 €/mois) avec Caddy pour le HTTPS automatique, une API en Node et Postgres ou SQLite ;
2. un endpoint `/sync` : le client envoie les lignes `dirty` depuis son dernier curseur, reçoit celles modifiées côté serveur, dernier `updatedAt` gagnant ;
3. remettre `dirty` à 0 après confirmation.

Quelques centaines de lignes, pas un sous-système. Pas besoin de CRDT pour un seul utilisateur : les conflits réels sont quasi inexistants.

Bonus : ce même serveur permettrait d'ajouter un proxy vers d'autres catalogues et d'élargir la recherche BnF au-delà du seul ISBN.

---

# Limites connues

- **La recherche par titre/auteur n'interroge pas la BnF**, seulement Open Library et Google Books. La BnF sert uniquement de recours par ISBN : sa pertinence en recherche libre est faible (8 892 résultats pour « l'étranger ») et ses notices n'ont pas de couverture.
- **Pas de gestion des séries/tomes.** Un tome est un livre comme un autre.
- **Les couvertures ne sont pas redimensionnées** avant stockage : on garde le format `M` d'Open Library (~18 Ko mesuré). Pour 500 livres, compte ~10 Mo.
- **L'import ne reprend pas les couvertures du fichier source**, seulement les métadonnées. Elles sont retéléchargées depuis l'ISBN quand l'option d'enrichissement est active.

---

# Sources de données

Métadonnées fournies par [Open Library](https://openlibrary.org/developers/api) (Internet Archive, données CC0), [Google Books](https://developers.google.com/books) et le [catalogue général de la BnF](https://api.bnf.fr/api-sru-catalogue-general).

Aucune donnée personnelle ne quitte l'appareil. Les seules requêtes réseau sont les recherches de livres et le téléchargement des couvertures.
