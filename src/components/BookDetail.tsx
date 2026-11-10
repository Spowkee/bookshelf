import { useEffect, useRef, useState } from 'react'
import { STATUS_LABELS, STATUS_ORDER, type Book, type ReadingStatus } from '../db/schema'
import {
  deleteBook,
  updateBook,
  refreshOne,
  setUserCover,
  removeCover,
  hasCover,
  listSuggestions,
} from '../db/repo'
import { SOURCE_LABELS, coverCandidates, lookupByIsbn } from '../api'
import { formatIsbn } from '../lib/isbn'
import { languageLabel } from '../lib/language'
import { GENRES } from '../lib/genre'
import { seriesLabel } from '../lib/series'
import { BookCover } from './BookCover'
import { IconRefresh } from './icons'
import { downscaleImage } from '../lib/image'
import { Sheet } from './Sheet'

interface Props {
  book: Book
  onClose: () => void
  onChanged: () => void
}

export function BookDetail({ book, onClose, onChanged }: Props) {
  const [status, setStatus] = useState(book.status)
  const [rating, setRating] = useState(book.rating ?? 0)
  const [notes, setNotes] = useState(book.notes ?? '')
  const [tagText, setTagText] = useState(book.tags.join(', '))
  const [genre, setGenre] = useState(book.genre ?? '')
  const [series, setSeries] = useState(book.series ?? '')
  const [seriesIndex, setSeriesIndex] = useState(book.seriesIndex ? String(book.seriesIndex) : '')
  const [startedAt, setStartedAt] = useState(book.startedAt ?? '')
  const [finishedAt, setFinishedAt] = useState(book.finishedAt ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newTagOpen, setNewTagOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [coverKey, setCoverKey] = useState(0)
  const [ownCover, setOwnCover] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const [suggestions, setSuggestions] = useState<{ tags: string[]; series: string[] }>({
    tags: [],
    series: [],
  })

  useEffect(() => {
    void listSuggestions().then(setSuggestions)
  }, [])

  const currentTags = tagText.split(',').map((t) => t.trim()).filter(Boolean)

  // Les suggestions déjà portées par le livre sont retirées de la liste :
  // elles figurent au-dessus, avec leur croix de retrait.
  const unusedSuggestions = suggestions.tags.filter((t) => !currentTags.includes(t))

  function toggleTag(tag: string) {
    const next = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag]
    setTagText(next.join(', '))
  }

  function addNewTag() {
    const value = newTag.trim().replace(/,/g, ' ')
    if (!value) return
    // Si le tag existe déjà à la casse près, on reprend l'orthographe en place
    // plutôt que d'en créer une variante.
    const existing = suggestions.tags.find((t) => t.toLowerCase() === value.toLowerCase())
    const tag = existing ?? value
    if (!currentTags.includes(tag)) setTagText([...currentTags, tag].join(', '))
    setNewTag('')
    setNewTagOpen(false)
  }

  useEffect(() => {
    void hasCover(book.id).then(setOwnCover)
  }, [book.id, coverKey])

  async function pickCover(file: File) {
    try {
      await setUserCover(book.id, await downscaleImage(file))
      // Force le rechargement du blob affiche par BookCover.
      setCoverKey((k) => k + 1)
      onChanged()
    } catch {
      setRefreshMsg("Image illisible. Essaie un autre fichier.")
    } finally {
      if (photoRef.current) photoRef.current.value = ''
    }
  }
  const [saving, setSaving] = useState(false)

  function pickStatus(s: ReadingStatus) {
    setStatus(s)
    // Pre-remplissage de la date : on passe un livre en "Lu" bien plus souvent
    // le jour ou on le finit qu'un autre jour.
    const today = new Date().toISOString().slice(0, 10)
    if (s === 'read' && !finishedAt) setFinishedAt(today)
    if (s === 'reading' && !startedAt) setStartedAt(today)
  }

  async function save() {
    setSaving(true)
    try {
      await updateBook(book.id, {
        status,
        rating: rating || undefined,
        notes: notes.trim() || undefined,
        tags: tagText.split(',').map((t) => t.trim()).filter(Boolean),
        genre: genre || undefined,
        series: series.trim() || undefined,
        seriesIndex: seriesIndex ? Number(seriesIndex) : undefined,
        startedAt: startedAt || undefined,
        finishedAt: finishedAt || undefined,
      })
      onChanged()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    await deleteBook(book.id)
    onChanged()
    onClose()
  }

  async function refresh() {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await refreshOne(book, { lookup: lookupByIsbn, coverUrls: coverCandidates })
      const bits: string[] = []
      if (res.coversAdded > 0) bits.push('couverture récupérée')
      if (res.fieldsFilled > 0) bits.push(`${res.fieldsFilled} champ${res.fieldsFilled > 1 ? 's' : ''} complété${res.fieldsFilled > 1 ? 's' : ''}`)
      setRefreshMsg(bits.length > 0 ? bits.join(', ') + '.' : 'Rien de plus trouvé dans les catalogues.')
      onChanged()
    } catch {
      setRefreshMsg('Catalogues injoignables. Vérifie ta connexion.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Sheet onClose={onClose} title={book.title}>
      <div className="detail-head">
        <BookCover key={coverKey} bookId={book.id} coverUrl={book.coverUrl} title={book.title} />
        <div style={{ minWidth: 0 }}>
          <h2>{book.title}</h2>
          {book.subtitle && <p className="small muted" style={{ margin: '0 0 6px' }}>{book.subtitle}</p>}
          <p className="authors">{book.authors.join(', ') || 'Auteur inconnu'}</p>
          <div className="chips">
            {book.series && (
              <span className="chip chip-static">
                {seriesLabel(book.series, book.seriesIndex)}
              </span>
            )}
            {book.genre && <span className="chip chip-static">{book.genre}</span>}
            {book.publishedYear && <span className="chip chip-static">{book.publishedYear}</span>}
            {book.pageCount && <span className="chip chip-static">{book.pageCount} p.</span>}
            {book.language && <span className="chip chip-static">{languageLabel(book.language)}</span>}
          </div>
        </div>
      </div>

      <div className="section-title">Statut</div>
      <div className="chips">
        {STATUS_ORDER.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => pickStatus(s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="section-title">Note</div>
      <div className="row">
        <div className="stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className="star"
              aria-pressed={n <= rating}
              aria-label={`${n} sur 5`}
              onClick={() => setRating(n === rating ? 0 : n)}
            >
              ★
            </button>
          ))}
        </div>
        {rating > 0 && (
          <button className="btn btn-ghost tiny" onClick={() => setRating(0)}>effacer</button>
        )}
      </div>

      <div className="section-title">Dates</div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="d-start">Commencé</label>
          <input id="d-start" className="input" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="d-end">Terminé</label>
          <input id="d-end" className="input" type="date" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} />
        </div>
      </div>

      <div className="section-title">Genre</div>
      <select className="input" value={genre} onChange={(e) => setGenre(e.target.value)}>
        <option value="">— non classé —</option>
        {GENRES.map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
        {genre && !(GENRES as readonly string[]).includes(genre) && (
          <option value={genre}>{genre}</option>
        )}
      </select>

      <div className="section-title">Série</div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input
          className="input"
          style={{ flex: 1 }}
          list="known-series"
          value={series}
          onChange={(e) => setSeries(e.target.value)}
          placeholder="Le Trône de fer"
        />
        <datalist id="known-series">
          {suggestions.series.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <input
          className="input"
          style={{ width: 92 }}
          type="number"
          min="1"
          inputMode="numeric"
          value={seriesIndex}
          onChange={(e) => setSeriesIndex(e.target.value)}
          placeholder="Tome"
          aria-label="Numéro de tome"
        />
      </div>
      {series && (
        <p className="tiny muted">{seriesLabel(series, seriesIndex ? Number(seriesIndex) : undefined)}</p>
      )}

      <div className="section-title">Mes tags</div>

      {/* La liste d'abord : choisir dans l'existant est le geste courant, et
          c'est ce qui empêche « polar », « Polar » et « polard » de coexister.
          La saisie libre reste accessible, mais en second rideau. */}
      {currentTags.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {currentTags.map((t) => (
            <button key={t} className="chip" aria-pressed onClick={() => toggleTag(t)}>
              {t} ✕
            </button>
          ))}
        </div>
      )}

      {unusedSuggestions.length > 0 && (
        <>
          <p className="tiny muted" style={{ margin: '0 0 6px' }}>
            Tags déjà utilisés — appuie pour ajouter :
          </p>
          <div className="chips">
            {unusedSuggestions.slice(0, 18).map((t) => (
              <button key={t} className="chip" onClick={() => toggleTag(t)}>
                {t}
              </button>
            ))}
          </div>
        </>
      )}

      {newTagOpen ? (
        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            value={newTag}
            autoFocus
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addNewTag()
              }
            }}
            placeholder="offert par Marie"
          />
          <button className="btn btn-primary" onClick={addNewTag} disabled={!newTag.trim()}>
            Ajouter
          </button>
          <button className="btn btn-ghost" onClick={() => setNewTagOpen(false)} aria-label="Annuler">
            ✕
          </button>
        </div>
      ) : (
        <button
          className="btn btn-ghost"
          style={{ marginTop: 10, paddingLeft: 0 }}
          onClick={() => setNewTagOpen(true)}
        >
          + Créer un tag
        </button>
      )}

      <div className="section-title">Mes notes</div>
      <textarea
        className="input"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Ce que tu veux retenir de ce livre…"
      />

      {book.description && (
        <>
          <div className="section-title">Résumé</div>
          <p className="small muted" style={{ marginTop: 0 }}>{book.description}</p>
        </>
      )}

      {book.subjects.length > 0 && (
        <>
          <div className="section-title">Sujets</div>
          <div className="chips">
            {book.subjects.slice(0, 8).map((s) => (
              <span key={s} className="chip chip-static">{s}</span>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Fiche</div>
      <div className="card small">
        {book.publisher && <div className="stat-row"><span className="muted">Éditeur</span><b>{book.publisher}</b></div>}
        {book.isbn13 && <div className="stat-row"><span className="muted">ISBN</span><b>{formatIsbn(book.isbn13)}</b></div>}
        <div className="stat-row"><span className="muted">Source</span><b>{SOURCE_LABELS[book.source]}</b></div>
        <div className="stat-row"><span className="muted">Ajouté le</span><b>{book.createdAt.slice(0, 10)}</b></div>
      </div>

      {(book.isbn13 || book.isbn10) && (
        <>
          <div style={{ height: 10 }} />
          <button className="btn btn-block" onClick={refresh} disabled={refreshing}>
            {refreshing ? <span className="spinner" /> : <IconRefresh />}
            Compléter depuis les catalogues
          </button>
          {refreshMsg && <p className="tiny muted center" style={{ marginTop: 6 }}>{refreshMsg}</p>}
        </>
      )}

      <div style={{ height: 10 }} />
      <div className="btn-pair">
        <button className="btn" onClick={() => photoRef.current?.click()}>
          {ownCover ? 'Changer la couverture' : 'Photographier la couverture'}
        </button>
        <button
          className="btn"
          disabled={!ownCover}
          onClick={async () => {
            await removeCover(book.id)
            setCoverKey((k) => k + 1)
            onChanged()
          }}
        >
          Retirer l'image
        </button>
      </div>
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void pickCover(f)
        }}
      />
      <p className="tiny muted">
        Aucun catalogue n'illustre environ la moitié des livres français. Photographier la
        couverture est souvent le seul moyen d'en avoir une. L'image est réduite à 600 px
        avant stockage.
      </p>

      <div style={{ height: 20 }} />

      <button className="btn btn-primary btn-block" onClick={save} disabled={saving}>
        {saving ? <span className="spinner" /> : 'Enregistrer'}
      </button>

      <div style={{ height: 10 }} />

      {confirmDelete ? (
        <div className="row">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>Annuler</button>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={remove}>Confirmer la suppression</button>
        </div>
      ) : (
        <button className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
          Retirer de ma bibliothèque
        </button>
      )}
    </Sheet>
  )
}
