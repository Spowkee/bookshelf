import { useEffect, useState } from 'react'
import { STATUS_LABELS, type Book } from '../db/schema'
import { addBook, booksInSeries, cacheCoverFromCandidates, draftToBook } from '../db/repo'
import { coverCandidates, findSeriesVolumes, missingVolumes, type SeriesVolume } from '../api'
import { seriesKey } from '../lib/series'
import { BookCover } from './BookCover'
import { Sheet } from './Sheet'

interface Props {
  series: string
  author?: string
  currentId: string
  onClose: () => void
  onOpenBook: (book: Book) => void
  onChanged: () => void
}

/**
 * Vue d'ensemble d'une série.
 *
 * Répond à la question qu'on se pose devant un rayon : qu'est-ce que j'ai lu,
 * qu'est-ce qu'il me manque, et qu'est-ce qui existe après. Les tomes possédés
 * viennent de la bibliothèque, les autres des catalogues — à la demande, pour
 * ne pas déclencher deux requêtes réseau à chaque ouverture d'une fiche.
 */
export function SeriesSheet({ series, author, currentId, onClose, onOpenBook, onChanged }: Props) {
  const [owned, setOwned] = useState<Book[]>([])
  const [found, setFound] = useState<SeriesVolume[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const reload = async () => setOwned(await booksInSeries(series))

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series])

  const ownedNumbers = owned.map((b) => b.seriesIndex).filter((n): n is number => !!n)
  const gaps = missingVolumes(ownedNumbers)
  const readCount = owned.filter((b) => b.status === 'read').length

  /** Un tome déjà possédé ne doit pas être proposé à l'ajout. */
  function alreadyOwned(v: SeriesVolume): boolean {
    if (v.volume !== undefined && ownedNumbers.includes(v.volume)) return true
    if (v.isbn13 && owned.some((b) => b.isbn13 === v.isbn13)) return true
    return owned.some((b) => seriesKey(b.title) === seriesKey(v.title))
  }

  async function search() {
    setSearching(true)
    setError(null)
    try {
      setFound(await findSeriesVolumes(series, author))
    } catch {
      setError('Catalogues injoignables. Réessaie plus tard.')
    } finally {
      setSearching(false)
    }
  }

  async function add(volume: SeriesVolume) {
    setAdding(volume.title)
    try {
      const book = draftToBook(volume, 'to-read')
      book.series = series
      if (volume.volume) book.seriesIndex = volume.volume
      await addBook(book)
      void cacheCoverFromCandidates(
        book.id,
        coverCandidates({ isbn13: book.isbn13, isbn10: book.isbn10, knownUrl: volume.coverUrl }),
      )
      await reload()
      onChanged()
    } finally {
      setAdding(null)
    }
  }

  const missing = (found ?? []).filter((v) => !alreadyOwned(v))

  return (
    <Sheet onClose={onClose} title={series}>
      <div className="section-title">Ce que tu as</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        {owned.length} tome{owned.length > 1 ? 's' : ''} dans ta bibliothèque, dont {readCount} lu
        {readCount > 1 ? 's' : ''}.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {owned.map((b) => (
          <button
            key={b.id}
            className="dup-row serie-row"
            data-current={b.id === currentId}
            onClick={() => b.id !== currentId && onOpenBook(b)}
          >
            <BookCover bookId={b.id} coverUrl={b.coverUrl} title={b.title} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <b>{b.seriesIndex ? `Tome ${b.seriesIndex}` : b.title}</b>
              {b.seriesIndex && <div className="tiny muted">{b.title}</div>}
            </div>
            <span className={`status-pill dot-${b.status}`}>{STATUS_LABELS[b.status]}</span>
          </button>
        ))}
      </div>

      {gaps.length > 0 && (
        <div className="banner banner-error" style={{ marginTop: 12 }}>
          <b>Tome{gaps.length > 1 ? 's' : ''} manquant{gaps.length > 1 ? 's' : ''} : {gaps.join(', ')}.</b>{' '}
          Ils se situent entre des tomes que tu possèdes déjà.
        </div>
      )}

      <div className="section-title">La suite</div>

      {found === null ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Interroge les catalogues pour lister les autres tomes publiés et repérer ceux qu'il te
            reste à lire.
          </p>
          <button className="btn btn-block" onClick={search} disabled={searching}>
            {searching ? <span className="spinner" /> : 'Chercher les autres tomes'}
          </button>
        </>
      ) : error ? (
        <div className="banner banner-error">{error}</div>
      ) : missing.length === 0 ? (
        <p className="small muted" style={{ marginTop: 0 }}>
          Rien trouvé que tu n'aies déjà. Soit la série est complète chez toi, soit les catalogues
          ne connaissent pas ses autres tomes — fréquent pour l'édition française.
        </p>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            {missing.length} tome{missing.length > 1 ? 's' : ''} que tu n'as pas. « À lire » les
            ajoute à ta bibliothèque avec ce statut.
          </p>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {missing.slice(0, 40).map((v) => (
              <div className="dup-row" key={`${v.volume ?? ''}${v.title}`}>
                <BookCover coverUrl={v.coverUrl} title={v.title} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{v.volume ? `Tome ${v.volume}` : v.title}</b>
                  {v.volume && <div className="tiny muted">{v.title}</div>}
                  {v.publishedYear && <div className="tiny muted">{v.publishedYear}</div>}
                </div>
                <button
                  className="btn btn-ghost tiny"
                  onClick={() => add(v)}
                  disabled={adding === v.title}
                >
                  {adding === v.title ? <span className="spinner" /> : '+ À lire'}
                </button>
              </div>
            ))}
          </div>
          <p className="tiny muted">
            Les éditions étrangères remontent souvent en premier : vérifie la fiche après ajout, et
            complète-la depuis la fiche du livre si besoin.
          </p>
        </>
      )}
    </Sheet>
  )
}
