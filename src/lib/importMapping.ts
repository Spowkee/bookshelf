import type { ReadingStatus } from '../db/schema'
import { toIsbn13, normalizeIsbn, isValidIsbn10 } from './isbn'
import { normalizeLanguage } from './language'
import type { CsvRow } from './csv'

/**
 * Correspondance entre les colonnes d'un fichier étranger et notre modèle.
 *
 * Aucune application n'exporte le même format : ClassBook, Goodreads, BookBuddy,
 * Libib, un tableur bricolé à la main… Plutôt que de coder un lecteur par
 * application — impossible à maintenir, et inutile pour celle qu'on n'a pas
 * prévue — on devine les colonnes par leurs intitulés et on laisse l'utilisateur
 * corriger. Les intitulés anglais et français sont reconnus.
 */

export type FieldKey =
  | 'title'
  | 'authors'
  | 'isbn'
  | 'publisher'
  | 'publishedYear'
  | 'pageCount'
  | 'language'
  | 'description'
  | 'status'
  | 'rating'
  | 'startedAt'
  | 'finishedAt'
  | 'tags'
  | 'notes'

export const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Titre',
  authors: 'Auteur(s)',
  isbn: 'ISBN',
  publisher: 'Éditeur',
  publishedYear: 'Année',
  pageCount: 'Pages',
  language: 'Langue',
  description: 'Résumé',
  status: 'Statut',
  rating: 'Note',
  startedAt: 'Date de début',
  finishedAt: 'Date de fin',
  tags: 'Tags',
  notes: 'Notes perso',
}

export const FIELD_ORDER: FieldKey[] = [
  'title', 'authors', 'isbn', 'status', 'rating',
  'finishedAt', 'startedAt', 'tags', 'notes',
  'publisher', 'publishedYear', 'pageCount', 'language', 'description',
]

/** Réduit un intitulé à sa forme comparable : sans accents, sans ponctuation. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Alias par champ, du plus spécifique au plus générique. L'ordre compte :
 * `isbn13` doit être testé avant `isbn`, et `datedefin` avant `date`.
 */
const ALIASES: Record<FieldKey, string[]> = {
  isbn: ['isbn13', 'isbn10', 'isbn', 'ean13', 'ean', 'codebarres', 'codebarre', 'barcode', 'gtin'],
  title: ['titre', 'title', 'booktitle', 'titredulivre', 'nomdulivre', 'ouvrage', 'livre', 'nom'],
  authors: ['auteurs', 'auteur', 'authors', 'author', 'authorlf', 'ecrivain', 'creator', 'par', 'by'],
  publisher: ['editeur', 'publisher', 'maisondedition', 'edition', 'publishing'],
  publishedYear: [
    'anneedepublication', 'annedepublication', 'originalpublicationyear', 'yearpublished',
    'publicationyear', 'datedepublication', 'datepublication', 'publieren', 'annee', 'year', 'parution',
  ],
  pageCount: ['nombredepages', 'nbpages', 'numberofpages', 'pagecount', 'pages'],
  language: ['langue', 'language', 'lang', 'langueoriginale'],
  description: ['resume', 'description', 'synopsis', 'summary', 'quatriemedecouverture'],
  status: [
    'exclusiveshelf', 'bookshelves', 'statut', 'status', 'etat', 'etagere', 'shelf', 'shelves',
    'lecture', 'etatdelecture', 'readstatus',
  ],
  rating: ['myrating', 'manote', 'notation', 'note', 'rating', 'etoiles', 'stars', 'appreciation'],
  startedAt: ['datestarted', 'datededebut', 'datedebut', 'startdate', 'commencele', 'debutlecture'],
  finishedAt: [
    'dateread', 'datefinished', 'datedefin', 'datefin', 'datedelecture', 'datelu', 'finishdate',
    'termine le', 'terminele', 'finlecture', 'lule',
  ],
  tags: ['tags', 'etiquettes', 'categories', 'categorie', 'genres', 'genre', 'motscles', 'keywords', 'collection'],
  notes: ['myreview', 'commentaire', 'commentaires', 'avis', 'review', 'notesperso', 'remarques', 'notes'],
}

export type Mapping = Partial<Record<FieldKey, string>>

/**
 * Associe automatiquement chaque champ à une colonne du fichier.
 * Une colonne déjà prise n'est pas réattribuée : sur un export Goodreads,
 * « ISBN » et « ISBN13 » existent tous les deux, on garde le premier trouvé.
 */
export function autoMap(headers: string[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<string>()
  const folded = headers.map((h) => ({ raw: h, key: fold(h) }))

  for (const field of Object.keys(ALIASES) as FieldKey[]) {
    for (const alias of ALIASES[field]) {
      // Correspondance exacte d'abord : plus sure qu'une inclusion.
      const exact = folded.find((h) => h.key === alias && !used.has(h.raw))
      if (exact) {
        mapping[field] = exact.raw
        used.add(exact.raw)
        break
      }
    }
    if (mapping[field]) continue

    for (const alias of ALIASES[field]) {
      const partial = folded.find((h) => h.key.includes(alias) && !used.has(h.raw))
      if (partial) {
        mapping[field] = partial.raw
        used.add(partial.raw)
        break
      }
    }
  }

  return mapping
}

// ------------------------------------------------------------- normalisation

/**
 * Motifs testés sur la valeur **repliée** (sans accents ni ponctuation) :
 * « to-read », « to read » et « toread » doivent tous tomber sur le même cas,
 * or les séparateurs varient d'une application à l'autre.
 *
 * L'ordre compte : « currently-reading » contient « read », donc le motif
 * « en cours » doit être testé avant celui de « lu ».
 */
const STATUS_PATTERNS: Array<[ReadingStatus, RegExp]> = [
  ['reading', /encours|currently|entrain|lectureencours|reading|enlecture/],
  ['abandoned', /abandon|dnf|arrete|stopped|giveup|pasfini|nonfini|interrompu/],
  ['to-read', /alire|toread|wanttoread|wishlist|envie|souhait|pile|pal|nonlu|unread/],
  ['read', /^lus?$|read|termine|fini|done|acheve|dejalu|deja/],
]

/**
 * Déduit le statut de lecture. En l'absence d'indication exploitable, on
 * retient « Lu » : on importe une bibliothèque de livres déjà lus bien plus
 * souvent qu'une liste d'envies.
 */
export function parseStatus(raw: string | undefined, fallback: ReadingStatus = 'read'): ReadingStatus {
  if (!raw?.trim()) return fallback
  const folded = fold(raw)
  if (!folded) return fallback
  for (const [status, pattern] of STATUS_PATTERNS) {
    if (pattern.test(folded)) return status
  }
  return fallback
}

/**
 * Note sur 5. Accepte « 4 », « 4/5 », « 4,5 », « 8/10 », « ★★★★ ».
 * Une valeur au-delà de 5 est supposée sur 10 et divisée par deux :
 * c'est l'échelle de Babelio et de plusieurs applications françaises.
 */
export function parseRating(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined
  const value = raw.trim()

  const stars = value.match(/[★⭐]/g)
  if (stars) return Math.min(5, stars.length)

  const fraction = value.match(/^([\d.,]+)\s*\/\s*(\d+)/)
  if (fraction) {
    const num = Number(fraction[1].replace(',', '.'))
    const den = Number(fraction[2])
    if (!Number.isNaN(num) && den > 0) return clampRating((num / den) * 5)
  }

  const num = Number(value.replace(',', '.').replace(/[^\d.]/g, ''))
  if (Number.isNaN(num) || num <= 0) return undefined
  return clampRating(num > 5 ? num / 2 : num)
}

function clampRating(n: number): number | undefined {
  const rounded = Math.round(n)
  if (rounded < 1) return undefined
  return Math.min(5, rounded)
}

/**
 * Date au format ISO (AAAA-MM-JJ).
 *
 * Sur une date ambiguë comme 03/04/2023, on lit **jour/mois** : les
 * applications visées sont francophones. Une valeur dont le premier nombre
 * dépasse 12 lève l'ambiguïté toute seule, et l'inverse aussi (04/13/2023 ne
 * peut être que mois/jour).
 */
export function parseDate(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const value = raw.trim()

  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slash = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (slash) {
    let a = Number(slash[1])
    let b = Number(slash[2])
    let year = Number(slash[3])
    if (year < 100) year += year < 50 ? 2000 : 1900
    // Si le second nombre depasse 12, il ne peut pas etre un mois.
    if (b > 12 && a <= 12) [a, b] = [b, a]
    return isoDate(year, b, a)
  }

  const yearOnly = value.match(/^(\d{4})$/)
  if (yearOnly) return `${yearOnly[1]}-01-01`

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)

  return undefined
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Sépare une liste d'auteurs. Gère le cas « Camus, Albert » (nom, prénom),
 * fréquent dans les exports de catalogues, en le distinguant d'une vraie liste.
 */
export function parseAuthors(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  const value = raw.trim()

  if (/[;|]/.test(value)) {
    return value.split(/[;|]/).map(flipName).filter(Boolean)
  }
  if (/\s+(et|and|&)\s+/i.test(value)) {
    return value.split(/\s+(?:et|and|&)\s+/i).map(flipName).filter(Boolean)
  }
  // Une seule virgule et deux mots : c'est « Nom, Prenom », pas deux auteurs.
  const commas = value.split(',')
  if (commas.length === 2 && commas.every((p) => p.trim().split(/\s+/).length <= 3)) {
    return [flipName(value)].filter(Boolean)
  }
  if (commas.length > 1) {
    return commas.map((p) => p.trim()).filter(Boolean)
  }
  return [value]
}

function flipName(name: string): string {
  const trimmed = name.trim()
  const parts = trimmed.split(',')
  if (parts.length === 2 && parts[1].trim()) {
    return `${parts[1].trim()} ${parts[0].trim()}`
  }
  return trimmed
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20)
}

export function parseYear(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined
  const m = raw.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)
  return m ? Number(m[1]) : undefined
}

export function parseInt10(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined
  const n = Number(raw.replace(/[^\d]/g, ''))
  return Number.isNaN(n) || n <= 0 ? undefined : n
}

/**
 * Retire l'enrobage `="…"` que Goodreads — et tout export pensé pour Excel —
 * place autour des valeurs à préserver comme du texte, pour empêcher le
 * tableur de transformer un ISBN en notation scientifique. Ce préfixe apparaît
 * aussi sur les auteurs et les dates, pas seulement sur l'ISBN.
 */
export function stripExcelGuard(raw: string): string {
  const trimmed = raw.trim()
  const m = trimmed.match(/^=\s*"(.*)"$/s)
  return m ? m[1] : trimmed
}

/** Les exports Goodreads encadrent l'ISBN ainsi : ="9782070360024". */
export function parseIsbnCell(raw: string | undefined): { isbn13?: string; isbn10?: string } {
  if (!raw?.trim()) return {}
  const cleaned = normalizeIsbn(stripExcelGuard(raw))
  if (!cleaned) return {}
  const isbn13 = toIsbn13(cleaned) ?? undefined
  return {
    isbn13,
    isbn10: isValidIsbn10(cleaned) ? cleaned : undefined,
  }
}

// ------------------------------------------------------------------ rangée

export interface MappedRow {
  title: string
  authors: string[]
  isbn13?: string
  isbn10?: string
  publisher?: string
  publishedYear?: number
  pageCount?: number
  language?: string
  description?: string
  status: ReadingStatus
  rating?: number
  startedAt?: string
  finishedAt?: string
  tags: string[]
  notes?: string
}

/** Applique la correspondance à une ligne. Renvoie null si le titre manque. */
export function applyMapping(row: CsvRow, mapping: Mapping, defaultStatus: ReadingStatus): MappedRow | null {
  const get = (field: FieldKey): string | undefined => {
    const column = mapping[field]
    if (!column) return undefined
    const value = row[column]
    // L'enrobage Excel ="…" peut coiffer n'importe quelle colonne, pas que l'ISBN.
    return value === undefined ? undefined : stripExcelGuard(value)
  }

  const isbn = parseIsbnCell(get('isbn'))
  const title = get('title')?.trim()

  // Un titre vide mais un ISBN valide reste exploitable : on completera la
  // fiche depuis les catalogues. Sans l'un ni l'autre, la ligne est perdue.
  if (!title && !isbn.isbn13) return null

  return {
    title: title || `ISBN ${isbn.isbn13}`,
    authors: parseAuthors(get('authors')),
    isbn13: isbn.isbn13,
    isbn10: isbn.isbn10,
    publisher: get('publisher')?.trim() || undefined,
    publishedYear: parseYear(get('publishedYear')),
    pageCount: parseInt10(get('pageCount')),
    language: normalizeLanguage(get('language')),
    description: get('description')?.trim() || undefined,
    status: parseStatus(get('status'), defaultStatus),
    rating: parseRating(get('rating')),
    startedAt: parseDate(get('startedAt')),
    finishedAt: parseDate(get('finishedAt')),
    tags: parseTags(get('tags')),
    notes: get('notes')?.trim() || undefined,
  }
}
