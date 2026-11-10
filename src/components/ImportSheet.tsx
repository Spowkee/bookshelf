import { useEffect, useMemo, useState } from 'react'
import { parseCsv, type CsvRow } from '../lib/csv'
import {
  applyMapping,
  autoMap,
  FIELD_LABELS,
  FIELD_ORDER,
  type FieldKey,
  type Mapping,
  type MappedRow,
} from '../lib/importMapping'
import { STATUS_LABELS, STATUS_ORDER, type ReadingStatus } from '../db/schema'
import { importForeignRows, type ForeignImportResult } from '../db/repo'
import { lookupByIsbn } from '../api'
import { Sheet } from './Sheet'

interface Props {
  file: File
  onClose: () => void
  onDone: (result: ForeignImportResult) => void
}

type Phase = 'mapping' | 'importing' | 'error'

/**
 * Aplatit un JSON en table : une fois converti en lignes/colonnes, il passe
 * par exactement la même correspondance qu'un CSV. Les listes imbriquées
 * (auteurs, tags) sont jointes par « ; », que le parseur sait redécouper.
 */
function flattenJson(text: string): { headers: string[]; rows: CsvRow[]; delimiter: string } {
  const data = JSON.parse(text)
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.books)
      ? data.books
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.library)
          ? data.library
          : []

  if (list.length === 0) throw new Error('Ce JSON ne contient pas de liste de livres reconnaissable.')

  const objects = list.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
  const headers = [...new Set(objects.flatMap((o) => Object.keys(o)))]

  const rows: CsvRow[] = objects.map((o) => {
    const row: CsvRow = {}
    for (const k of headers) {
      const v = o[k]
      row[k] =
        v == null ? '' : Array.isArray(v) ? v.map(String).join('; ') : typeof v === 'object' ? '' : String(v)
    }
    return row
  })

  return { headers, rows, delimiter: 'json' }
}

/**
 * Import d'une bibliothèque venue d'une autre application.
 *
 * Le principe : on ne code pas un lecteur par application — il y en a trop, et
 * celle que l'utilisateur possède n'est jamais celle qu'on a prévue. On lit
 * n'importe quel CSV ou JSON tabulaire, on devine les colonnes par leur
 * intitulé, et on montre le résultat avant d'écrire quoi que ce soit.
 */
export function ImportSheet({ file, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('mapping')
  const [error, setError] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<CsvRow[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [delimiter, setDelimiter] = useState('')
  const [defaultStatus, setDefaultStatus] = useState<ReadingStatus>('read')
  const [enrich, setEnrich] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    let cancelled = false

    file
      .text()
      .then((text) => {
        if (cancelled) return
        const trimmed = text.trim()
        const result = trimmed.startsWith('[') || trimmed.startsWith('{')
          ? flattenJson(trimmed)
          : { ...parseCsv(text) }

        if (result.rows.length === 0) throw new Error('Le fichier ne contient aucune ligne de données.')
        setHeaders(result.headers)
        setRows(result.rows)
        setMapping(autoMap(result.headers))
        setDelimiter(result.delimiter)
      })
      .catch((e) => {
        if (cancelled) return
        setPhase('error')
        setError(e instanceof Error ? e.message : 'Fichier illisible.')
      })

    return () => {
      cancelled = true
    }
  }, [file])

  const mapped = useMemo<MappedRow[]>(() => {
    if (!mapping.title && !mapping.isbn) return []
    return rows
      .map((r) => applyMapping(r, mapping, defaultStatus))
      .filter((r): r is MappedRow => r !== null)
  }, [rows, mapping, defaultStatus])

  const unusable = rows.length - mapped.length

  function setField(field: FieldKey, column: string) {
    setMapping((m) => ({ ...m, [field]: column || undefined }))
  }

  async function runImport() {
    setPhase('importing')
    setProgress({ done: 0, total: mapped.length })
    try {
      const result = await importForeignRows(mapped, {
        enrich: enrich ? (isbn) => lookupByIsbn(isbn) : undefined,
        fetchCovers: true,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      onDone(result)
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : "L'import a échoué.")
    }
  }

  if (phase === 'error') {
    return (
      <Sheet onClose={onClose} title="Importer une bibliothèque">
        <div className="banner banner-error">{error}</div>
        <button className="btn btn-block" onClick={onClose}>Fermer</button>
      </Sheet>
    )
  }

  if (phase === 'importing') {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <Sheet onClose={() => {}} title="Import" locked>
        <div className="section-title">Import en cours</div>
        <p className="small muted">
          {progress.done} / {progress.total} livres traités
          {enrich && ' — les fiches incomplètes sont complétées depuis les catalogues, ce qui prend quelques secondes par livre.'}
        </p>
        <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
        <p className="tiny muted center">Ne ferme pas l'application.</p>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} title="Importer une bibliothèque">
      <div className="section-title">Fichier détecté</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        <b>{file.name}</b> — {rows.length} ligne{rows.length > 1 ? 's' : ''}, {headers.length} colonne
        {headers.length > 1 ? 's' : ''}
        {delimiter && delimiter !== 'json' && (
          <> , séparées par <code>{delimiter === '\t' ? 'tabulation' : delimiter}</code></>
        )}
        {delimiter === 'json' && ' (JSON)'}
      </p>

      <div className="section-title">Correspondance des colonnes</div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Devinée d'après les intitulés. Corrige ce qui est faux — seul le titre ou l'ISBN est obligatoire.
      </p>

      <div className="stack" style={{ gap: 8 }}>
        {FIELD_ORDER.map((field) => (
          <div className="map-row" key={field}>
            <label htmlFor={`map-${field}`}>{FIELD_LABELS[field]}</label>
            <select
              id={`map-${field}`}
              className="input"
              value={mapping[field] ?? ''}
              onChange={(e) => setField(field, e.target.value)}
            >
              <option value="">— ignorer —</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="section-title">Statut par défaut</div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Appliqué aux livres dont le fichier n'indique pas l'état de lecture.
      </p>
      <div className="chips">
        {STATUS_ORDER.map((s) => (
          <button key={s} className="chip" aria-pressed={defaultStatus === s} onClick={() => setDefaultStatus(s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="section-title">Aperçu</div>
      {mapped.length === 0 ? (
        <div className="banner banner-error">
          Aucune ligne exploitable. Associe au moins la colonne « Titre » ou « ISBN ».
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {mapped.slice(0, 4).map((r, i) => (
              <div key={i} className="preview-row">
                <b>{r.title}</b>
                <span className="muted small">
                  {r.authors.join(', ') || 'auteur inconnu'}
                  {r.isbn13 && ` · ${r.isbn13}`}
                  {` · ${STATUS_LABELS[r.status]}`}
                  {r.rating ? ` · ${'★'.repeat(r.rating)}` : ''}
                  {r.finishedAt ? ` · lu le ${r.finishedAt}` : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="tiny muted">
            {mapped.length} livre{mapped.length > 1 ? 's' : ''} seront importés
            {unusable > 0 && `, ${unusable} ligne${unusable > 1 ? 's' : ''} ignorée${unusable > 1 ? 's' : ''} (ni titre ni ISBN)`}.
            Les livres déjà présents seront détectés et sautés.
          </p>
        </>
      )}

      <div className="section-title">Options</div>
      <label className="check-row">
        <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
        <span>
          Compléter les fiches depuis les catalogues
          <span className="tiny muted" style={{ display: 'block' }}>
            Récupère couvertures, résumés et pagination manquants via l'ISBN. Compte ~1 seconde par livre
            incomplet : pour 300 livres, prévois quelques minutes.
          </span>
        </span>
      </label>

      <div className="sheet-actions row">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={runImport} disabled={mapped.length === 0}>
          Importer {mapped.length > 0 ? `${mapped.length} livre${mapped.length > 1 ? 's' : ''}` : ''}
        </button>
      </div>
    </Sheet>
  )
}
