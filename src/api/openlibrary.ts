import type { BookDraft, SearchQuery } from './types'
import { toIsbn13 } from '../lib/isbn'
import { fetchWithTimeout } from '../lib/timeout'

const BASE = 'https://openlibrary.org'
export const COVERS = 'https://covers.openlibrary.org'

/**
 * Open Library demande un User-Agent identifiant l'application, mais les
 * navigateurs interdisent de le modifier depuis du JS. On reste donc dans les
 * clous par le débit : un seul appel par ajout de livre, jamais de boucle.
 */
async function olFetch(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchWithTimeout(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Open Library: HTTP ${res.status}`)
  return res.json()
}

/** Couverture par ISBN — pas de clé, pas de quota documenté. */
export function coverUrlFromIsbn(isbn: string, size: 'S' | 'M' | 'L' = 'M'): string {
  return `${COVERS}/b/isbn/${isbn}-${size}.jpg?default=false`
}

export function coverUrlFromId(coverId: number, size: 'S' | 'M' | 'L' = 'M'): string {
  return `${COVERS}/b/id/${coverId}-${size}.jpg?default=false`
}

interface OlBooksEntry {
  title?: string
  subtitle?: string
  authors?: Array<{ name?: string }>
  publishers?: Array<{ name?: string }>
  publish_date?: string
  number_of_pages?: number
  subjects?: Array<{ name?: string }>
  cover?: { small?: string; medium?: string; large?: string }
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] }
  key?: string
  excerpts?: Array<{ text?: string }>
  notes?: string
}

function yearFrom(text?: string): number | undefined {
  if (!text) return undefined
  const m = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)
  return m ? Number(m[1]) : undefined
}

/**
 * On utilise /api/books?jscmd=data plutôt que /isbn/{isbn}.json : la seconde
 * renvoie les auteurs sous forme de références (/authors/OL123A) qu'il faudrait
 * résoudre par des appels supplémentaires. jscmd=data fait la résolution côté
 * serveur et donne auteurs, éditeurs, sujets et couverture en une requête.
 */
export async function lookupIsbn(isbn: string, signal?: AbortSignal): Promise<BookDraft | null> {
  const key = `ISBN:${isbn}`
  const data = (await olFetch(
    `${BASE}/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`,
    signal,
  )) as Record<string, OlBooksEntry>

  const entry = data[key]
  if (!entry?.title) return null

  const isbn13 = entry.identifiers?.isbn_13?.[0] ?? toIsbn13(isbn) ?? undefined
  return {
    isbn13,
    isbn10: entry.identifiers?.isbn_10?.[0],
    title: entry.title,
    subtitle: entry.subtitle,
    authors: (entry.authors ?? []).map((a) => a.name).filter((n): n is string => !!n),
    publisher: entry.publishers?.[0]?.name,
    publishedYear: yearFrom(entry.publish_date),
    pageCount: entry.number_of_pages,
    description: entry.excerpts?.[0]?.text ?? entry.notes,
    subjects: (entry.subjects ?? []).map((s) => s.name).filter((n): n is string => !!n).slice(0, 12),
    coverUrl: entry.cover?.medium ?? (isbn13 ? coverUrlFromIsbn(isbn13) : undefined),
    source: 'openlibrary',
    sourceId: entry.key,
  }
}

interface OlSearchDoc {
  key?: string
  title?: string
  subtitle?: string
  author_name?: string[]
  publisher?: string[]
  first_publish_year?: number
  number_of_pages_median?: number
  isbn?: string[]
  cover_i?: number
  language?: string[]
  subject?: string[]
}

/**
 * search.json accepte des champs ciblés (title, author, publisher, subject)
 * qu'on peut combiner — c'est exactement le filtrage demandé.
 */
export async function search(query: SearchQuery, limit = 20, signal?: AbortSignal): Promise<BookDraft[]> {
  const params = new URLSearchParams()
  if (query.title?.trim()) params.set('title', query.title.trim())
  if (query.author?.trim()) params.set('author', query.author.trim())
  if (query.publisher?.trim()) params.set('publisher', query.publisher.trim())
  if (query.subject?.trim()) params.set('subject', query.subject.trim())
  if (![...params.keys()].length && query.free?.trim()) params.set('q', query.free.trim())
  if (![...params.keys()].length) return []

  params.set('limit', String(limit))
  params.set('fields', 'key,title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,isbn,cover_i,language,subject')

  const data = (await olFetch(`${BASE}/search.json?${params}`, signal)) as { docs?: OlSearchDoc[] }

  return (data.docs ?? [])
    .filter((d) => d.title)
    .map((d) => {
      // Une œuvre agrège toutes ses éditions : on prend le premier ISBN-13
      // valide, qui suffit pour la couverture et la déduplication.
      const isbn13 = d.isbn?.map((i) => toIsbn13(i)).find((i): i is string => !!i)
      return {
        isbn13,
        title: d.title!,
        subtitle: d.subtitle,
        authors: d.author_name ?? [],
        publisher: d.publisher?.[0],
        publishedYear: d.first_publish_year,
        pageCount: d.number_of_pages_median,
        language: d.language?.[0],
        subjects: (d.subject ?? []).slice(0, 12),
        coverUrl: d.cover_i ? coverUrlFromId(d.cover_i) : isbn13 ? coverUrlFromIsbn(isbn13) : undefined,
        source: 'openlibrary' as const,
        sourceId: d.key,
      }
    })
}
