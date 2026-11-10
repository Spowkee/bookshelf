# Développement

Documentation technique. Pour l'installation et l'usage de l'app, voir [README.md](README.md).

---

## Démarrer

Node 20 ou plus. Aucun autre outil.

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

Le port est 5180 et non le 5173 par défaut de Vite, souvent déjà pris.

## Tester le scanner

L'accès caméra (`getUserMedia`) exige un **contexte sécurisé** : `https://` ou `localhost`.

- **Sur le poste de dev** : `http://localhost:5180` convient, la webcam fait office de scanner.
- **Sur un téléphone** : une IP locale (`http://192.168.x.x`) n'est pas un contexte sécurisé, le scanner refusera de démarrer. Passer par un tunnel :

  ```bash
  npx cloudflared tunnel --url http://localhost:5180
  ```

  C'est la seule méthode utilisable sur iPhone. Sur Android seulement, `chrome://flags/#unsafely-treat-insecure-origin-as-secure` accepte une origine en clair.

La saisie manuelle d'ISBN fonctionne sans caméra et suffit à exercer toute la chaîne de métadonnées.

## Tests

```bash
npm test
```

70 vérifications sur `lib/csv.ts` et `lib/importMapping.ts` — les deux seuls modules qui traitent des données non maîtrisées (un fichier exporté par une application tierce) et où une erreur est silencieuse : un ISBN mal découpé donne un livre importé de travers, pas une exception.

Couvre le parseur CSV (guillemets, virgules et sauts de ligne dans les champs, détection du séparateur, enrobage Excel `="…"`), la détection automatique des colonnes sur les formats Goodreads et français, et la normalisation des statuts, notes, dates, auteurs, ISBN et langues.

Les trois sources de métadonnées ont été validées à la main contre les API réelles, pas dans une suite rejouable : elles dépendent du réseau et de services tiers.

## Systèmes de fichiers montés

Sur un lecteur réseau ou un partage Windows monté sous WSL, inotify ne remonte pas les modifications et le rechargement à chaud reste muet. `vite.config.ts` détecte le cas (chemin sous `/mnt/`) et bascule sur une scrutation active. Sur disque local, rien ne s'active.

---

## Structure

```
src/
├── api/                  Récupération des métadonnées
│   ├── types.ts          BookDraft : la forme normalisée commune
│   ├── openlibrary.ts    Open Library — source principale
│   ├── googlebooks.ts    Google Books + gestion du quota
│   ├── bnf.ts            BnF SRU/UNIMARC — fonds français
│   └── index.ts          Fusion, déduplication, chaîne de couvertures
├── db/
│   ├── schema.ts         Types + base Dexie (IndexedDB)
│   └── repo.ts           CRUD, couvertures, import/export, complétion, stats
├── scan/
│   ├── scanner.ts        Choix du moteur + accès caméra
│   └── wasmScanner.ts    ZXing WebAssembly (chargé à la demande)
├── lib/
│   ├── isbn.ts           Validation, conversion ISBN-10 ↔ 13
│   ├── language.ts       Codes MARC/ISO → nom de langue
│   ├── csv.ts            Lecture/écriture CSV (RFC 4180)
│   ├── importMapping.ts  Détection des colonnes, normalisation des valeurs
│   ├── image.ts          Réduction des couvertures photographiées
│   └── useBackClose.ts   Retour arrière dans les feuilles modales
├── components/           Écrans et UI
└── App.tsx               Navigation par onglets
```

## Particularités des services, mesurées

**La BnF indexe les ISBN-10, pas les ISBN-13.** `bib.isbn all "9782070360024"` renvoie 0 résultat là où `"2070360024"` renvoie la notice. `bnf.ts` convertit et essaie l'ISBN-10 en premier. Les notices sont en UNIMARC/XML avec cinq espaces de noms : utiliser `getElementsByTagNameNS('*', nom)`, jamais le nom qualifié.

**Open Library n'annonce pas toujours ses couvertures.** Le champ `cover` de `/api/books?jscmd=data` est parfois vide alors que l'image existe sur `covers.openlibrary.org`. D'où `coverCandidates()` dans `api/index.ts`, qui essaie l'URL construite depuis l'ISBN (taille L puis M), la vignette Google, puis l'ISBN-10. Mesuré sur un échantillon de dix ISBN français : **5 couvertures sur 10** via Open Library.

**Google limite par IP.** Sans clé, le quota est partagé par adresse ; certains réseaux (entreprise, VPN, datacenter) sont bloqués en permanence. `googlebooks.ts` espace les appels de 300 ms et se met en sommeil 15 minutes dès le premier 429, laissant les autres sources prendre le relais. Renseigner `VITE_GOOGLE_BOOKS_KEY` (voir `.env.example`) donne un quota propre au projet.

**L'enrobage `="…"`** des exports pensés pour Excel casse le découpage CSV quand la valeur contient une virgule : la RFC ne rend le guillemet spécial qu'en début de champ. `csv.ts` traite ce cas explicitement.

## Complétion des fiches

`refreshBooks()` dans `repo.ts` est conçu pour s'étaler sur plusieurs sessions :

- **Pause de 400 ms** entre deux livres, pour rester sous la limite d'Open Library (~1 req/s).
- **Journal des tentatives** dans la table `meta` (`refresh:attempts`), sauvegardé tous les 10 livres. Sans lui, chaque passage réinterrogerait les mêmes introuvables — et il y en a beaucoup.
- **`splitByFreshness()`** écarte ce qui a été tenté dans les 24 dernières heures.
- **Arrêt sur quota** : dès que `isThrottled()` est vrai, la boucle s'arrête proprement et `stoppedByQuota` est renvoyé avec le nombre de livres restants. Les non-traités gardent leur statut « jamais tenté » et repassent en tête au prochain lancement.
- **Jamais d'écrasement** : seuls les champs vides sont remplis. Les saisies de l'utilisateur et les titres corrigés à la main ne sont pas touchés.

## Le scanner

`createScanner()` choisit `BarcodeDetector` quand le navigateur l'expose (Chrome/Android), sinon importe dynamiquement `wasmScanner.ts`.

Le binaire ZXing pèse ~940 Ko. Il est **exclu du précache** (`globPatterns` dans `vite.config.ts`) et récupéré par une règle `CacheFirst` au premier scan : Android ne le télécharge jamais. Le précache total reste sous 450 Ko.

Sur le chemin WebAssembly, seule la bande centrale (45 % de la hauteur) est décodée, redimensionnée à 640 px de large — environ dix fois moins de calcul par image, sans perte de fiabilité sur un EAN-13.

## Modèle de données

Voir la section « Le modèle de données » du [README](README.md#le-modèle-de-données) pour le rôle de `createdAt` / `updatedAt` / `deletedAt` / `dirty`.

Deux contraintes d'IndexedDB à garder en tête :

- **les booléens ne sont pas indexables**, d'où `dirty: 0 | 1` ;
- **les blobs survivent aux rechargements** mais chaque `URL.createObjectURL` doit être révoqué, sinon le défilement de la grille fuit quelques Mo par écran (voir `BookCover.tsx`).

---

## Déployer

Le build est entièrement statique.

### GitHub Pages

`.github/workflows/deploy.yml` est prêt. Activer **Settings → Pages → Source : GitHub Actions**, puis pousser. Le workflow lance les tests, construit avec le bon préfixe et publie.

L'URL est `https://<pseudo>.github.io/<dépôt>/`. GitHub Pages n'est gratuit que sur un dépôt **public**.

### GitLab Pages

`.gitlab-ci.yml` est prêt, utilisable sur Framagit, gitlab.com ou une instance interne. GitLab publie aussi depuis un dépôt **privé** sans abonnement.

### Cloudflare Pages

Connecter le dépôt, build `npm run build`, output `dist`. Sert à la racine, donc aucun préfixe à configurer. Compatible dépôt privé.

### Préfixe de chemin

GitHub et GitLab Pages servent le site sous `/<nom-du-dépôt>/`. Sans préfixe, le service worker et les icônes partent en 404 et l'app refuse de s'installer. `vite.config.ts` lit `BASE_PATH` ; les deux workflows le renseignent automatiquement.

```bash
BASE_PATH=/bookshelf/ npm run build
```

Un hébergeur servant à la racine n'a besoin de rien.

### Contrainte commune

L'app **doit** être servie en `https://` : la caméra et le service worker sont refusés sur une origine non sécurisée. Tous les hébergeurs cités fournissent le certificat automatiquement.

---

## Pistes

- **Synchronisation multi-appareils.** Le schéma est prêt. Il faut un endpoint `/sync` : le client envoie les lignes `dirty` depuis son dernier curseur, reçoit celles modifiées côté serveur, dernier `updatedAt` gagnant, puis remet `dirty` à 0. Pas besoin de CRDT pour un utilisateur unique.
- **Proxy de catalogues.** Un backend permettrait d'élargir la recherche BnF au-delà du seul ISBN, et de porter une clé Google côté serveur.
- **Séries et tomes.** Demanderait un modèle à deux niveaux (œuvre / édition), que les catalogues exposent mal.
