import type { BookDraft, SearchQuery } from './types'
import { toIsbn13, normalizeIsbn, isValidIsbn10 } from '../lib/isbn'

const BASE = 'https://www.googleapis.com/books/v1/volumes'

/**
 * Clé optionnelle. Sans clé, le quota est partagé par IP et suffit largement
 * à un usage personnel ; avec clé, le quota est propre au projet. Renseigner
 * VITE_GOOGLE_BOOKS_KEY dans .env.local pour l'activer.
 */
const API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_KEY as string | undefined

interface GbVolume {
  id?: string
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publisher?: string
    publishedDate?: string
    description?: string
    pageCount?: number
    categories?: string[]
    language?: string
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>
    imageLinks?: { smallThumbnail?: string; thumbnail?: string }
  }
}

function toDraft(v: GbVolume): BookDraft | null {
  const info = v.volumeInfo
  if (!info?.title) return null

  const ids = info.industryIdentifiers ?? []
  const rawIsbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
  const rawIsbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier

  // Google sert les vignettes en http sur certaines réponses, ce qui serait
  // bloqué comme contenu mixte dans une PWA servie en https.
  const cover = (info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail)?.replace(/^http:/, 'https:')

  return {
    isbn13: rawIsbn13 ? (toIsbn13(rawIsbn13) ?? undefined) : undefined,
    isbn10: rawIsbn10 && isValidIsbn10(normalizeIsbn(rawIsbn10)) ? normalizeIsbn(rawIsbn10) : undefined,
    title: info.title,
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedYear: info.publishedDate ? Number(info.publishedDate.slice(0, 4)) || undefined : undefined,
    pageCount: info.pageCount,
    language: info.language,
    description: info.description,
    subjects: (info.categories ?? []).slice(0, 12),
    coverUrl: cover,
    source: 'googlebooks',
    sourceId: v.id,
  }
}

/**
 * Gestion du quota Google.
 *
 * Sans clé, le quota est compté par adresse IP et partagé avec tous ceux qui
 * sortent par la même. Une fois la limite atteinte, Google répond 429 à TOUTES
 * les requêtes suivantes, parfois pendant des heures. Marteler l'API dans cet
 * état est non seulement inutile, c'est ce qui prolonge le blocage.
 *
 * D'où deux garde-fous :
 *  - un espacement minimal entre deux appels, pour ne pas déclencher la limite ;
 *  - une mise en sommeil dès le premier 429 : on cesse d'appeler Google et on
 *    laisse les autres sources prendre le relais, sans échouer pour autant.
 *
 * L'état vit en mémoire : un redémarrage de l'app repart à zéro, ce qui est le
 * comportement voulu puisque le quota se renouvelle de son côté.
 */
const MIN_INTERVAL_MS = 300
const COOLDOWN_MS = 15 * 60 * 1000

let lastCallAt = 0
let throttledUntil = 0

/** Google est-il en sommeil pour cause de quota dépassé ? */
export function isThrottled(): boolean {
  return Date.now() < throttledUntil
}

/** Minutes restantes avant de pouvoir réessayer. */
export function throttleMinutesLeft(): number {
  return Math.max(0, Math.ceil((throttledUntil - Date.now()) / 60_000))
}

export function resetThrottle(): void {
  throttledUntil = 0
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function gbFetch(params: URLSearchParams, signal?: AbortSignal): Promise<GbVolume[]> {
  if (isThrottled()) throw new Error('Google Books: quota atteint, en pause')

  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()

  if (API_KEY) params.set('key', API_KEY)
  const res = await fetch(`${BASE}?${params}`, { signal })

  if (res.status === 429 || res.status === 403) {
    throttledUntil = Date.now() + COOLDOWN_MS
    throw new Error('Google Books: quota atteint')
  }
  if (!res.ok) throw new Error(`Google Books: HTTP ${res.status}`)

  const data = (await res.json()) as { items?: GbVolume[] }
  return data.items ?? []
}

export async function lookupIsbn(isbn: string, signal?: AbortSignal): Promise<BookDraft | null> {
  const items = await gbFetch(new URLSearchParams({ q: `isbn:${isbn}`, maxResults: '1' }), signal)
  return items.length > 0 ? toDraft(items[0]) : null
}

/**
 * Google n'a pas de paramètres de filtre séparés : les filtres passent par des
 * préfixes dans la chaîne `q` (intitle:, inauthor:, inpublisher:, subject:).
 */
export async function search(query: SearchQuery, limit = 20, signal?: AbortSignal): Promise<BookDraft[]> {
  const parts: string[] = []
  if (query.title?.trim()) parts.push(`intitle:${JSON.stringify(query.title.trim())}`)
  if (query.author?.trim()) parts.push(`inauthor:${JSON.stringify(query.author.trim())}`)
  if (query.publisher?.trim()) parts.push(`inpublisher:${JSON.stringify(query.publisher.trim())}`)
  if (query.subject?.trim()) parts.push(`subject:${JSON.stringify(query.subject.trim())}`)
  if (parts.length === 0 && query.free?.trim()) parts.push(query.free.trim())
  if (parts.length === 0) return []

  const items = await gbFetch(
    new URLSearchParams({ q: parts.join('+'), maxResults: String(Math.min(limit, 40)), printType: 'books' }),
    signal,
  )
  return items.map(toDraft).filter((d): d is BookDraft => d !== null)
}
