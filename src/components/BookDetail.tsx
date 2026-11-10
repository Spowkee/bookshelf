import { useState } from 'react'
import { STATUS_LABELS, STATUS_ORDER, type Book, type ReadingStatus } from '../db/schema'
import { deleteBook, updateBook, cacheCover } from '../db/repo'
import { SOURCE_LABELS } from '../api'
import { formatIsbn } from '../lib/isbn'
import { languageLabel } from '../lib/language'
import { BookCover } from './BookCover'
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
  const [startedAt, setStartedAt] = useState(book.startedAt ?? '')
  const [finishedAt, setFinishedAt] = useState(book.finishedAt ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
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

  return (
    <Sheet onClose={onClose}>
      <div className="detail-head">
        <BookCover bookId={book.id} coverUrl={book.coverUrl} title={book.title} />
        <div style={{ minWidth: 0 }}>
          <h2>{book.title}</h2>
          {book.subtitle && <p className="small muted" style={{ margin: '0 0 6px' }}>{book.subtitle}</p>}
          <p className="authors">{book.authors.join(', ') || 'Auteur inconnu'}</p>
          <div className="chips">
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

      <div className="section-title">Mes tags</div>
      <input
        className="input"
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        placeholder="polar, à relire, offert par Marie"
      />

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
        {!book.coverUrl ? null : (
          <div className="stat-row">
            <span className="muted">Couverture</span>
            <button className="btn btn-ghost tiny" onClick={() => book.coverUrl && cacheCover(book.id, book.coverUrl)}>
              retélécharger
            </button>
          </div>
        )}
      </div>

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
