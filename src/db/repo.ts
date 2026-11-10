import { db, STATUS_LABELS, type Book, type ReadingStatus } from './schema'
import type { BookDraft } from '../api/types'
import { toCsv } from '../lib/csv'
import { formatIsbn } from '../lib/isbn'
import { languageLabel } from '../lib/language'
import type { MappedRow } from '../lib/importMapping'

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

export async function getCoverBlob(bookId: string): Promise<Blob | undefined> {
  return (await db.covers.get(bookId))?.blob
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
