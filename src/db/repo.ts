import { db, STATUS_LABELS, type Book, type ReadingStatus, type Snapshot } from './schema'
import type { BookDraft } from '../api/types'
import { toCsv } from '../lib/csv'
import { formatIsbn } from '../lib/isbn'
import { languageLabel } from '../lib/language'
import type { MappedRow } from '../lib/importMapping'
import { deriveGenre } from '../lib/genre'
import { parseSeries, seriesKey } from '../lib/series'
import { fetchWithTimeout } from '../lib/timeout'

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

/** Les livres d'une même série déjà présents, dans l'ordre des tomes. */
export async function booksInSeries(series: string): Promise<Book[]> {
  const key = seriesKey(series)
  const books = await allBooks()
  return books
    .filter((b) => b.series && seriesKey(b.series) === key)
    .sort((a, b) => (a.seriesIndex ?? 999) - (b.seriesIndex ?? 999) || a.title.localeCompare(b.title, 'fr'))
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
    const res = await fetchWithTimeout(url, {}, 8000)
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

const BACKUP_COUNT_KEY = 'backup:count'

/** Nombre total de sauvegardes effectuées depuis l'installation. */
export async function getBackupCount(): Promise<number> {
  const row = await db.meta.get(BACKUP_COUNT_KEY)
  return (row?.value as number | undefined) ?? 0
}

export async function markBackup(): Promise<void> {
  const count = await getBackupCount()
  await db.meta.put({ key: BACKUP_KEY, value: nowIso() })
  await db.meta.put({ key: BACKUP_COUNT_KEY, value: count + 1 })
}

// ------------------------------------------------------------- instantanés

/**
 * Nombre d'instantanés conservés.
 *
 * Trois suffisent : ils servent à revenir sur une fausse manœuvre récente, pas
 * à tenir un historique. Au-delà, on occupe le stockage du navigateur — celui
 * qu'iOS peut justement purger — pour des copies qu'on ne consultera jamais.
 */
const MAX_SNAPSHOTS = 3

/**
 * Conserve une copie de la sauvegarde dans l'app, et élague les plus anciennes.
 *
 * Ne remplace pas l'export : un instantané vit dans le même stockage que les
 * données qu'il protège, il ne survivrait donc ni à une purge du navigateur ni
 * à la perte du téléphone. Il rattrape les erreurs, pas les accidents.
 */
export async function saveSnapshot(payloadJson: string, books: number): Promise<void> {
  const snapshot: Snapshot = {
    id: newId(),
    at: nowIso(),
    books,
    bytes: new Blob([payloadJson]).size,
    payload: payloadJson,
  }

  await db.transaction('rw', db.snapshots, async () => {
    await db.snapshots.add(snapshot)
    const all = await db.snapshots.orderBy('at').reverse().toArray()
    const doomed = all.slice(MAX_SNAPSHOTS).map((x) => x.id)
    if (doomed.length > 0) await db.snapshots.bulkDelete(doomed)
  })
}

export type SnapshotInfo = Omit<Snapshot, 'payload'>

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const all = await db.snapshots.orderBy('at').reverse().toArray()
  return all.map(({ payload: _payload, ...info }) => info)
}

export async function getSnapshotPayload(id: string): Promise<string | undefined> {
  return (await db.snapshots.get(id))?.payload
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.snapshots.delete(id)
}

export async function deleteOldestSnapshot(): Promise<boolean> {
  const oldest = await db.snapshots.orderBy('at').first()
  if (!oldest) return false
  await db.snapshots.delete(oldest.id)
  return true
}

/** Réinjecte un instantané. Les livres plus récents ne sont pas écrasés. */
export async function restoreSnapshot(id: string): Promise<ImportResult> {
  const payload = await getSnapshotPayload(id)
  if (!payload) throw new Error('Cet instantané a été supprimé.')
  return importJson(JSON.parse(payload))
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
  enrich?: (isbn13: string, signal?: AbortSignal) => Promise<BookDraft | null>
  /** URL de couverture à essayer, dans l'ordre. */
  coverUrls?: (opts: { isbn13?: string; isbn10?: string; knownUrl?: string }) => string[]
  /** Interroge l'état du quota d'une source, pour s'arrêter avant d'insister. */
  isThrottled?: () => boolean
  /** Pause entre deux livres quand le réseau est sollicité. */
  delayMs?: number
  onProgress?: (done: number, total: number, title: string) => void
  signal?: AbortSignal
}

/**
 * Nombre d'échecs réseau consécutifs au-delà duquel on arrête.
 *
 * Passé ce seuil, ce n'est plus un livre introuvable mais le réseau ou le
 * catalogue qui est tombé. Continuer sur 300 lignes produirait 300 échecs,
 * ferait durer l'import un quart d'heure et finirait par faire blacklister
 * l'adresse. Les livres déjà créés sont conservés : la reprise les saute.
 */
const MAX_CONSECUTIVE_FAILURES = 8

export interface ForeignImportResult extends ImportResult {
  enriched: number
  duplicates: number
  /** Livres créés mais dont la complétion réseau a échoué. */
  failed: number
  /** Livres non traités : arrêt par l'utilisateur, le quota ou une panne. */
  remaining: number
  stoppedByQuota: boolean
  stoppedByErrors: boolean
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
  const result: ForeignImportResult = {
    added: 0,
    updated: 0,
    skipped: 0,
    enriched: 0,
    duplicates: 0,
    failed: 0,
    remaining: rows.length,
    stoppedByQuota: false,
    stoppedByErrors: false,
  }

  // Pas de pause si l'on n'interroge pas le réseau : l'écriture locale est
  // rapide et n'a aucune raison d'être ralentie.
  const delay = options.delayMs ?? (options.enrich ? 350 : 0)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let consecutiveFailures = 0

  /**
   * Trois index, parce qu'un seul ne suffit pas.
   *
   * Le piège : la complétion modifie le livre enregistré. Si le fichier n'a pas
   * de colonne auteur, le premier import écrit l'auteur trouvé au catalogue ;
   * au second passage on compare un auteur vide à un auteur rempli, les clés
   * divergent et le livre est réimporté. D'où l'index par titre seul, consulté
   * dès que l'un des deux côtés n'a pas d'auteur.
   *
   * L'ISBN-10 est indexé aussi : un fichier peut le fournir là où un autre
   * donne l'ISBN-13, pour la même édition.
   */
  const existing = await allBooks()
  const byIsbn = new Map<string, Book>()
  const byTitleAuthor = new Map<string, Book>()
  const byTitle = new Map<string, Book>()

  function index(book: Book) {
    if (book.isbn13) byIsbn.set(book.isbn13, book)
    if (book.isbn10) byIsbn.set(book.isbn10, book)
    byTitleAuthor.set(titleAuthorKey(book.title, book.authors[0]), book)
    const t = titleAuthorKey(book.title)
    if (!byTitle.has(t)) byTitle.set(t, book)
  }
  existing.forEach(index)

  function findDuplicate(row: MappedRow): Book | undefined {
    if (row.isbn13 && byIsbn.has(row.isbn13)) return byIsbn.get(row.isbn13)
    if (row.isbn10 && byIsbn.has(row.isbn10)) return byIsbn.get(row.isbn10)

    const withAuthor = byTitleAuthor.get(titleAuthorKey(row.title, row.authors[0]))
    if (withAuthor) return withAuthor

    // Titre identique et auteur absent d'un côté : c'est le même livre, dont
    // la fiche a simplement été complétée entre-temps.
    const sameTitle = byTitle.get(titleAuthorKey(row.title))
    if (sameTitle && (row.authors.length === 0 || sameTitle.authors.length === 0)) return sameTitle

    return undefined
  }

  let done = 0
  for (const row of rows) {
    if (options.signal?.aborted) break

    if (options.isThrottled?.()) {
      result.stoppedByQuota = true
      break
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      result.stoppedByErrors = true
      break
    }

    options.onProgress?.(done, rows.length, row.title)

    const duplicate = findDuplicate(row)

    if (duplicate) {
      result.duplicates++
      result.skipped++
      done++
      result.remaining--
      continue
    }

    let draft: BookDraft | null = null
    // On ne sollicite le reseau que si la fiche est vraiment pauvre : un import
    // deja complet n'a rien a gagner et tout a perdre en temps.
    const needsEnrichment = !row.authors.length || !row.pageCount || !row.publisher
    if (options.enrich && row.isbn13 && needsEnrichment) {
      try {
        draft = await options.enrich(row.isbn13, options.signal)
        if (draft) result.enriched++
        // Un ISBN inconnu des catalogues n'est pas une panne : seule une
        // exception (réseau coupé, délai dépassé) compte comme un échec.
        consecutiveFailures = 0
      } catch {
        result.failed++
        consecutiveFailures++
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
    // Indexé aussitôt : un même fichier peut contenir deux fois la même ligne.
    index(book)
    result.added++

    // La couverture est attendue, pas lancée en arrière-plan : 300 appels
    // `void` simultanés saturent le pool de connexions du navigateur et
    // figent tout le reste, y compris les requêtes de métadonnées.
    if (options.coverUrls) {
      await cacheCoverFromCandidates(
        book.id,
        options.coverUrls({ isbn13: book.isbn13, isbn10: book.isbn10, knownUrl: book.coverUrl }),
      )
    }

    done++
    result.remaining--
    if (delay > 0) await sleep(delay)
  }

  options.onProgress?.(done, rows.length, '')
  return result
}

/** Clé de rapprochement. Sans auteur, elle ne porte que sur le titre. */
function titleAuthorKey(title: string, author?: string): string {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  return `${norm(title)}|${norm(author ?? '')}`
}

// ------------------------------------------------------------- doublons

export interface DuplicateGroup {
  /** L'exemplaire à conserver : le plus riche, et jamais celui qui porte des notes. */
  keep: Book
  /** Les autres, qui seront fusionnés dedans puis retirés. */
  remove: Book[]
}

/**
 * Qualité d'un exemplaire, pour décider lequel garder.
 *
 * Les données saisies à la main pèsent mille fois plus que le reste : perdre
 * une note de lecture pour conserver un résumé serait absurde. Vient ensuite
 * la couverture, puis le nombre de champs remplis.
 */
function bookScore(b: Book, hasCover: boolean): number {
  const userData =
    (b.rating ? 1 : 0) +
    (b.notes ? 1 : 0) +
    b.tags.length +
    (b.startedAt ? 1 : 0) +
    (b.finishedAt ? 1 : 0) +
    (b.status !== 'read' ? 1 : 0)

  const filled = [
    b.isbn13, b.description, b.pageCount, b.publisher, b.publishedYear,
    b.language, b.genre, b.series, b.authors.length > 0 ? 'a' : undefined,
  ].filter(Boolean).length

  return userData * 1000 + (hasCover ? 100 : 0) + filled
}

/**
 * Repère les exemplaires multiples d'un même livre.
 *
 * Mêmes règles de rapprochement que l'import — ISBN d'abord, puis titre et
 * auteur, puis titre seul quand un côté n'a pas d'auteur — pour que ce qui est
 * considéré comme doublon ici le soit aussi à l'import.
 */
export async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const books = await allBooks()
  const coverIds = new Set<string>()
  await db.covers.each((c) => coverIds.add(c.bookId))

  // Regroupement en deux passes : l'ISBN fait autorité, le titre ne sert que
  // pour les livres qui n'en ont pas.
  const groups = new Map<string, Book[]>()
  const keyOf = (b: Book) =>
    b.isbn13 ? `i:${b.isbn13}` : b.isbn10 ? `i:${b.isbn10}` : `t:${titleAuthorKey(b.title)}`

  for (const b of books) {
    const k = keyOf(b)
    const list = groups.get(k)
    if (list) list.push(b)
    else groups.set(k, [b])
  }

  const result: DuplicateGroup[] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue

    // Sans ISBN, on n'assemble que si les auteurs concordent ou manquent :
    // deux livres homonymes d'auteurs différents ne sont pas des doublons.
    const noIsbn = !list[0].isbn13 && !list[0].isbn10
    if (noIsbn) {
      const authors = new Set(list.map((b) => titleAuthorKey('', b.authors[0])).filter((a) => a !== '|'))
      if (authors.size > 1) continue
    }

    const sorted = [...list].sort(
      (a, b) =>
        bookScore(b, coverIds.has(b.id)) - bookScore(a, coverIds.has(a.id)) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    result.push({ keep: sorted[0], remove: sorted.slice(1) })
  }

  return result.sort((a, b) => a.keep.title.localeCompare(b.keep.title, 'fr'))
}

export interface MergeResult {
  groups: number
  removed: number
  fieldsRecovered: number
  coversRecovered: number
}

/**
 * Fusionne puis retire les doublons.
 *
 * On ne supprime jamais sèchement : ce qui manque à l'exemplaire conservé est
 * repris sur les autres avant qu'ils ne partent. Si une copie portait une note
 * et l'autre un commentaire, les deux survivent. La suppression reste logique
 * (tombstone), donc réversible par un import de sauvegarde.
 */
export async function mergeDuplicates(groups: DuplicateGroup[]): Promise<MergeResult> {
  const result: MergeResult = { groups: 0, removed: 0, fieldsRecovered: 0, coversRecovered: 0 }

  for (const { keep, remove } of groups) {
    const changes: Partial<Book> = {}
    const tags = new Set(keep.tags)

    for (const dup of remove) {
      if (!keep.isbn13 && dup.isbn13) changes.isbn13 = dup.isbn13
      if (!keep.isbn10 && dup.isbn10) changes.isbn10 = dup.isbn10
      if (!keep.description && dup.description) changes.description = dup.description
      if (!keep.pageCount && dup.pageCount) changes.pageCount = dup.pageCount
      if (!keep.publisher && dup.publisher) changes.publisher = dup.publisher
      if (!keep.publishedYear && dup.publishedYear) changes.publishedYear = dup.publishedYear
      if (!keep.language && dup.language) changes.language = dup.language
      if (!keep.genre && dup.genre) changes.genre = dup.genre
      if (!keep.series && dup.series) changes.series = dup.series
      if (!keep.seriesIndex && dup.seriesIndex) changes.seriesIndex = dup.seriesIndex
      if (keep.authors.length === 0 && dup.authors.length > 0) changes.authors = dup.authors
      if (keep.subjects.length === 0 && dup.subjects.length > 0) changes.subjects = dup.subjects

      // Données saisies : on récupère ce que l'exemplaire conservé n'a pas.
      if (!keep.rating && dup.rating) changes.rating = dup.rating
      if (!keep.notes && dup.notes) changes.notes = dup.notes
      if (!keep.startedAt && dup.startedAt) changes.startedAt = dup.startedAt
      if (!keep.finishedAt && dup.finishedAt) changes.finishedAt = dup.finishedAt
      for (const t of dup.tags) tags.add(t)

      // La couverture déjà téléchargée est récupérée plutôt que refaite.
      if (!(await hasCover(keep.id))) {
        const blob = await getCoverBlob(dup.id)
        if (blob) {
          await db.covers.put({ bookId: keep.id, blob, fetchedAt: nowIso() })
          result.coversRecovered++
        }
      }
    }

    if (tags.size !== keep.tags.length) changes.tags = [...tags]

    const count = Object.keys(changes).length
    if (count > 0) {
      await updateBook(keep.id, changes)
      result.fieldsRecovered += count
    }

    for (const dup of remove) {
      await deleteBook(dup.id)
      result.removed++
    }
    result.groups++
  }

  return result
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
