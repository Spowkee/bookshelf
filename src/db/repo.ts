import { db, STATUS_LABELS, type Book, type ReadingStatus } from './schema'
import type { BookDraft } from '../api/types'
import { toCsv } from '../lib/csv'
import { formatIsbn } from '../lib/isbn'
import { languageLabel } from '../lib/language'
import type { MappedRow } from '../lib/importMapping'
import { deriveGenre } from '../lib/genre'
import { parseSeries } from '../lib/series'

const nowIso = () => new Date().toISOString()

function newId(): string {
  // randomUUID exige un contexte sécurisé (https ou localhost) : toujours vrai
  // pour une PWA, mais on garde un repli pour les tests en http sur IP locale.
  const webCrypto = globalThis.crypto as Crypto | undefined
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function draftToBook(draft: BookDraft, status: ReadingStatus = 'read'): Book {
  const ts = nowIso()
  const serie = parseSeries(draft.title)
  return {
    id: newId(),
    isbn13: draft.isbn13,
    isbn10: draft.isbn10,
    title: draft.title,
    subtitle: draft.subtitle,
    authors: draft.authors,
    publisher: draft.publisher,
    publishedYear: draft.publishedYear,
    pageCount: draft.pageCount,
    language: draft.language,
    description: draft.description,
    subjects: draft.subjects,
    coverUrl: draft.coverUrl,
    source: draft.source,
    sourceId: draft.sourceId,
    genre: deriveGenre(draft.subjects, draft.title),
    series: serie?.series,
    seriesIndex: serie?.index,
    status,
    tags: [],
    finishedAt: status === 'read' ? ts.slice(0, 10) : undefined,
    startedAt: status === 'reading' ? ts.slice(0, 10) : undefined,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
    dirty: 1,
  }
}

/** Tous les livres vivants, les plus récemment touchés en premier. */
export async function allBooks(): Promise<Book[]> {
  const books = await db.books.filter((b) => b.deletedAt === null).toArray()
  return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Valeurs déjà employées dans la bibliothèque, pour les proposer en saisie.
 *
 * C'est ce qui évite d'avoir « policier », « Policier » et « polcier » comme
 * trois tags distincts : on propose l'existant plutôt que de laisser retaper.
 */
export async function listSuggestions(): Promise<{ tags: string[]; series: string[] }> {
  const books = await allBooks()
  const tags = new Map<string, number>()
  const series = new Set<string>()

  for (const b of books) {
    for (const t of b.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
    if (b.series) series.add(b.series)
  }

  return {
    // Les tags les plus employés d'abord : ce sont ceux qu'on veut rajouter.
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([t]) => t),
    series: [...series].sort((a, b) => a.localeCompare(b, 'fr')),
  }
}

export async function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id)
}

/** Un ISBN déjà présent ? Sert à prévenir les doublons au scan. */
export async function findByIsbn(isbn13: string): Promise<Book | undefined> {
  const matches = await db.books.where('isbn13').equals(isbn13).toArray()
  return matches.find((b) => b.deletedAt === null)
}

export async function addBook(book: Book): Promise<string> {
  await db.books.add(book)
  return book.id
}

export async function updateBook(id: string, changes: Partial<Book>): Promise<void> {
  await db.books.update(id, { ...changes, updatedAt: nowIso(), dirty: 1 })
}

/**
 * Suppression logique : la ligne reste, marquée d'un tombstone. Sans ça, une
 * suppression faite ici serait annulée à la première synchro par un appareil
 * qui a encore le livre. Les couvertures, elles, partent pour de bon : elles
 * sont retéléchargeables.
 */
export async function deleteBook(id: string): Promise<void> {
  const ts = nowIso()
  await db.transaction('rw', db.books, db.covers, async () => {
    await db.books.update(id, { deletedAt: ts, updatedAt: ts, dirty: 1 })
    await db.covers.delete(id)
  })
}

export async function restoreBook(id: string): Promise<void> {
  await db.books.update(id, { deletedAt: null, updatedAt: nowIso(), dirty: 1 })
}

/** Purge définitive des tombstones anciens. À n'appeler qu'après une synchro. */
export async function purgeTombstones(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString()
  const doomed = await db.books.filter((b) => b.deletedAt !== null && b.deletedAt < cutoff && b.dirty === 0).toArray()
  await db.books.bulkDelete(doomed.map((b) => b.id))
  return doomed.length
}

// ---------------------------------------------------------------- couvertures

/**
 * Télécharge la couverture et la stocke en blob. On copie l'image localement
 * au lieu de pointer vers l'URL distante : c'est la seule façon que la
 * bibliothèque s'affiche en mode avion, et ça nous rend indépendants de la
 * disponibilité d'Open Library.
 */
export async function cacheCover(bookId: string, url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    const blob = await res.blob()
    // Open Library renvoie un GIF de 807 octets quand la couverture n'existe
    // pas, malgré default=false sur certains chemins. On écarte les miniatures.
    if (!blob.type.startsWith('image/') || blob.size < 1200) return false
    await db.covers.put({ bookId, blob, fetchedAt: nowIso() })
    return true
  } catch {
    return false
  }
}

/**
 * Essaie plusieurs URL et garde la première image valable.
 * Renvoie l'URL retenue, ou null si aucune n'a donné d'image.
 */
export async function cacheCoverFromCandidates(bookId: string, urls: string[]): Promise<string | null> {
  for (const url of urls) {
    if (await cacheCover(bookId, url)) return url
  }
  return null
}

/**
 * Enregistre une couverture choisie ou photographiee par l'utilisateur.
 * C'est le seul recours pour la moitie des livres francais, qu'aucun
 * catalogue n'illustre.
 */
export async function setUserCover(bookId: string, blob: Blob): Promise<void> {
  await db.covers.put({ bookId, blob, fetchedAt: nowIso() })
  await updateBook(bookId, {})
}

export async function removeCover(bookId: string): Promise<void> {
  await db.covers.delete(bookId)
  await updateBook(bookId, {})
}

export async function getCoverBlob(bookId: string): Promise<Blob | undefined> {
  return (await db.covers.get(bookId))?.blob
}

export async function hasCover(bookId: string): Promise<boolean> {
  return (await db.covers.get(bookId)) !== undefined
}

export async function coversSize(): Promise<{ count: number; bytes: number }> {
  let bytes = 0
  let count = 0
  await db.covers.each((c) => {
    bytes += c.blob.size
    count++
  })
  return { count, bytes }
}

// --------------------------------------------------------------- export/import

export interface ExportPayload {
  format: 'bookshelf-export'
  version: 1
  exportedAt: string
  books: Book[]
}

/**
 * Export JSON — la porte de sortie. Sans elle, tes données sont prisonnières
 * du stockage du navigateur, qu'iOS peut purger. C'est aussi ce qui te permet
 * de changer d'app un jour sans tout ressaisir.
 * Les couvertures ne sont pas incluses : elles se retéléchargent à l'import.
 */
export async function exportJson(): Promise<ExportPayload> {
  return {
    format: 'bookshelf-export',
    version: 1,
    exportedAt: nowIso(),
    books: await db.books.toArray(),
  }
}

/**
 * Export CSV — pour un tableur, ou pour alimenter une autre application.
 *
 * Le séparateur est au choix : Excel en configuration française découpe sur le
 * point-virgule et laisserait tout dans une seule colonne avec des virgules,
 * alors que la plupart des autres outils attendent la virgule.
 */
export const CSV_COLUMNS = [
  'Titre', 'Sous-titre', 'Auteurs', 'ISBN', 'Éditeur', 'Année', 'Pages', 'Langue',
  'Genre', 'Série', 'Tome',
  'Statut', 'Note', 'Date de début', 'Date de fin', 'Tags', 'Notes', 'Résumé',
  'Source', 'Ajouté le',
]

export async function exportCsv(delimiter = ';'): Promise<string> {
  const books = await allBooks()
  const rows = books.map((b) => ({
    Titre: b.title,
    'Sous-titre': b.subtitle ?? '',
    Auteurs: b.authors.join('; '),
    ISBN: b.isbn13 ? formatIsbn(b.isbn13) : (b.isbn10 ?? ''),
    'Éditeur': b.publisher ?? '',
    'Année': b.publishedYear ? String(b.publishedYear) : '',
    Pages: b.pageCount ? String(b.pageCount) : '',
    Langue: languageLabel(b.language) ?? '',
    Genre: b.genre ?? '',
    'Série': b.series ?? '',
    Tome: b.seriesIndex ? String(b.seriesIndex) : '',
    Statut: STATUS_LABELS[b.status],
    Note: b.rating ? String(b.rating) : '',
    'Date de début': b.startedAt ?? '',
    'Date de fin': b.finishedAt ?? '',
    Tags: b.tags.join(', '),
    Notes: b.notes ?? '',
    'Résumé': b.description ?? '',
    Source: b.source,
    'Ajouté le': b.createdAt.slice(0, 10),
  }))
  return toCsv(CSV_COLUMNS, rows, delimiter)
}

/**
 * Date de la dernière sauvegarde exportée.
 *
 * iOS refuse quasi systématiquement le stockage persistant : la seule copie
 * vraiment durable est un fichier sorti du navigateur. On garde donc trace du
 * dernier export pour pouvoir alerter quand il date trop.
 */
const BACKUP_KEY = 'backup:last'

export async function getLastBackup(): Promise<string | null> {
  const row = await db.meta.get(BACKUP_KEY)
  return (row?.value as string | undefined) ?? null
}

export async function markBackup(): Promise<void> {
  await db.meta.put({ key: BACKUP_KEY, value: nowIso() })
}

/** Livres ajoutés ou modifiés depuis la dernière sauvegarde. */
export async function changesSinceBackup(): Promise<number> {
  const last = await getLastBackup()
  if (!last) return (await allBooks()).length
  const books = await db.books.toArray()
  return books.filter((b) => b.updatedAt > last).length
}

export interface ImportResult {
  added: number
  updated: number
  skipped: number
}

/**
 * Import idempotent : on peut réimporter le même fichier sans créer de
 * doublons. Le gagnant en cas de collision est la version la plus récente
 * (`updatedAt`) — la même règle que celle qu'utilisera la synchro.
 */
export async function importJson(payload: unknown): Promise<ImportResult> {
  const data = payload as Partial<ExportPayload>
  if (data?.format !== 'bookshelf-export' || !Array.isArray(data.books)) {
    throw new Error("Fichier non reconnu : ce n'est pas un export Bookshelf.")
  }

  const result: ImportResult = { added: 0, updated: 0, skipped: 0 }

  await db.transaction('rw', db.books, async () => {
    for (const incoming of data.books as Book[]) {
      if (!incoming?.id || !incoming.title) {
        result.skipped++
        continue
      }
      const existing = await db.books.get(incoming.id)
      if (!existing) {
        await db.books.add({ ...incoming, dirty: 1 })
        result.added++
      } else if (incoming.updatedAt > existing.updatedAt) {
        await db.books.put({ ...incoming, dirty: 1 })
        result.updated++
      } else {
        result.skipped++
      }
    }
  })

  return result
}

// --------------------------------------------- import depuis une autre app

export interface ForeignImportOptions {
  /** Complète les fiches incomplètes depuis les catalogues (réseau). */
  enrich?: (isbn13: string) => Promise<BookDraft | null>
  /** Télécharge la couverture après création. */
  fetchCovers?: boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface ForeignImportResult extends ImportResult {
  enriched: number
  duplicates: number
}

/**
 * Importe des lignes venues d'une application tierce.
 *
 * La déduplication se fait sur l'ISBN-13 : réimporter le même fichier n'ajoute
 * rien. Les livres sans ISBN sont comparés sur titre + premier auteur, ce qui
 * est moins sûr mais évite les doublons les plus visibles.
 *
 * L'enrichissement est séquentiel et non parallèle, volontairement : importer
 * 400 livres en lançant 400 requêtes simultanées ferait bloquer notre adresse
 * IP par Open Library, et le gain de temps serait illusoire.
 */
export async function importForeignRows(
  rows: MappedRow[],
  options: ForeignImportOptions = {},
): Promise<ForeignImportResult> {
  const result: ForeignImportResult = { added: 0, updated: 0, skipped: 0, enriched: 0, duplicates: 0 }

  const existing = await allBooks()
  const byIsbn = new Map(existing.filter((b) => b.isbn13).map((b) => [b.isbn13!, b]))
  const byTitleAuthor = new Map(existing.map((b) => [titleAuthorKey(b.title, b.authors[0]), b]))

  let done = 0
  for (const row of rows) {
    if (options.signal?.aborted) break

    const duplicate = row.isbn13
      ? byIsbn.get(row.isbn13)
      : byTitleAuthor.get(titleAuthorKey(row.title, row.authors[0]))

    if (duplicate) {
      result.duplicates++
      result.skipped++
      done++
      options.onProgress?.(done, rows.length)
      continue
    }

    let draft: BookDraft | null = null
    // On ne sollicite le reseau que si la fiche est vraiment pauvre : un import
    // deja complet n'a rien a gagner et tout a perdre en temps.
    const needsEnrichment = !row.authors.length || !row.pageCount || !row.publisher
    if (options.enrich && row.isbn13 && needsEnrichment) {
      try {
        draft = await options.enrich(row.isbn13)
        if (draft) result.enriched++
      } catch {
        /* source injoignable : on garde ce que le fichier contenait */
      }
    }

    const ts = nowIso()
    const book: Book = {
      id: newId(),
      isbn13: row.isbn13 ?? draft?.isbn13,
      isbn10: row.isbn10 ?? draft?.isbn10,
      // Les donnees du fichier priment : ce sont celles que l'utilisateur a
      // saisies lui-meme. Le catalogue ne sert qu'a combler les trous.
      title: row.title || draft?.title || 'Sans titre',
      subtitle: draft?.subtitle,
      authors: row.authors.length > 0 ? row.authors : (draft?.authors ?? []),
      publisher: row.publisher ?? draft?.publisher,
      publishedYear: row.publishedYear ?? draft?.publishedYear,
      pageCount: row.pageCount ?? draft?.pageCount,
      language: row.language ?? draft?.language,
      description: row.description ?? draft?.description,
      subjects: draft?.subjects ?? [],
      genre: row.genre ?? deriveGenre(draft?.subjects ?? [], row.title),
      series: row.series ?? parseSeries(row.title)?.series,
      seriesIndex: row.seriesIndex ?? parseSeries(row.title)?.index,
      coverUrl: draft?.coverUrl,
      source: draft ? draft.source : 'manual',
      sourceId: draft?.sourceId,
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      tags: row.tags,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      dirty: 1,
    }

    await db.books.add(book)
    if (book.isbn13) byIsbn.set(book.isbn13, book)
    byTitleAuthor.set(titleAuthorKey(book.title, book.authors[0]), book)
    result.added++

    if (options.fetchCovers && book.coverUrl) {
      void cacheCover(book.id, book.coverUrl)
    }

    done++
    options.onProgress?.(done, rows.length)
  }

  return result
}

function titleAuthorKey(title: string, author?: string): string {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  return `${norm(title)}|${norm(author ?? '')}`
}

// ----------------------------------------------- complétion des fiches

/** Ce qui manque à une fiche. Vide = la fiche est complète. */
export interface Gaps {
  cover: boolean
  description: boolean
  pageCount: boolean
  authors: boolean
  publisher: boolean
  genre: boolean
}

export interface IncompleteBook {
  book: Book
  gaps: Gaps
  /** Date ISO de la dernière tentative de complétion, si elle a eu lieu. */
  lastTriedAt?: string
  tries: number
}

/**
 * Journal des tentatives de complétion.
 *
 * Sans lui, chaque passage réinterroge les mêmes livres introuvables — et il y
 * en a beaucoup : environ la moitié des livres français n'ont de couverture
 * dans aucun catalogue. Au bout de trois passages, on aurait consommé le quota
 * Google à redemander trois fois ce qui n'existe pas.
 *
 * Le journal permet aussi d'étaler le travail : on traite ce qui n'a jamais
 * été tenté, on s'arrête quand le quota tombe, et on reprend le lendemain
 * exactement là où on en était.
 */
const ATTEMPTS_KEY = 'refresh:attempts'

interface Attempt {
  at: string
  tries: number
}

type AttemptLog = Record<string, Attempt>

async function loadAttempts(): Promise<AttemptLog> {
  const row = await db.meta.get(ATTEMPTS_KEY)
  return (row?.value as AttemptLog | undefined) ?? {}
}

async function saveAttempts(log: AttemptLog): Promise<void> {
  await db.meta.put({ key: ATTEMPTS_KEY, value: log })
}

/**
 * Report de la proposition de complétion.
 *
 * Reproposer à chaque ouverture ce que l'utilisateur vient d'écarter est le
 * meilleur moyen de faire ignorer la bannière pour de bon. « Plus tard »
 * vaut donc une semaine de silence.
 */
const SNOOZE_KEY = 'refresh:snoozedUntil'

export async function snoozeRefreshPrompt(days = 7): Promise<void> {
  const until = new Date(Date.now() + days * 86400_000).toISOString()
  await db.meta.put({ key: SNOOZE_KEY, value: until })
}

export async function isRefreshPromptSnoozed(): Promise<boolean> {
  const row = await db.meta.get(SNOOZE_KEY)
  const until = row?.value as string | undefined
  return !!until && until > nowIso()
}

/** Oublie l'historique : tout redevient « jamais tenté ». */
export async function clearAttempts(): Promise<void> {
  await db.meta.delete(ATTEMPTS_KEY)
}

export function isIncomplete(gaps: Gaps): boolean {
  return gaps.cover || gaps.description || gaps.pageCount || gaps.authors || gaps.publisher || gaps.genre
}

/**
 * Recense les fiches incomplètes.
 *
 * Seuls les livres ayant un ISBN sont retenus : sans lui, aucun catalogue ne
 * peut être interrogé de façon fiable, et une recherche par titre ramènerait
 * la mauvaise édition une fois sur trois.
 */
export async function findIncompleteBooks(): Promise<IncompleteBook[]> {
  const books = await allBooks()
  const coverIds = new Set<string>()
  await db.covers.each((c) => coverIds.add(c.bookId))
  const attempts = await loadAttempts()

  const result: IncompleteBook[] = []
  for (const book of books) {
    if (!book.isbn13 && !book.isbn10) continue
    const gaps: Gaps = {
      cover: !coverIds.has(book.id),
      description: !book.description,
      pageCount: !book.pageCount,
      authors: book.authors.length === 0,
      publisher: !book.publisher,
      genre: !book.genre,
    }
    if (!isIncomplete(gaps)) continue
    const past = attempts[book.id]
    result.push({ book, gaps, lastTriedAt: past?.at, tries: past?.tries ?? 0 })
  }

  // Les livres jamais tentés passent en premier : à quota limité, mieux vaut
  // dépenser les requêtes sur du neuf que sur ce qui a déjà échoué.
  return result.sort((a, b) => (a.lastTriedAt ?? '').localeCompare(b.lastTriedAt ?? ''))
}

/** Sépare ce qui est à traiter maintenant de ce qui a été tenté récemment. */
export function splitByFreshness(
  targets: IncompleteBook[],
  retryAfterHours = 24,
): { pending: IncompleteBook[]; cooling: IncompleteBook[] } {
  const cutoff = new Date(Date.now() - retryAfterHours * 3600_000).toISOString()
  const pending: IncompleteBook[] = []
  const cooling: IncompleteBook[] = []
  for (const t of targets) {
    if (t.lastTriedAt && t.lastTriedAt > cutoff) cooling.push(t)
    else pending.push(t)
  }
  return { pending, cooling }
}

export interface RefreshOptions {
  lookup: (isbn: string) => Promise<BookDraft | null>
  coverUrls: (opts: { isbn13?: string; isbn10?: string; knownUrl?: string; googleThumb?: string }) => string[]
  /** Interroge l'état du quota d'une source, pour arrêter avant d'insister. */
  isThrottled?: () => boolean
  /** Pause entre deux livres, pour rester sous les limites des catalogues. */
  delayMs?: number
  onProgress?: (done: number, total: number, title: string) => void
  signal?: AbortSignal
  /** N'écrit pas le journal des tentatives (complétion d'un livre isolé). */
  skipJournal?: boolean
}

export interface RefreshResult {
  processed: number
  coversAdded: number
  fieldsFilled: number
  untouched: number
  /** Nombre de livres non traités parce que le quota a été atteint. */
  remaining: number
  /** Vrai si l'arrêt vient d'un quota de catalogue, pas de l'utilisateur. */
  stoppedByQuota: boolean
}

/**
 * Pause entre deux livres. Open Library demande de rester sous ~1 requête par
 * seconde ; 400 ms laisse de la marge tout en traitant 150 livres en une
 * minute. C'est aussi ce qui évite de faire chauffer le téléphone.
 */
const DEFAULT_DELAY_MS = 400

/**
 * Complète les fiches depuis les catalogues, sans jamais écraser ce qui existe.
 *
 * Règle absolue : on ne remplit que les trous. Les notes, tags, dates et
 * statuts saisis par l'utilisateur ne sont pas concernés, et un titre corrigé
 * à la main n'est pas remplacé par celui du catalogue — c'est le genre de
 * « mise à jour » qui fait perdre confiance dans un outil.
 *
 * Traitement séquentiel : enchaîner 300 requêtes en parallèle ferait bloquer
 * l'adresse IP par Open Library, et le gain de temps serait illusoire.
 */
export async function refreshBooks(
  targets: IncompleteBook[],
  options: RefreshOptions,
): Promise<RefreshResult> {
  const result: RefreshResult = {
    processed: 0,
    coversAdded: 0,
    fieldsFilled: 0,
    untouched: 0,
    remaining: targets.length,
    stoppedByQuota: false,
  }

  const delay = options.delayMs ?? DEFAULT_DELAY_MS
  const journal = options.skipJournal ? {} : await loadAttempts()
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  for (const { book, gaps } of targets) {
    if (options.signal?.aborted) break

    // Quota atteint : on s'arrête net plutôt que de parcourir le reste de la
    // liste en échouant à chaque fois. Les livres non traités restent marqués
    // « jamais tentés » et seront repris au prochain passage, demain si besoin.
    if (options.isThrottled?.()) {
      result.stoppedByQuota = true
      break
    }

    options.onProgress?.(result.processed, targets.length, book.title)
    result.processed++
    result.remaining--

    const isbn = book.isbn13 ?? book.isbn10
    if (!isbn) continue

    if (!options.skipJournal) {
      journal[book.id] = { at: nowIso(), tries: (journal[book.id]?.tries ?? 0) + 1 }
    }

    let draft: BookDraft | null = null
    // Inutile d'interroger les catalogues si seule la couverture manque :
    // les URL se construisent depuis l'ISBN sans aucune requête de métadonnées.
    const needsMetadata = gaps.description || gaps.pageCount || gaps.authors || gaps.publisher || gaps.genre
    if (needsMetadata) {
      try {
        draft = await options.lookup(isbn)
      } catch {
        /* source injoignable : on tente quand meme la couverture */
      }
    }

    const changes: Partial<Book> = {}
    if (draft) {
      if (gaps.description && draft.description) changes.description = draft.description
      if (gaps.pageCount && draft.pageCount) changes.pageCount = draft.pageCount
      if (gaps.authors && draft.authors.length > 0) changes.authors = draft.authors
      if (gaps.publisher && draft.publisher) changes.publisher = draft.publisher
      if (!book.publishedYear && draft.publishedYear) changes.publishedYear = draft.publishedYear
      if (!book.language && draft.language) changes.language = draft.language
      if (book.subjects.length === 0 && draft.subjects.length > 0) changes.subjects = draft.subjects
      if (!book.isbn13 && draft.isbn13) changes.isbn13 = draft.isbn13
      if (gaps.genre) {
        const genre = deriveGenre(
          draft.subjects.length > 0 ? draft.subjects : book.subjects,
          book.title,
        )
        if (genre) changes.genre = genre
      }
    }

    // La serie se deduit du titre, sans reseau : on peut la combler meme quand
    // les catalogues sont injoignables ou que le quota est epuise.
    if (!book.series) {
      const serie = parseSeries(book.title)
      if (serie) {
        changes.series = serie.series
        if (serie.index) changes.seriesIndex = serie.index
      }
    }

    if (gaps.cover) {
      const found = await cacheCoverFromCandidates(
        book.id,
        options.coverUrls({
          isbn13: book.isbn13,
          isbn10: book.isbn10,
          knownUrl: book.coverUrl,
          googleThumb: draft?.coverUrl,
        }),
      )
      if (found) {
        result.coversAdded++
        if (found !== book.coverUrl) changes.coverUrl = found
      }
    }

    const filled = Object.keys(changes).length
    if (filled > 0) {
      await updateBook(book.id, changes)
      result.fieldsFilled += filled
    } else if (!gaps.cover) {
      result.untouched++
    }

    // Journal sauvegardé au fil de l'eau : si l'app est fermée en cours de
    // route, ce qui a déjà été tenté n'est pas redemandé au prochain passage.
    if (!options.skipJournal && result.processed % 10 === 0) {
      await saveAttempts(journal)
    }

    if (delay > 0) await sleep(delay)
  }

  if (!options.skipJournal) await saveAttempts(journal)

  options.onProgress?.(result.processed, targets.length, '')
  return result
}

/** Recharge une seule fiche, depuis le détail d'un livre. */
export async function refreshOne(book: Book, options: RefreshOptions): Promise<RefreshResult> {
  const gaps: Gaps = {
    cover: !(await hasCover(book.id)),
    description: !book.description,
    pageCount: !book.pageCount,
    authors: book.authors.length === 0,
    publisher: !book.publisher,
    genre: !book.genre,
  }
  // Pas de pause ni de journal : l'utilisateur attend devant son écran, et une
  // demande explicite ne doit pas être bloquée par « déjà tenté hier ».
  return refreshBooks([{ book, gaps, tries: 0 }], { ...options, delayMs: 0, skipJournal: true })
}

// ------------------------------------------------------------------ statistiques

export interface Stats {
  total: number
  byStatus: Record<ReadingStatus, number>
  pagesRead: number
  readThisYear: number
  topAuthors: Array<{ name: string; count: number }>
}

export async function computeStats(books: Book[]): Promise<Stats> {
  const byStatus: Record<ReadingStatus, number> = { 'to-read': 0, reading: 0, read: 0, abandoned: 0 }
  const authorCounts = new Map<string, number>()
  const year = new Date().getFullYear().toString()
  let pagesRead = 0
  let readThisYear = 0

  for (const b of books) {
    byStatus[b.status]++
    for (const a of b.authors) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1)
    if (b.status === 'read') {
      pagesRead += b.pageCount ?? 0
      if (b.finishedAt?.startsWith(year)) readThisYear++
    }
  }

  const topAuthors = [...authorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5)

  return { total: books.length, byStatus, pagesRead, readThisYear, topAuthors }
}
