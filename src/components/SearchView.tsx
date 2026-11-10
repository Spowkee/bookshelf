import { useRef, useState } from 'react'
import { isEmptyQuery, searchBooks, SOURCE_LABELS, type BookDraft, type SearchQuery } from '../api'
import { BookCover } from './BookCover'
import { IconSearch } from './icons'

interface Props {
  onPick: (draft: BookDraft) => void
}

export function SearchView({ onPick }: Props) {
  const [query, setQuery] = useState<SearchQuery>({ title: '', author: '', publisher: '' })
  const [results, setResults] = useState<BookDraft[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function set(field: keyof SearchQuery, value: string) {
    setQuery((q) => ({ ...q, [field]: value }))
  }

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (isEmptyQuery(query)) return

    // Une recherche lancee remplace la precedente : sinon une reponse lente
    // peut ecraser les resultats d'une requete plus recente.
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)
    try {
      const found = await searchBooks(query, 24, ctrl.signal)
      if (!ctrl.signal.aborted) setResults(found)
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setError(err instanceof Error ? err.message : 'La recherche a échoué.')
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={run}>
        <div className="field">
          <label htmlFor="q-title">Titre</label>
          <input id="q-title" className="input" value={query.title} onChange={(e) => set('title', e.target.value)} placeholder="L'Étranger" />
        </div>
        <div className="field">
          <label htmlFor="q-author">Auteur</label>
          <input id="q-author" className="input" value={query.author} onChange={(e) => set('author', e.target.value)} placeholder="Camus" />
        </div>
        <div className="field">
          <label htmlFor="q-publisher">Éditeur</label>
          <input id="q-publisher" className="input" value={query.publisher} onChange={(e) => set('publisher', e.target.value)} placeholder="Gallimard" />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={loading || isEmptyQuery(query)}>
          {loading ? <span className="spinner" /> : 'Rechercher'}
        </button>
      </form>

      <p className="tiny muted center" style={{ marginTop: 10 }}>
        Les champs se combinent. Open Library et Google Books sont interrogés en parallèle.
      </p>

      {error && <div className="banner banner-error" style={{ marginTop: 14 }}>{error}</div>}

      {results !== null && !loading && (
        <>
          <div className="section-title">
            {results.length === 0 ? 'Aucun résultat' : `${results.length} résultat${results.length > 1 ? 's' : ''}`}
          </div>
          {results.length === 0 ? (
            <div className="empty">
              <IconSearch />
              <p>Essaie avec moins de critères, ou juste le titre.</p>
            </div>
          ) : (
            <div className="stack">
              {results.map((d, i) => (
                <button key={`${d.isbn13 ?? d.sourceId ?? i}`} className="result" onClick={() => onPick(d)}>
                  <BookCover coverUrl={d.coverUrl} title={d.title} />
                  <div className="result-body">
                    <h4>{d.title}</h4>
                    <p>{d.authors.join(', ') || 'Auteur inconnu'}</p>
                    <div className="chips" style={{ marginTop: 6 }}>
                      {d.publishedYear && <span className="chip chip-static">{d.publishedYear}</span>}
                      {d.publisher && <span className="chip chip-static">{d.publisher}</span>}
                      <span className="chip chip-static">{SOURCE_LABELS[d.source]}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
