# Bookshelf

Journal de lecture personnel. Tu scannes le code-barres au dos d'un livre, sa fiche se remplit toute seule, tu l'ajoutes à ta bibliothèque. Tout reste sur ton téléphone.

C'est une application web installable sur l'écran d'accueil, qui fonctionne hors-ligne. Pas de compte à créer, pas de store, pas de publicité, aucune donnée envoyée nulle part.

---

# Installer l'app

## Sur iPhone

1. Ouvrir l'adresse de l'app **dans Safari**. Chrome et Firefox sur iOS ne savent pas installer ce type d'application : iOS réserve cette fonction à Safari, et aucune version ne changera ça.
2. Appuyer sur le bouton **Partager** (le carré avec une flèche, en bas de l'écran).
3. Faire défiler la liste, choisir **« Sur l'écran d'accueil »**.
4. Valider.

L'icône apparaît parmi tes applications. Au lancement, pas de barre d'adresse ni d'onglets : l'app occupe tout l'écran comme n'importe quelle autre.

## Sur Android

Chrome propose **« Installer l'application »** dès la première visite. Si la bannière a disparu : menu **⋮** → **« Installer l'application »**.

## Avec Firefox

Ça dépend de l'appareil, et la différence n'est pas une question de version mais de ce que chaque système autorise.

**Firefox sur Android : oui.** Menu **⋮** → **« Installer »** (ou « Ajouter à l'écran d'accueil » selon la version). L'app s'installe et se lance en plein écran, exactement comme avec Chrome.

**Firefox sur iPhone : non, et ce n'est pas réparable.** iOS réserve l'installation d'applications web à Safari — tous les autres navigateurs en sont privés par le système. L'app fonctionnera très bien dans un onglet Firefox, mais sans icône sur l'écran d'accueil ni mode plein écran. Pour l'installer sur iPhone, il faut passer par Safari.

**Firefox sur ordinateur : non plus.** Mozilla a retiré l'installation d'applications web en 2021 et n'a pas annoncé de retour. L'app reste parfaitement utilisable dans un onglet — bibliothèque, recherche, import, export, tout marche — simplement sans icône dédiée.

Une remarque qui vaut pour tous les Firefox : le **scanner y est un peu plus lent** que sur Chrome. Firefox n'expose pas l'API de décodage native du système, l'app bascule donc sur son moteur de secours — le même que sur iPhone. Le décodage reste fiable, il demande juste une fraction de seconde de plus et un téléchargement supplémentaire au premier scan.

## Récapitulatif

| Navigateur | Installation | Scanner |
|---|---|---|
| Safari (iPhone) | ✅ Partager → Sur l'écran d'accueil | moteur de secours |
| Chrome (Android) | ✅ proposée automatiquement | décodage natif, le plus rapide |
| Firefox (Android) | ✅ menu ⋮ → Installer | moteur de secours |
| Firefox (iPhone) | ❌ interdit par iOS | fonctionne dans l'onglet |
| Firefox (ordinateur) | ❌ retiré par Mozilla | fonctionne dans l'onglet |
| Chrome / Edge (ordinateur) | ✅ icône dans la barre d'adresse | décodage natif |

## Au premier scan

Le navigateur demandera l'autorisation d'accéder à la caméra. **Il faut l'accorder**, sinon le scanner reste noir. Si tu as refusé par erreur, l'autorisation se rétablit dans les réglages du navigateur, à la ligne de l'app.

## Mises à jour

Rien à faire, jamais. L'app se met à jour toute seule au lancement suivant une nouvelle version. Pas de store, pas de validation, pas de réinstallation.

---

# Utiliser l'app

## Ajouter un livre

**Par le code-barres** — onglet **Scanner**, viser le code au dos du livre. Le code-barres imprimé *est* l'ISBN du livre : la fiche se remplit toute seule (titre, auteur, éditeur, année, pagination, résumé, couverture). Tu choisis l'état de lecture et c'est ajouté.

**À la main** — pour un livre ancien sans code-barres, ou dont l'étiquette est abîmée, l'onglet Scanner propose la saisie directe de l'ISBN sous la caméra.

**Par le titre** — onglet **Chercher**, pour un livre emprunté, prêté, ou que tu n'as pas sous la main. Les champs titre, auteur et éditeur se combinent.

Si tu scannes un livre déjà présent, l'app te prévient avant de créer un doublon.

## Quatre états de lecture

**Lu**, **En cours**, **À lire**, **Abandonné**. L'état se change à tout moment depuis la fiche du livre. Les dates de début et de fin se pré-remplissent quand tu bascules un livre en « En cours » ou en « Lu » — on le fait presque toujours le jour même.

## Retrouver un livre

L'onglet **Bibliothèque** propose :

- un **champ de filtre** qui cherche dans les titres, les auteurs, les éditeurs et tes tags ;
- des **filtres par état** et **par tag** ;
- un **tri** par date d'ajout, titre, auteur, année ou note.

**L'index alphabétique** apparaît sur le bord droit dès que tu tries par titre ou par auteur. Un appui sur une lettre saute directement à la section ; un glissement du doigt le long de la barre fait défiler en continu, avec la lettre affichée en gros au milieu de l'écran. Le classement suit le **titre exact**, article compris : « Les Misérables » se range à **L**, comme sur l'étagère.

## Enrichir une fiche

Appuyer sur une couverture ouvre la fiche du livre : note sur 5, dates de lecture, tags personnels, notes de lecture libres. Les tags se saisissent séparés par des virgules et deviennent ensuite des filtres dans la bibliothèque.

## Revenir en arrière

Trois façons, au choix :

- le bouton **Retour** en haut à gauche de chaque fiche ;
- le **bouton retour d'Android**, qui referme la fiche au lieu de quitter l'app ;
- un **glissement vers le bas** depuis le haut de la fiche.

## Couvertures manquantes

Les catalogues n'ont d'image que pour une partie des livres — environ la moitié pour l'édition française. Deux recours :

**Compléter automatiquement** — Réglages → **« Chercher les fiches incomplètes »**. L'app repère les livres sans couverture, sans résumé ou sans pagination, puis réinterroge les catalogues via leur ISBN. Rien de ce que tu as saisi n'est touché : notes, tags, dates, statuts et titres corrigés à la main sont préservés, seuls les champs vides sont remplis.

Le travail est conçu pour s'étaler : les requêtes partent une par une avec une pause entre chacune, et si Google atteint sa limite — elle est comptée par connexion et se renouvelle seule — l'app s'arrête proprement en indiquant combien de livres restent. Il suffit de relancer plus tard, ou le lendemain : **la reprise se fait exactement là où elle s'est arrêtée**, sans redemander ce qui a déjà été traité. Les livres cherchés en vain ne sont pas réinterrogés avant 24 heures.

**Photographier la couverture** — depuis la fiche d'un livre, bouton **« Photographier la couverture »**. C'est souvent le seul moyen pour les livres qu'aucun catalogue n'illustre. L'image est automatiquement réduite avant d'être stockée, pour ne pas saturer la mémoire du téléphone.

## Venir d'une autre application

Réglages → **« Importer un fichier »**. L'app accepte le CSV ou le JSON exporté par ClassBook, Goodreads, BookBuddy, Libib ou un simple tableur.

Les colonnes sont reconnues automatiquement d'après leurs intitulés, en français comme en anglais. Un écran te laisse corriger la correspondance si une colonne a été mal devinée, et un aperçu montre les premiers livres avant que quoi que ce soit ne soit écrit. Les fiches incomplètes peuvent être complétées via leur ISBN dans la foulée.

Les livres déjà présents sont détectés et ignorés : tu peux réimporter le même fichier sans créer de doublons.

## Exporter et sauvegarder

| Format | Pour quoi |
|---|---|
| **JSON** | sauvegarde complète, se réimporte sans créer de doublons |
| **CSV « Excel FR »** | ouverture directe dans Excel en configuration française |
| **CSV « standard »** | alimenter une autre application |

## ⚠️ À lire : la sauvegarde

Tes livres vivent **uniquement sur ton téléphone**. Il n'y a pas de serveur, donc pas de copie ailleurs.

**Exporte régulièrement en JSON** (Réglages → Exporter). Deux raisons :

1. Si tu perds le téléphone, tu perds tout.
2. iOS peut effacer les données d'une application web restée longtemps inutilisée. En pratique, une app ajoutée à l'écran d'accueil est épargnée, mais ce n'est garanti nulle part.

Le bouton **« Demander un stockage persistant »** demande au navigateur de ne pas purger tes données. Android accepte souvent, iOS rarement.

L'export JSON est aussi ta porte de sortie : le format est lisible et documenté, tu pourras reprendre tes données ailleurs sans rien ressaisir.

## Sur plusieurs appareils

Chaque appareil garde sa propre bibliothèque — il n'y a pas de synchronisation automatique. Pour transférer : **Exporter en JSON** sur le premier, **Importer un fichier** sur le second.

---

# Comment ça marche

## Les sources de métadonnées

Trois catalogues, interrogés dans cet ordre :

| Source | Apport |
|---|---|
| **Open Library** (Internet Archive) | données bibliographiques, couvertures libres |
| **Google Books** | résumés, pagination des éditions récentes |
| **BnF** (catalogue général) | édition française ancienne ou confidentielle |

Pour une recherche par ISBN, **Open Library et Google sont interrogés en parallèle puis fusionnés**, pas en cascade : leurs lacunes ne se recouvrent pas, et deux requêtes simultanées coûtent le même temps qu'une seule tout en donnant une fiche nettement plus complète. La BnF n'intervient que si les deux premières ne trouvent rien.

Trois particularités de ces services, mesurées et contournées :

- **La BnF indexe les ISBN-10, pas les ISBN-13.** Chercher `9782070360024` ne renvoie rien là où `2070360024` renvoie la notice. L'app convertit avant d'interroger.
- **Open Library annonce parfois « pas de couverture » alors que l'image existe** sur son serveur d'images. L'app essaie systématiquement l'URL construite depuis l'ISBN, puis plusieurs tailles, puis la vignette Google, puis l'ISBN-10.
- **Google limite les requêtes par adresse IP.** Si la limite est atteinte, l'app continue de fonctionner avec les autres sources ; seuls les résumés manquent.

## Le scanner

Deux moteurs de décodage, choisis automatiquement selon le navigateur :

- l'**API native** du navigateur sur Android — décodage par le système, quasi gratuit en énergie ;
- **ZXing compilé en WebAssembly** sur iPhone, Safari n'ayant pas d'API native.

Le moteur WebAssembly pèse ~940 Ko. Il n'est téléchargé qu'au premier scan sur les appareils qui en ont besoin, puis conservé : Android ne le télécharge jamais. Seule la bande centrale visée est analysée, réduite à 640 px de large — dix fois moins de calcul, sans perte de fiabilité.

## Le stockage

Tout vit dans la base de données locale du navigateur (IndexedDB), sur l'appareil.

Les **couvertures sont copiées en dur** au moment de l'ajout plutôt que rechargées depuis internet : c'est ce qui permet de consulter sa bibliothèque en mode avion, et de ne pas dépendre de la disponibilité d'un service tiers. Compter environ 20 Ko par couverture, soit ~10 Mo pour 500 livres.

L'app elle-même est mise en cache à l'installation : elle démarre et fonctionne sans réseau. Seuls l'ajout d'un nouveau livre et la complétion des fiches nécessitent une connexion — il faut bien interroger les catalogues.

## Le modèle de données

Un livre réunit trois familles d'informations :

**Ce qui vient des catalogues** — titre, sous-titre, auteurs, éditeur, année, pagination, langue, résumé, sujets, ISBN, couverture.

**Ce que tu saisis** — état de lecture, note sur 5, dates de début et de fin, tags, notes personnelles. Ces champs ne sont **jamais** écrasés par une mise à jour depuis les catalogues.

**Quatre champs techniques**, invisibles, qui ne servent à rien aujourd'hui mais préparent une éventuelle synchronisation entre appareils :

| Champ | Rôle |
|---|---|
| `createdAt` | date d'ajout |
| `updatedAt` | départage les conflits : la version la plus récente gagne |
| `deletedAt` | une suppression marque la ligne au lieu de l'effacer |
| `dirty` | la ligne n'a pas encore été transmise |

Le troisième est le plus important. Sans lui, un livre supprimé sur un appareil « ressusciterait » à la première synchronisation avec un autre appareil qui l'a encore en mémoire. C'est déjà la règle appliquée à l'import : réimporter un fichier ne crée pas de doublons, et un livre n'est remplacé que si la version importée est plus récente.

## Et la synchronisation ?

Volontairement absente. Elle demanderait un serveur, donc un coût mensuel et de la maintenance, pour un besoin que l'export/import JSON couvre déjà. Le modèle de données est prêt : elle pourra être ajoutée plus tard sans rien casser ni migrer.

---

# Ce que l'app ne fait pas

- **Pas de gestion des séries ni des tomes** : chaque tome est un livre comme un autre.
- **La recherche par titre n'interroge pas la BnF**, seulement Open Library et Google Books. La BnF sert de recours par ISBN : en recherche libre, sa pertinence est faible et ses notices n'ont pas d'images.
- **Pas de prêt ni d'emprunt** : aucun suivi de qui a quel livre.
- **Pas de lecture de livres numériques** : c'est un journal, pas une liseuse.

---

# Vie privée

Aucune donnée personnelle ne quitte l'appareil. Il n'y a ni compte, ni inscription, ni traceur, ni publicité. Les seules requêtes réseau sont les recherches de livres auprès des catalogues et le téléchargement des couvertures — rien qui t'identifie n'y figure.

Ta bibliothèque, tes notes et tes tags restent dans le stockage de ton téléphone et n'en sortent que si tu les exportes toi-même.

Métadonnées fournies par [Open Library](https://openlibrary.org) (Internet Archive, données CC0), [Google Books](https://books.google.com) et le [catalogue général de la BnF](https://catalogue.bnf.fr).

---

*Développement, tests et déploiement : voir [DEVELOPMENT.md](DEVELOPMENT.md).*
