import type { BookDraft } from './types'
import * as openlibrary from './openlibrary'
import { seriesKey, volumeNumberFor } from '../lib/series'
import { normalizeLanguage } from '../lib/language'

export interface SeriesVolume extends BookDraft {
  /** Numéro de tome, quand le titre permet de le déduire. */
  volume?: number
}

/**
 * Recherche les autres tomes d'une série dans les catalogues.
 *
 * Deux requêtes complémentaires, vérifiées sur le service réel :
 *  - `q=series:"…"` : Open Library expose bien cet index — 289 résultats pour
 *    One Piece — mais il est inégalement renseigné selon les séries ;
 *  - titre + auteur : plus bruyant, mais rattrape les séries absentes de
 *    l'index précédent.
 *
 * Les doublons d'éditions sont écrasés : une série de cent tomes publiée dans
 * huit pays remonterait autrement huit cents lignes. On garde une entrée par
 * tome, ou à défaut par titre pour les séries dont les volumes portent un nom
 * plutôt qu'un numéro — Harry Potter, par exemple.
 */
export async function findSeriesVolumes(
  series: string,
  author?: string,
  signal?: AbortSignal,
): Promise<SeriesVolume[]> {
  const settled = <T,>(p: Promise<T>) => p.catch(() => null)

  const [bySeries, byTitle] = await Promise.all([
    settled(openlibrary.search({ free: `series:"${series}"` }, 60, signal)),
    settled(openlibrary.search({ title: series, author }, 60, signal)),
  ])

  const candidates = [...(bySeries ?? []), ...(byTitle ?? [])]
  const wanted = seriesKey(series)
  const best = new Map<string, SeriesVolume>()

  for (const draft of candidates) {
    // Écarte ce qui ne relève pas de la série : la recherche par titre ramène
    // volontiers des livres qui citent la série sans en faire partie.
    if (!seriesKey(draft.title).startsWith(wanted)) continue

    const volume = volumeNumberFor(draft.title, series)
    const key = volume !== undefined ? `v:${volume}` : `t:${seriesKey(draft.title)}`

    const previous = best.get(key)
    const candidate: SeriesVolume = {
      ...draft,
      volume,
      language: normalizeLanguage(draft.language),
    }

    // À tome égal, on retient l'édition la mieux documentée — de préférence
    // avec un ISBN, qui permettra de l'ajouter proprement.
    if (!previous || score(candidate) > score(previous)) best.set(key, candidate)
  }

  return [...best.values()].sort((a, b) => {
    if (a.volume !== undefined && b.volume !== undefined) return a.volume - b.volume
    if (a.volume !== undefined) return -1
    if (b.volume !== undefined) return 1
    return a.title.localeCompare(b.title, 'fr')
  })
}

function score(v: SeriesVolume): number {
  return (
    (v.isbn13 ? 4 : 0) +
    (v.coverUrl ? 2 : 0) +
    (v.authors.length > 0 ? 1 : 0) +
    (v.language === 'fr' ? 3 : 0)
  )
}

/** Numéros absents dans une suite de tomes possédés : 1, 2, 4 → [3]. */
export function missingVolumes(owned: number[]): number[] {
  if (owned.length === 0) return []
  const present = new Set(owned)
  const max = Math.max(...owned)
  const gaps: number[] = []
  for (let i = 1; i < max; i++) {
    if (!present.has(i)) gaps.push(i)
  }
  return gaps
}
