import { useEffect, useState } from 'react'
import { findDuplicateGroups, mergeDuplicates, type DuplicateGroup, type MergeResult } from '../db/repo'
import { BookCover } from './BookCover'
import { Sheet } from './Sheet'
import { IconCheck } from './icons'

interface Props {
  onClose: () => void
  onDone: (result: MergeResult) => void
}

type Phase = 'scanning' | 'ready' | 'merging' | 'done'

/**
 * Repère et fusionne les exemplaires multiples d'un même livre.
 *
 * Nécessaire parce qu'une version antérieure de l'import créait des doublons :
 * la déduplication se faisait sur titre + auteur, et l'enrichissement d'un
 * fichier sans colonne auteur remplissait l'auteur après coup, si bien que le
 * passage suivant ne reconnaissait plus le livre.
 */
export function DuplicatesSheet({ onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('scanning')
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [result, setResult] = useState<MergeResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void findDuplicateGroups().then((found) => {
      if (cancelled) return
      setGroups(found)
      setPhase('ready')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toRemove = groups.reduce((n, g) => n + g.remove.length, 0)

  async function run() {
    setPhase('merging')
    const res = await mergeDuplicates(groups)
    setResult(res)
    setPhase('done')
  }

  if (phase === 'scanning') {
    return (
      <Sheet onClose={onClose} title="Doublons">
        <p className="center muted small" style={{ padding: '30px 0' }}>
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          Analyse de la bibliothèque…
        </p>
      </Sheet>
    )
  }

  if (phase === 'merging') {
    return (
      <Sheet onClose={onClose} title="Fusion" locked>
        <p className="center muted small" style={{ padding: '30px 0' }}>
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          Fusion en cours…
        </p>
      </Sheet>
    )
  }

  if (phase === 'done' && result) {
    return (
      <Sheet onClose={onClose} title="Terminé">
        <div className="empty">
          <IconCheck />
          <h3>Doublons fusionnés</h3>
        </div>
        <div className="card">
          <div className="stat-row">
            <span className="muted">Livres retirés</span>
            <b>{result.removed}</b>
          </div>
          <div className="stat-row">
            <span className="muted">Livres conservés</span>
            <b>{result.groups}</b>
          </div>
          <div className="stat-row">
            <span className="muted">Champs récupérés</span>
            <b>{result.fieldsRecovered}</b>
          </div>
          <div className="stat-row">
            <span className="muted">Couvertures récupérées</span>
            <b>{result.coversRecovered}</b>
          </div>
        </div>
        <p className="tiny muted">
          Rien n'a été perdu : notes, tags, dates et couvertures des exemplaires retirés ont été
          repris sur celui qui reste. La suppression est réversible en réimportant une sauvegarde.
        </p>
        <div className="sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => onDone(result)}>
            Fermer
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} title="Doublons">
      {groups.length === 0 ? (
        <div className="empty">
          <IconCheck />
          <h3>Aucun doublon</h3>
          <p>Chaque livre n'apparaît qu'une fois dans ta bibliothèque.</p>
          <button className="btn" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            <b>{groups.length} livre{groups.length > 1 ? 's' : ''}</b> {groups.length > 1 ? 'apparaissent' : 'apparaît'} en
            plusieurs exemplaires, soit <b>{toRemove} à retirer</b>.
          </p>

          <div className="banner banner-info">
            L'exemplaire conservé est celui qui porte le plus d'informations — et jamais un livre
            annoté au profit d'un livre vierge. Ce qui manque au survivant est repris sur les
            autres avant qu'ils ne partent : notes, tags, dates et couvertures sont préservés.
          </div>

          <div className="section-title">Aperçu</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {groups.slice(0, 8).map((g) => (
              <div className="dup-row" key={g.keep.id}>
                <BookCover bookId={g.keep.id} coverUrl={g.keep.coverUrl} title={g.keep.title} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{g.keep.title}</b>
                  <div className="muted small">{g.keep.authors.join(', ') || 'auteur inconnu'}</div>
                  <div className="tiny muted">
                    {g.remove.length + 1} exemplaires · {g.remove.length} retiré
                    {g.remove.length > 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {groups.length > 8 && (
            <p className="tiny muted">et {groups.length - 8} autre{groups.length - 8 > 1 ? 's' : ''}…</p>
          )}

          <p className="tiny muted">
            Pense à sauvegarder avant, si tu veux pouvoir revenir en arrière.
          </p>

          <div className="sheet-actions">
            <button className="btn btn-primary btn-block" onClick={run}>
              Fusionner et retirer {toRemove} livre{toRemove > 1 ? 's' : ''}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
