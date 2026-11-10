/**
 * Tests du parseur CSV et de la correspondance de colonnes.
 *
 * Ces deux modules sont les seuls du projet à traiter des données qu'on ne
 * maîtrise pas — le fichier exporté par une application tierce — et où une
 * erreur est silencieuse : un ISBN mal découpé donne un livre importé de
 * travers, pas une exception. D'où des tests, là où le reste du code se
 * vérifie à l'œil.
 *
 * Lancement : npm test
 *
 * Les modules sont en TypeScript et importent des chemins relatifs ; on les
 * transpile à la volée avec l'esbuild déjà embarqué par Vite, plutôt que
 * d'ajouter un lanceur de tests au projet.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const out = mkdtempSync(join(tmpdir(), 'bookshelf-test-'))

function compile(name, rel) {
  const code = readFileSync(join(SRC, rel), 'utf8')
  const js = transformSync(code, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  // Les imports relatifs sont reecrits vers les fichiers compiles a plat.
  const flat = js.replace(/from\s+['"]\.\.?\/([^'"]+)['"]/g, (_m, p) => `from './${p.split('/').pop()}.mjs'`)
  writeFileSync(join(out, name + '.mjs'), flat)
}

compile('isbn', 'lib/isbn.ts')
compile('language', 'lib/language.ts')
compile('csv', 'lib/csv.ts')
compile('genre', 'lib/genre.ts')
compile('series', 'lib/series.ts')
compile('importMapping', 'lib/importMapping.ts')

// schema.ts tire Dexie, inutile ici : seules les constantes sont referencees.
writeFileSync(join(out, 'schema.mjs'), 'export const STATUS_LABELS={};export const STATUS_ORDER=[];export const db=null;\n')

const csv = await import(pathToFileURL(join(out, 'csv.mjs')).href)
const map = await import(pathToFileURL(join(out, 'importMapping.mjs')).href)
const lang = await import(pathToFileURL(join(out, 'language.mjs')).href)
const genre = await import(pathToFileURL(join(out, 'genre.mjs')).href)
const series = await import(pathToFileURL(join(out, 'series.mjs')).href)

let pass = 0
const failures = []

function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${label}\n    attendu : ${e}\n    obtenu  : ${a}`)
}

function section(name) {
  console.log('\n— ' + name)
}

// ---------------------------------------------------------------- parseur CSV

section('Parseur CSV')
const tricky =
  'Title,Author,Notes\n"Paris, je t\'aime","Dupont, Jean","Il a dit ""bravo"""\n"Ligne\navec saut",Camus,ok'
const p1 = csv.parseCsv(tricky)
check('separateur virgule detecte', p1.delimiter, ',')
check('deux lignes de donnees', p1.rows.length, 2)
check('virgule dans un champ quote', p1.rows[0].Title, "Paris, je t'aime")
check('guillemet echappe par doublement', p1.rows[0].Notes, 'Il a dit "bravo"')
check('saut de ligne dans un champ', p1.rows[1].Title, 'Ligne\navec saut')

const frCsv = "Titre;Auteur;Note\nL'Étranger;Albert Camus;4"
check('separateur point-virgule detecte', csv.parseCsv(frCsv).delimiter, ';')
check('tabulation detectee', csv.parseCsv('A\tB\tC\n1\t2\t3').delimiter, '\t')
check('BOM UTF-8 retire', csv.parseCsv('﻿Titre,Auteur\nA,B').headers, ['Titre', 'Auteur'])

section('Enrobage Excel ="…"')
const guard = csv.parseCsv('Title,Author,ISBN13\nLa Peste,="Camus, Albert",="9782070360420"')
check('colonnes non decalees', Object.keys(guard.rows[0]).length, 3)
check('virgule interne preservee', guard.rows[0].Author, 'Camus, Albert')
check('isbn intact', guard.rows[0].ISBN13, '9782070360420')

section('Ecriture CSV')
const written = csv.toCsv(['A', 'B'], [{ A: 'x,y', B: 'il a dit "ok"' }], ',')
check('aller-retour', csv.parseCsv(written).rows[0], { A: 'x,y', B: 'il a dit "ok"' })

// ------------------------------------------------------- detection colonnes

section('Détection automatique des colonnes')
const goodreads = map.autoMap([
  'Book Id', 'Title', 'Author', 'Author l-f', 'ISBN', 'ISBN13', 'My Rating', 'Publisher',
  'Number of Pages', 'Year Published', 'Date Read', 'Date Added', 'Bookshelves',
  'Exclusive Shelf', 'My Review',
])
check('goodreads: titre', goodreads.title, 'Title')
check('goodreads: isbn13 prefere a isbn', goodreads.isbn, 'ISBN13')
check('goodreads: statut', goodreads.status, 'Exclusive Shelf')
check('goodreads: note', goodreads.rating, 'My Rating')
check('goodreads: date de fin', goodreads.finishedAt, 'Date Read')

const fr = map.autoMap([
  'Titre', 'Auteur', 'ISBN', 'Éditeur', 'Année', 'Nombre de pages', 'Statut',
  'Ma note', 'Date de fin', 'Catégories', 'Série', 'Tome', 'Mots-clés', 'Commentaire',
])
check('fr: titre', fr.title, 'Titre')
check('fr: editeur accentue', fr.publisher, 'Éditeur')
check('fr: pages', fr.pageCount, 'Nombre de pages')
// « Catégories » designe un genre bien plus souvent qu'une liste de tags libres.
check('fr: genre', fr.genre, 'Catégories')
check('fr: serie', fr.series, 'Série')
check('fr: tome', fr.seriesIndex, 'Tome')
check('fr: tags', fr.tags, 'Mots-clés')
check('fr: notes perso', fr.notes, 'Commentaire')

// ---------------------------------------------------------- normalisations

section('Statuts')
for (const [input, expected] of [
  ['Lu', 'read'], ['read', 'read'], ['Terminé', 'read'],
  ['En cours de lecture', 'reading'], ['currently-reading', 'reading'],
  ['à lire', 'to-read'], ['to-read', 'to-read'], ['to read', 'to-read'], ['wishlist', 'to-read'],
  ['abandonné', 'abandoned'], ['DNF', 'abandoned'],
  ['', 'read'],
]) {
  check(`statut "${input}"`, map.parseStatus(input), expected)
}

section('Notes')
for (const [input, expected] of [
  ['4', 4], ['4/5', 4], ['8/10', 4], ['9', 5], ['★★★', 3], ['3,5', 4], ['0', undefined], ['', undefined],
]) {
  check(`note "${input}"`, map.parseRating(input), expected)
}

section('Dates')
for (const [input, expected] of [
  ['2023-07-01', '2023-07-01'],
  ['12/03/2023', '2023-03-12'],   // ambigu -> jour/mois (francophone)
  ['04/13/2023', '2023-04-13'],   // 13 ne peut etre un mois
  ['2019', '2019-01-01'],
  ['', undefined],
]) {
  check(`date "${input}"`, map.parseDate(input), expected)
}

section('Auteurs')
check('simple', map.parseAuthors('Albert Camus'), ['Albert Camus'])
check('nom, prenom', map.parseAuthors('Camus, Albert'), ['Albert Camus'])
check('liste point-virgule', map.parseAuthors('Camus; Sartre'), ['Camus', 'Sartre'])
check('liste avec "et"', map.parseAuthors('Deleuze et Guattari'), ['Deleuze', 'Guattari'])
check('vide', map.parseAuthors(''), [])

section('ISBN')
check('enrobe', map.parseIsbnCell('="9782070360024"'), { isbn13: '9782070360024', isbn10: undefined })
check('isbn10 converti', map.parseIsbnCell('2070360024'), { isbn13: '9782070360024', isbn10: '2070360024' })
check('avec tirets', map.parseIsbnCell('978-2-07-036002-4'), { isbn13: '9782070360024', isbn10: undefined })
check('invalide', map.parseIsbnCell('1234567890123'), { isbn13: undefined, isbn10: undefined })

section('Langues')
check('marc fre', lang.normalizeLanguage('fre'), 'fr')
check('marc eng', lang.normalizeLanguage('eng'), 'en')
check('iso fr', lang.normalizeLanguage('fr'), 'fr')
check('chemin bnf', lang.normalizeLanguage('/languages/fre'), 'fr')
check('etiquette fr-FR', lang.normalizeLanguage('fr-FR'), 'fr')
check('libelle', lang.languageLabel('fre'), 'Français')

// ------------------------------------------------------------ chaine complete

section('Chaîne complète : export Goodreads → livre')
const gr =
  'Title,Author,ISBN13,My Rating,Exclusive Shelf,Date Read,Number of Pages\n' +
  '"Stranger, The",="Camus, Albert",="9782070360024",4,read,2023/03/12,191'
const parsed = csv.parseCsv(gr)
const row = map.applyMapping(parsed.rows[0], map.autoMap(parsed.headers), 'read')
check('titre', row.title, 'Stranger, The')
check('auteur remis dans l\'ordre', row.authors, ['Albert Camus'])
check('isbn', row.isbn13, '9782070360024')
check('note', row.rating, 4)
check('statut', row.status, 'read')
check('date', row.finishedAt, '2023-03-12')
check('pages', row.pageCount, 191)

check('ligne sans titre ni isbn ignoree', map.applyMapping({ Title: '' }, { title: 'Title' }, 'read'), null)

section('Genres déduits des sujets')
for (const [subjects, expected] of [
  [['Detective and mystery stories', 'Fiction'], 'Policier'],
  [['Science fiction', 'Space opera'], 'Science-fiction'],
  [['Fiction', 'Philosophical novels'], 'Philosophie'],
  [['Bandes dessinées'], 'Bande dessinée'],
  [['Manga', 'Comics'], 'Manga'],
  [['Cooking', 'Recettes'], 'Cuisine'],
  [['Biography & Autobiography'], 'Biographie'],
  [['Juvenile Fiction'], 'Jeunesse'],
  [['Fiction'], 'Roman'],
  [[], undefined],
  [['Quelque chose de totalement inconnu'], undefined],
]) {
  check(`genre ${JSON.stringify(subjects)}`, genre.deriveGenre(subjects), expected)
}
// L'ordre des sujets ne doit rien changer
check(
  'ordre des sujets indifferent',
  genre.deriveGenre(['Fiction', 'Detective']),
  genre.deriveGenre(['Detective', 'Fiction']),
)

section('Séries et tomes')
for (const [title, expected] of [
  ['Harry Potter, tome 3', { series: 'Harry Potter', index: 3 }],
  ['Le Trône de fer - Tome 5', { series: 'Le Trône de fer', index: 5 }],
  ['Dune (tome 2)', { series: 'Dune', index: 2 }],
  ['Fondation, T3', { series: 'Fondation', index: 3 }],
  ['Les Thanatonautes, volume 2', { series: 'Les Thanatonautes', index: 2 }],
  ['Lanfeust de Troy #3', { series: 'Lanfeust de Troy', index: 3 }],
  ['Le Seigneur des anneaux, tome II', { series: 'Le Seigneur des anneaux', index: 2 }],
  ['Dune, Book 2', { series: 'Dune', index: 2 }],
  ['L\'Étranger', null],
  ['Paris, 1900', null],
  ['Vingt mille lieues sous les mers', null],
]) {
  check(`serie "${title}"`, series.parseSeries(title), expected)
}
check('libelle', series.seriesLabel('Dune', 2), 'Dune · tome 2')
check('libelle sans tome', series.seriesLabel('Dune'), 'Dune')
check('cle de regroupement', series.seriesKey('Le Trône de Fer'), series.seriesKey('le trone de fer'))

// ---------------------------------------------------------------- resultat

rmSync(out, { recursive: true, force: true })

console.log('')
if (failures.length > 0) {
  console.log(`✗ ${failures.length} échec(s) sur ${pass + failures.length} :\n`)
  for (const f of failures) console.log('  ' + f + '\n')
  process.exit(1)
}
console.log(`✓ ${pass} vérifications passées.`)
