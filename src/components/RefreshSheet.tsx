import { useEffect, useRef, useState } from 'react'
import {
  findIncompleteBooks,
  refreshBooks,
  splitByFreshness,
  type IncompleteBook,
  type RefreshResult,
} from '../db/repo'
import { coverCandidates, lookupByIsbn, isGoogleThrottled, googleThrottleMinutesLeft } from '../api'
import { Sheet } from './Sheet'
import { IconCheck } from './icons'

interface Props {
  onClose: () => void
  onDone: (result: RefreshResult) => void
}

type Phase = 'scanning' | 'ready' | 'running' | 'done'

const GAP_LABELS: Array<[keyof IncompleteBook['gaps'], string]> = [
  ['cover', 'couverture'],
  ['description', 'résumé'],
  ['pageCount', 'pagination'],
  ['authors', 'auteur'],
  ['publisher', 'éditeur'],
]

/**
 * Complète les fiches incomplètes depuis les catalogues.
 *
 * Deux temps volontairement séparés : on montre d'abord ce qui manque et
 * combien de livres sont concernés, puis l'utilisateur décide. Lancer des
 * centaines de requêtes réseau sans prévenir sur une connexion mobile serait
 * impoli — et le traitement peut durer plusieurs minutes.
 */
export function RefreshSheet({ onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('scanning')
  const [targets, setTargets] = useState<IncompleteBook[]>([])
  const [cooling, setCooling] = useState<IncompleteBook[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, title: '' })
  const [result, setResult] = useState<RefreshResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void findIncompleteBooks().then((found) => {
      if (cancelled) return
      const { pending, cooling: recent } = splitByFreshness(found)
      setTargets(pending)
      setCooling(recent)
      setPhase('ready')
    })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [])

  // Compte par type de manque, pour expliquer ce qui va être cherché.
  const counts = GAP_LABELS.map(([key, label]) => ({
    label,
    n: targets.filter((t) => t.gaps[key]).length,
  })).filter((c) => c.n > 0)

  async function run() {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('running')
    setProgress({ done: 0, total: targets.length, title: '' })

    const res = await refreshBooks(targets, {
      lookup: (isbn) => lookupByIsbn(isbn, ctrl.signal),
      coverUrls: coverCandidates,
      isThrottled: isGoogleThrottled,
      signal: ctrl.signal,
      onProgress: (done, total, title) => setProgress({ done, total, title }),
    })

    setResult(res)
    setPhase('done')
  }

  if (phase === 'scanning') {
    return (
      <Sheet onClose={onClose} title="Compléter les fiches">
        <p className="center muted small" style={{ padding: '30px 0' }}>
          <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
          Analyse de la bibliothèque…
        </p>
      </Sheet>
    )
  }

  if (phase === 'running') {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <Sheet onClose={onClose} title="Complétion" locked>
        <div className="section-title">Complétion en cours</div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {progress.done} / {progress.total} livres traités
        </p>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="refresh-now">{progress.title}</p>
        <div style={{ height: 14 }} />
        <button className="btn btn-block" onClick={() => abortRef.current?.abort()}>
          Arrêter
        </button>
        <p className="tiny muted center">
          Ce qui a déjà été complété est conservé.
        </p>
      </Sheet>
    )
  }

  if (phase === 'done' && result) {
    return (
      <Sheet onClose={onClose} title="Terminé">
        <div className="empty">
          <IconCheck />
          <h3>Complétion terminée</h3>
        </div>
        <div className="card">
          <div className="stat-row">
            <span className="muted">Livres examinés</span>
            <b>{result.processed}</b>
          </div>
          <div className="stat-row">
            <span className="muted">Couvertures récupérées</span>
            <b>{result.coversAdded}</b>
          </div>
          <div className="stat-row">
            <span className="muted">Champs complétés</span>
            <b>{result.fieldsFilled}</b>
          </div>
          <div className="stat-row">
            <span className="muted">Rien trouvé de plus</span>
            <b>{result.untouched}</b>
          </div>
        </div>
        {result.stoppedByQuota ? (
          <div className="banner banner-info">
            <b>Arrêté : Google a atteint sa limite de requêtes.</b> Ce n'est pas une erreur, le
            quota est compté par connexion et se renouvelle tout seul. Il reste{' '}
            {result.remaining} livre{result.remaining > 1 ? 's' : ''} à traiter — relance dans{' '}
            {googleThrottleMinutesLeft()} minutes, ou demain. L'app reprendra exactement là où elle
            s'est arrêtée, sans refaire ce qui est déjà fait.
          </div>
        ) : (
          <p className="tiny muted">
            Les livres restés incomplets ne figurent simplement pas dans les catalogues — c'est
            fréquent pour l'édition ancienne ou confidentielle. Pour ceux-là, le plus sûr est de
            photographier la couverture depuis leur fiche.
          </p>
        )}
        <div style={{ height: 14 }} />
        <button className="btn btn-primary btn-block" onClick={() => onDone(result)}>
          Fermer
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} title="Compléter les fiches">
      {targets.length === 0 ? (
        <div className="empty">
          <IconCheck />
          <h3>Tout est déjà complet</h3>
          <p>Aucune fiche ne manque de couverture, de résumé ni de pagination.</p>
          <button className="btn" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            <b>{targets.length} livre{targets.length > 1 ? 's' : ''}</b> {targets.length > 1 ? 'ont' : 'a'} une
            fiche incomplète. Les catalogues seront réinterrogés via leur ISBN pour combler les trous.
          </p>

          <div className="section-title">Ce qui manque</div>
          <div className="card">
            {counts.map((c) => (
              <div className="stat-row" key={c.label}>
                <span className="muted">Sans {c.label}</span>
                <b>{c.n}</b>
              </div>
            ))}
          </div>

          <div className="banner banner-info" style={{ marginTop: 14 }}>
            Rien de ce que tu as saisi ne sera modifié : notes, tags, dates, statuts et titres
            corrigés à la main sont préservés. Seuls les champs vides sont remplis.
          </div>

          <p className="tiny muted">
            Compte environ une seconde par livre, soit ~{Math.ceil(targets.length / 90)} minute
            {Math.ceil(targets.length / 90) > 1 ? 's' : ''}. Les requêtes partent une par une, avec
            une pause entre chacune : c'est ce qui évite de se faire bloquer par les catalogues.
          </p>

          {cooling.length > 0 && (
            <p className="tiny muted">
              {cooling.length} autre{cooling.length > 1 ? 's' : ''} livre
              {cooling.length > 1 ? 's' : ''} {cooling.length > 1 ? 'ont' : 'a'} déjà été tenté
              {cooling.length > 1 ? 's' : ''} dans les dernières 24 h sans résultat. Ils seront
              repris automatiquement demain, inutile de redemander aux catalogues entre-temps.
            </p>
          )}

          {isGoogleThrottled() && (
            <div className="banner banner-info">
              Google a atteint sa limite de requêtes pour le moment ({googleThrottleMinutesLeft()}{' '}
              minutes restantes). La complétion fonctionnera quand même via Open Library et la BnF,
              mais les résumés seront moins souvent trouvés.
            </div>
          )}

          <div style={{ height: 8 }} />
          <button className="btn btn-primary btn-block" onClick={run}>
            Compléter {targets.length} fiche{targets.length > 1 ? 's' : ''}
          </button>
        </>
      )}
    </Sheet>
  )
}
