import { useCallback, useMemo, useRef, useState } from 'react'
import { STATUS_LABELS, STATUS_ORDER, type Book, type ReadingStatus } from '../db/schema'
import { BookCover } from './BookCover'
import { IconBooks } from './icons'
import { AlphabetIndex, indexLetter } from './AlphabetIndex'
import { seriesKey } from '../lib/series'

type SortKey = 'recent' | 'title' | 'author' | 'genre' | 'series' | 'year' | 'rating'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Récents',
  title: 'Titre',
  author: 'Auteur',
  genre: 'Genre',
  series: 'Série',
  year: 'Année',
  rating: 'Note',
}

/** Les tris où un index alphabétique a du sens. */
const ALPHABETICAL: SortKey[] = ['title', 'author']

interface Props {
  books: Book[]
  onOpen: (book: Book) => void
  onGoScan: () => void
}

/** Normalise pour une recherche insensible aux accents et à la casse. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Clé de classement d'un titre : le titre lui-même, article compris.
 *
 * « Les Misérables » se range donc à L. C'est le choix de l'utilisateur, et
 * c'est aussi le plus prévisible : on cherche un livre par ce qu'on lit sur la
 * tranche, pas par une forme normalisée qu'il faudrait deviner.
 */
function sortableTitle(title: string): string {
  return title.trim()
}

export function Library({ books, onOpen, onGoScan }: Props) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [genreFilter, setGenreFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('recent')
  const sectionRefs = useRef(new Map<string, HTMLDivElement>())

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of books) for (const t of b.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12)
  }, [books])

  const allGenres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of books) if (b.genre) counts.set(b.genre, (counts.get(b.genre) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
  }, [books])

  const shown = useMemo(() => {
    const q = fold(query.trim())
    let list = books

    if (statusFilter !== 'all') list = list.filter((b) => b.status === statusFilter)
    if (tagFilter) list = list.filter((b) => b.tags.includes(tagFilter))
    if (genreFilter) list = list.filter((b) => b.genre === genreFilter)
    if (q) {
      list = list.filter(
        (b) =>
          fold(b.title).includes(q) ||
          b.authors.some((a) => fold(a).includes(q)) ||
          (b.publisher ? fold(b.publisher).includes(q) : false) ||
          b.tags.some((t) => fold(t).includes(q)),
      )
    }

    const sorted = [...list]
    sorted.sort((a, b) => {
      switch (sort) {
        case 'title':
          return sortableTitle(a.title).localeCompare(sortableTitle(b.title), 'fr')
        case 'author':
          return (a.authors[0] ?? 'zzz').localeCompare(b.authors[0] ?? 'zzz', 'fr')
        case 'genre': {
          // Les livres non classés ferment la marche plutôt que de s'intercaler
          // en tête sous une section vide.
          const ga = a.genre ?? '\uffff'
          const gb = b.genre ?? '\uffff'
          if (ga !== gb) return ga.localeCompare(gb, 'fr')
          return sortableTitle(a.title).localeCompare(sortableTitle(b.title), 'fr')
        }
        case 'series': {
          const sa = a.series ?? '\uffff'
          const sb = b.series ?? '\uffff'
          if (sa !== sb) return sa.localeCompare(sb, 'fr')
          // Dans une série, l'ordre des tomes prime sur tout le reste.
          const ia = a.seriesIndex ?? 999
          const ib = b.seriesIndex ?? 999
          if (ia !== ib) return ia - ib
          return sortableTitle(a.title).localeCompare(sortableTitle(b.title), 'fr')
        }
        case 'year':
          return (b.publishedYear ?? 0) - (a.publishedYear ?? 0)
        case 'rating':
          return (b.rating ?? 0) - (a.rating ?? 0)
        default:
          return b.updatedAt.localeCompare(a.updatedAt)
      }
    })
    return sorted
  }, [books, query, statusFilter, tagFilter, genreFilter, sort])

  const alphabetical = ALPHABETICAL.includes(sort)
  const grouped = sort === 'genre' || sort === 'series'

  /**
   * Découpe la liste triée en sections.
   *
   * Par titre ou auteur, une section = une lettre, et l'index A–Z sert à
   * naviguer. Par genre ou par série, une section = un genre ou une série :
   * l'index alphabétique n'aurait plus de sens, on l'enlève.
   */
  const sections = useMemo(() => {
    if (!alphabetical && !grouped) return null
    const groups: Array<{ letter: string; label?: string; books: Book[] }> = []

    for (const book of shown) {
      let letter: string
      let label: string | undefined

      if (sort === 'genre') {
        label = book.genre ?? 'Non classé'
        letter = label
      } else if (sort === 'series') {
        label = book.series ?? 'Hors série'
        letter = book.series ? seriesKey(book.series) : '\uffff'
      } else {
        const key = sort === 'author' ? (book.authors[0] ?? '#') : sortableTitle(book.title)
        letter = indexLetter(key)
      }

      const last = groups[groups.length - 1]
      if (last && last.letter === letter) last.books.push(book)
      else groups.push({ letter, label, books: [book] })
    }
    return groups
  }, [shown, alphabetical, grouped, sort])

  const available = useMemo(() => new Set((sections ?? []).map((s) => s.letter)), [sections])

  const scrollToLetter = useCallback((letter: string) => {
    sectionRefs.current.get(letter)?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [])

  if (books.length === 0) {
    return (
      <div className="empty">
        <IconBooks />
        <h3>Ta bibliothèque est vide</h3>
        <p>Scanne le code-barres au dos d'un livre pour l'ajouter en deux secondes.</p>
        <button className="btn btn-primary" onClick={onGoScan}>Scanner un livre</button>
      </div>
    )
  }

  const renderGrid = (list: Book[]) => (
    <div className="grid">
      {list.map((b) => (
        <button key={b.id} className="grid-item" onClick={() => onOpen(b)}>
          <BookCover bookId={b.id} coverUrl={b.coverUrl} title={b.title}>
            <span className={`status-dot dot-${b.status}`} title={STATUS_LABELS[b.status]} />
          </BookCover>
          <h4>{b.title}</h4>
          <p>{sort === 'series' && b.seriesIndex ? `Tome ${b.seriesIndex}` : (b.authors[0] ?? '—')}</p>
        </button>
      ))}
    </div>
  )

  return (
    <>
      <input
        className="input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filtrer par titre, auteur, éditeur, tag…"
        style={{ marginBottom: 12 }}
      />

      <div className="chips" style={{ marginBottom: 10 }}>
        <button className="chip" aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
          Tout ({books.length})
        </button>
        {STATUS_ORDER.map((s) => {
          const n = books.filter((b) => b.status === s).length
          if (n === 0) return null
          return (
            <button key={s} className="chip" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {STATUS_LABELS[s]} ({n})
            </button>
          )
        })}
      </div>

      {allGenres.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {allGenres.map(([g, n]) => (
            <button
              key={g}
              className="chip"
              aria-pressed={genreFilter === g}
              onClick={() => setGenreFilter(genreFilter === g ? null : g)}
            >
              {g} ({n})
            </button>
          ))}
        </div>
      )}

      {allTags.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {allTags.map((t) => (
            <button
              key={t}
              className="chip"
              aria-pressed={tagFilter === t}
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 14 }}>
        <span className="tiny muted">
          {shown.length} livre{shown.length > 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <select
          className="input"
          style={{ width: 'auto', padding: '7px 10px', fontSize: '0.85rem' }}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Trier par"
        >
          {Object.entries(SORT_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="empty small">Aucun livre ne correspond à ce filtre.</p>
      ) : sections ? (
        <div className={alphabetical ? 'indexed' : undefined}>
          <div className="indexed-content">
            {sections.map((section) => (
              <div
                key={section.letter}
                className="alpha-section"
                ref={(el) => {
                  if (el) sectionRefs.current.set(section.letter, el)
                  else sectionRefs.current.delete(section.letter)
                }}
              >
                <h3 className="alpha-head">
                  {section.label ?? section.letter}
                  <span>{section.books.length}</span>
                </h3>
                {renderGrid(section.books)}
              </div>
            ))}
          </div>
          {alphabetical && <AlphabetIndex available={available} onPick={scrollToLetter} />}
        </div>
      ) : (
        renderGrid(shown)
      )}
    </>
  )
}
