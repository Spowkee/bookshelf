import Dexie, { type EntityTable } from 'dexie'

export type ReadingStatus = 'to-read' | 'reading' | 'read' | 'abandoned'

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  'to-read': 'À lire',
  reading: 'En cours',
  read: 'Lu',
  abandoned: 'Abandonné',
}

export const STATUS_ORDER: ReadingStatus[] = ['reading', 'to-read', 'read', 'abandoned']

export type MetadataSource = 'openlibrary' | 'googlebooks' | 'bnf' | 'manual'

/**
 * Un livre de la bibliotheque.
 *
 * Les champs `createdAt` / `updatedAt` / `deletedAt` / `dirty` ne servent a rien
 * aujourd'hui (tout est local) mais ils sont la des maintenant pour que la
 * synchro multi-appareils soit ajoutable plus tard sans migration de schema :
 *  - `updatedAt` donne le gagnant en cas de conflit (last-write-wins),
 *  - `deletedAt` est un tombstone : on ne supprime jamais vraiment une ligne,
 *    sinon une suppression sur l'appareil A serait "ressuscitee" par l'appareil B,
 *  - `dirty` marque les lignes pas encore poussees au serveur.
 * IndexedDB n'indexe pas les booleens, d'ou `dirty: 0 | 1`.
 */
export interface Book {
  id: string
  isbn13?: string
  isbn10?: string
  title: string
  subtitle?: string
  authors: string[]
  publisher?: string
  publishedYear?: number
  pageCount?: number
  language?: string
  description?: string
  subjects: string[]
  coverUrl?: string
  source: MetadataSource
  sourceId?: string

  // Données saisies par l'utilisateur
  status: ReadingStatus
  rating?: number
  notes?: string
  tags: string[]
  startedAt?: string
  finishedAt?: string

  // Métadonnées de synchro
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  dirty: 0 | 1
}

/** Couverture stockée en dur, pour que la bibliothèque s'affiche hors-ligne. */
export interface Cover {
  bookId: string
  blob: Blob
  fetchedAt: string
}

export interface MetaEntry {
  key: string
  value: unknown
}

class BookshelfDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  covers!: EntityTable<Cover, 'bookId'>
  meta!: EntityTable<MetaEntry, 'key'>

  constructor() {
    super('bookshelf')
    this.version(1).stores({
      books: 'id, isbn13, isbn10, title, status, updatedAt, deletedAt, dirty, publishedYear, *authors, *tags',
      covers: 'bookId',
      meta: 'key',
    })
  }
}

export const db = new BookshelfDB()
