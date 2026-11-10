import type { MetadataSource } from '../db/schema'

/**
 * Forme normalisée commune aux trois sources. Chaque provider traduit sa
 * réponse maison vers ce type : le reste de l'app ne sait pas d'où vient
 * un livre, ce qui permet d'ajouter une source sans toucher aux écrans.
 */
export interface BookDraft {
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
}

export interface SearchQuery {
  title?: string
  author?: string
  publisher?: string
  subject?: string
  /** Recherche libre, utilisée si aucun champ ciblé n'est rempli. */
  free?: string
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return !q.title?.trim() && !q.author?.trim() && !q.publisher?.trim() && !q.subject?.trim() && !q.free?.trim()
}
