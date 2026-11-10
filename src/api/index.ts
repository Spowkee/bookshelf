import type { BookDraft, SearchQuery } from './types'
import * as openlibrary from './openlibrary'
import * as googlebooks from './googlebooks'
import * as bnf from './bnf'
import { toIsbn13 } from '../lib/isbn'
import { normalizeLanguage } from '../lib/language'

export type { BookDraft, SearchQuery } from './types'
export { isEmptyQuery } from './types'
export { coverUrlFromIsbn } from './openlibrary'
export {
  isThrottled as isGoogleThrottled,
  throttleMinutesLeft as googleThrottleMinutesLeft,
} from './googlebooks'

export const SOURCE_LABELS: Record<string, string> = {
  openlibrary: 'Open Library',
  googlebooks: 'Google Books',
  bnf: 'BnF',
  manual: 'Saisie manuelle',
}

/**
 * Toutes les URL de couverture plausibles, par ordre de préférence. Le premier
 * téléchargement réussi gagne.
 *
 * Pourquoi plusieurs : Open Library n'a d'image que pour une partie des ISBN,
 * et son champ `cover` est parfois vide alors que l'image existe bel et bien
 * sur son CDN — d'où l'URL reconstruite depuis l'ISBN même quand la fiche n'en
 * annonce aucune. Les vignettes Google comblent une partie du reste.
 *
 * L'ISBN-10 est tenté en dernier : les éditions d'avant 2007 sont souvent
 * indexées sous cette seule forme dans la base des couvertures.
 */
export function coverCandidates(opts: {
  isbn13?: string
  isbn10?: string
  knownUrl?: string
  googleThumb?: string
}): string[] {
  const urls: string[] = []
  if (opts.knownUrl) urls.push(opts.knownUrl)
  if (opts.isbn13) {
    urls.push(openlibrary.coverUrlFromIsbn(opts.isbn13, 'L'))
    urls.push(openlibrary.coverUrlFromIsbn(opts.isbn13, 'M'))
  }
  if (opts.googleThumb) urls.push(opts.googleThumb)
  if (opts.isbn10) urls.push(openlibrary.coverUrlFromIsbn(opts.isbn10, 'L'))
  return [...new Set(urls)]
}

/** Prend `a` en priorité, complète les trous avec `b`. */
function merge(a: BookDraft, b: BookDraft | null): BookDraft {
  if (!b) return a
  return {
    ...a,
    isbn13: a.isbn13 ?? b.isbn13,
    isbn10: a.isbn10 ?? b.isbn10,
    subtitle: a.subtitle ?? b.subtitle,
    authors: a.authors.length > 0 ? a.authors : b.authors,
    publisher: a.publisher ?? b.publisher,
    publishedYear: a.publishedYear ?? b.publishedYear,
    pageCount: a.pageCount ?? b.pageCount,
    language: a.language ?? b.language,
    description: a.description ?? b.description,
    subjects: a.subjects.length > 0 ? a.subjects : b.subjects,
    coverUrl: a.coverUrl ?? b.coverUrl,
  }
}

function settled<T>(p: Promise<T>): Promise<T | null> {
  return p.catch(() => null)
}

/**
 * Recherche par ISBN sur les deux sources en parallèle puis fusion.
 *
 * Pourquoi les deux plutôt qu'une cascade : leurs lacunes ne se recouvrent pas.
 * Open Library a la meilleure donnée bibliographique et les couvertures libres,
 * Google a plus souvent le résumé et la pagination des éditions françaises
 * récentes. Deux requêtes parallèles coûtent le même temps qu'une seule et
 * donnent une fiche nettement plus complète.
 */
export async function lookupByIsbn(rawIsbn: string, signal?: AbortSignal): Promise<BookDraft | null> {
  const isbn13 = toIsbn13(rawIsbn)
  const isbn = isbn13 ?? rawIsbn

  const [ol, gb] = await Promise.all([
    settled(openlibrary.lookupIsbn(isbn, signal)),
    settled(googlebooks.lookupIsbn(isbn, signal)),
  ])

  let draft: BookDraft | null = null
  if (ol) draft = merge(ol, gb)
  else if (gb) draft = gb
  else if (bnf.BNF_ENABLED) draft = await settled(bnf.lookupIsbn(isbn, signal))

  if (draft && !draft.isbn13 && isbn13) draft.isbn13 = isbn13
  if (draft) draft.language = normalizeLanguage(draft.language)
  return draft
}

/** Clé de déduplication : l'ISBN-13 s'il existe, sinon titre + premier auteur. */
function dedupeKey(d: BookDraft): string {
  if (d.isbn13) return `i:${d.isbn13}`
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '')
  return `t:${norm(d.title)}|${norm(d.authors[0] ?? '')}`
}

/**
 * Recherche par filtres sur les deux sources, résultats entrelacés.
 *
 * L'entrelacement (un résultat de chaque source à tour de rôle) évite qu'une
 * source monopolise le haut de la liste : les deux ont des classements de
 * pertinence très différents et on ne sait pas a priori laquelle a raison.
 */
export async function searchBooks(query: SearchQuery, limit = 20, signal?: AbortSignal): Promise<BookDraft[]> {
  const [ol, gb] = await Promise.all([
    settled(openlibrary.search(query, limit, signal)),
    settled(googlebooks.search(query, limit, signal)),
  ])

  const olList = ol ?? []
  const gbList = gb ?? []
  const seen = new Map<string, BookDraft>()
  const order: string[] = []

  for (let i = 0; i < Math.max(olList.length, gbList.length); i++) {
    for (const d of [olList[i], gbList[i]]) {
      if (!d) continue
      const key = dedupeKey(d)
      const existing = seen.get(key)
      if (existing) {
        // Même livre vu par les deux sources : on garde la fiche fusionnée.
        seen.set(key, merge(existing, d))
      } else {
        seen.set(key, d)
        order.push(key)
      }
    }
  }

  return order.slice(0, limit).map((k) => {
    const d = seen.get(k)!
    return { ...d, language: normalizeLanguage(d.language) }
  })
}
