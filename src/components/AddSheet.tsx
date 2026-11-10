import { useEffect, useState } from 'react'
import type { BookDraft } from '../api'
import { SOURCE_LABELS, coverCandidates } from '../api'
import { STATUS_LABELS, STATUS_ORDER, type Book, type ReadingStatus } from '../db/schema'
import { addBook, cacheCoverFromCandidates, draftToBook, findByIsbn } from '../db/repo'
import { BookCover } from './BookCover'
import { Sheet } from './Sheet'
import { formatIsbn } from '../lib/isbn'

interface Props {
  draft: BookDraft
  onClose: () => void
  onAdded: (book: Book) => void
}

export function AddSheet({ draft, onClose, onAdded }: Props) {
  const [status, setStatus] = useState<ReadingStatus>('read')
  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState<Book | null>(null)

  // Verification de doublon a l'ouverture : scanner deux fois le meme livre
  // est l'erreur la plus facile a commettre. Le drapeau `cancelled` evite de
  // poser un etat sur un composant demonte si l'utilisateur ferme aussitot.
  useEffect(() => {
    if (!draft.isbn13) {
      setDuplicate(null)
      return
    }
    let cancelled = false
    findByIsbn(draft.isbn13).then((found) => {
      if (!cancelled) setDuplicate(found ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [draft.isbn13])

  async function save() {
    setSaving(true)
    try {
      const book = draftToBook(draft, status)
      await addBook(book)
      onAdded(book)
      // La couverture se telecharge apres coup : l'ajout doit etre instantane,
      // pas suspendu a une image sur un reseau lent. Plusieurs URL sont
      // essayees, car Open Library n'a pas d'image pour tous les ISBN.
      void cacheCoverFromCandidates(
        book.id,
        coverCandidates({ isbn13: book.isbn13, isbn10: book.isbn10, knownUrl: draft.coverUrl }),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={onClose} title="Ajouter un livre">
      {duplicate && (
        <div className="banner banner-info">
          Tu as déjà ce livre dans ta bibliothèque ({STATUS_LABELS[duplicate.status]}). L'ajouter créera un doublon.
        </div>
      )}

      <div className="detail-head">
        <BookCover coverUrl={draft.coverUrl} title={draft.title} />
        <div style={{ minWidth: 0 }}>
          <h2>{draft.title}</h2>
          {draft.subtitle && <p className="small muted" style={{ margin: '0 0 6px' }}>{draft.subtitle}</p>}
          <p className="authors">{draft.authors.join(', ') || 'Auteur inconnu'}</p>
          <div className="chips">
            {draft.publishedYear && <span className="chip chip-static">{draft.publishedYear}</span>}
            {draft.pageCount && <span className="chip chip-static">{draft.pageCount} p.</span>}
            <span className="chip chip-static">{SOURCE_LABELS[draft.source]}</span>
          </div>
        </div>
      </div>

      {draft.publisher && <p className="small muted" style={{ marginTop: 0 }}>{draft.publisher}</p>}
      {draft.isbn13 && <p className="tiny muted">ISBN {formatIsbn(draft.isbn13)}</p>}

      <div className="section-title">Je l'ajoute comme</div>
      <div className="chips" style={{ marginBottom: 18 }}>
        {STATUS_ORDER.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="sheet-actions row">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
          {saving ? <span className="spinner" /> : 'Ajouter à ma bibliothèque'}
        </button>
      </div>
    </Sheet>
  )
}
