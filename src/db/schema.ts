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

  /** Genre normalisé, déduit des sujets puis corrigeable à la main. */
  genre?: string
  /** Nom de la série, si le livre en fait partie. */
  series?: string
  /** Numéro de tome dans la série. */
  seriesIndex?: number

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

/**
 * Copie de sauvegarde conservée dans l'app.
 *
 * À ne pas confondre avec le fichier exporté : celui-ci part hors du
 * navigateur et devient inaccessible à l'app. Un instantané, lui, reste
 * consultable, restaurable et supprimable depuis les réglages. Il protège des
 * fausses manœuvres — une suppression de masse, un import raté — mais pas de
 * la perte du téléphone, puisqu'il vit dans le même stockage.
 */
export interface Snapshot {
  id: string
  at: string
  books: number
  bytes: number
  payload: string
}

export interface MetaEntry {
  key: string
  value: unknown
}

class BookshelfDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  covers!: EntityTable<Cover, 'bookId'>
  meta!: EntityTable<MetaEntry, 'key'>
  snapshots!: EntityTable<Snapshot, 'id'>

  constructor() {
    super('bookshelf')
    this.version(1).stores({
      books: 'id, isbn13, isbn10, title, status, updatedAt, deletedAt, dirty, publishedYear, *authors, *tags',
      covers: 'bookId',
      meta: 'key',
    })

    // Version 3 : instantanés de sauvegarde conservés dans l'app.
    // (déclarée après la v2 ci-dessous, Dexie applique les versions en ordre)

    // Version 2 : genre et séries. Dexie applique la migration tout seul au
    // premier lancement ; les livres existants gardent ces champs vides et
    // seront renseignés par la complétion des fiches.
    this.version(2).stores({
      books:
        'id, isbn13, isbn10, title, status, updatedAt, deletedAt, dirty, publishedYear, genre, series, *authors, *tags',
      covers: 'bookId',
      meta: 'key',
    })

    this.version(3).stores({
      books:
        'id, isbn13, isbn10, title, status, updatedAt, deletedAt, dirty, publishedYear, genre, series, *authors, *tags',
      covers: 'bookId',
      meta: 'key',
      snapshots: 'id, at',
    })
  }
}

export const db = new BookshelfDB()
