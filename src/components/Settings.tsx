import { useEffect, useRef, useState } from 'react'
import { computeStats, coversSize, exportCsv, exportJson, importJson, type Stats } from '../db/repo'
import { STATUS_LABELS, STATUS_ORDER, type Book } from '../db/schema'
import { ImportSheet } from './ImportSheet'
import { RefreshSheet } from './RefreshSheet'

interface Props {
  books: Book[]
  onChanged: () => void
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export function Settings({ books, onChanged }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [covers, setCovers] = useState<{ count: number; bytes: number } | null>(null)
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [foreignFile, setForeignFile] = useState<File | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void computeStats(books).then(setStats)
    void coversSize().then(setCovers)
    // L'API Storage donne l'occupation reelle de l'origine, couvertures incluses.
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null && e.quota != null) setQuota({ usage: e.usage, quota: e.quota })
    })
  }, [books])

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const stamp = () => new Date().toISOString().slice(0, 10)

  async function doExportJson() {
    const payload = await exportJson()
    download(JSON.stringify(payload, null, 2), `bookshelf-${stamp()}.json`, 'application/json')
    setMessage({ kind: 'info', text: `${payload.books.length} livres exportés en JSON.` })
  }

  async function doExportCsv(delimiter: ';' | ',') {
    const csv = await exportCsv(delimiter)
    // Le BOM UTF-8 est indispensable : sans lui, Excel lit le fichier en
    // ANSI et transforme tous les accents en charabia.
    download('﻿' + csv, `bookshelf-${stamp()}.csv`, 'text/csv;charset=utf-8')
    setMessage({ kind: 'info', text: `${books.length} livres exportés en CSV.` })
  }

  /**
   * Un seul bouton d'import pour deux cas : nos propres exports repartent par
   * le chemin rapide (les identifiants sont conservés, donc l'opération est
   * idempotente), tout autre fichier passe par l'écran de correspondance.
   */
  async function doImport(file: File) {
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(await file.text())
        if (parsed?.format === 'bookshelf-export') {
          const result = await importJson(parsed)
          onChanged()
          setMessage({
            kind: 'info',
            text: `${result.added} ajoutés, ${result.updated} mis à jour, ${result.skipped} ignorés (déjà à jour).`,
          })
          return
        }
      }
      setForeignFile(file)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Import impossible.' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function requestPersist() {
    const granted = await navigator.storage?.persist?.()
    setMessage(
      granted
        ? { kind: 'info', text: 'Stockage marqué comme persistant par le navigateur.' }
        : { kind: 'error', text: "Le navigateur a refusé. Garde tes exports à jour — c'est la vraie sauvegarde." },
    )
  }

  return (
    <>
      {message && (
        <div className={`banner ${message.kind === 'error' ? 'banner-error' : 'banner-info'}`}>{message.text}</div>
      )}

      <div className="section-title">Mes lectures</div>
      {stats && (
        <>
          <div className="stat-tiles" style={{ marginBottom: 14 }}>
            <div className="stat-tile">
              <b>{stats.byStatus.read}</b>
              <span>livres lus</span>
            </div>
            <div className="stat-tile">
              <b>{stats.readThisYear}</b>
              <span>cette année</span>
            </div>
            <div className="stat-tile">
              <b>{stats.pagesRead.toLocaleString('fr-FR')}</b>
              <span>pages lues</span>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            {STATUS_ORDER.map((s) => (
              <div className="stat-row" key={s}>
                <span className="muted">{STATUS_LABELS[s]}</span>
                <b>{stats.byStatus[s]}</b>
              </div>
            ))}
          </div>

          {stats.topAuthors.length > 0 && (
            <>
              <div className="section-title">Auteurs les plus lus</div>
              <div className="card">
                {stats.topAuthors.map((a) => (
                  <div className="stat-row" key={a.name}>
                    <span className="muted">{a.name}</span>
                    <b>{a.count}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="section-title">Compléter les fiches</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Repasse sur les livres dont la couverture, le résumé ou la pagination manquent, et
        réinterroge les catalogues via leur ISBN. Open Library n'a pas d'image pour tous les
        livres : les sources sont essayées l'une après l'autre.
      </p>
      <button className="btn btn-block" onClick={() => setRefreshing(true)}>
        Chercher les fiches incomplètes
      </button>
      <p className="tiny muted">
        Rien de ce que tu as saisi n'est modifié — seuls les champs vides sont remplis.
      </p>

      <div className="section-title">Sauvegarde</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Tes livres ne vivent que sur cet appareil. Exporte régulièrement : c'est ta seule copie de
        secours, et c'est aussi ce qui te permettra de reprendre tes données ailleurs.
      </p>
      <div className="stack">
        <button className="btn btn-primary btn-block" onClick={doExportJson}>
          Exporter en JSON ({books.length} livres)
        </button>
        <div className="btn-pair">
          <button className="btn" onClick={() => doExportCsv(';')}>
            CSV (Excel FR)
          </button>
          <button className="btn" onClick={() => doExportCsv(',')}>
            CSV (standard)
          </button>
        </div>
        <button className="btn btn-block" onClick={() => fileRef.current?.click()}>
          Importer un fichier
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void doImport(f)
          }}
        />
      </div>
      <p className="tiny muted">
        Le JSON conserve tout et se réimporte sans créer de doublons. Le CSV s'ouvre dans un tableur :
        prends la version « Excel FR » (point-virgule) pour qu'Excel range les colonnes correctement,
        « standard » (virgule) pour alimenter une autre application.
      </p>

      <div className="section-title">Venir d'une autre application</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Le même bouton « Importer un fichier » accepte le CSV ou le JSON exporté par ClassBook,
        Goodreads, BookBuddy, Libib ou un simple tableur. Les colonnes sont devinées d'après leurs
        intitulés, et un écran te laisse corriger la correspondance avant d'écrire quoi que ce soit.
        Les fiches incomplètes peuvent être complétées automatiquement via leur ISBN.
      </p>

      <div className="section-title">Stockage</div>
      <div className="card">
        <div className="stat-row">
          <span className="muted">Livres</span>
          <b>{books.length}</b>
        </div>
        {covers && (
          <div className="stat-row">
            <span className="muted">Couvertures en cache</span>
            <b>{covers.count} · {human(covers.bytes)}</b>
          </div>
        )}
        {quota && (
          <div className="stat-row">
            <span className="muted">Occupé sur l'appareil</span>
            <b>{human(quota.usage)} / {human(quota.quota)}</b>
          </div>
        )}
      </div>
      <div style={{ height: 10 }} />
      <button className="btn btn-block" onClick={requestPersist}>
        Demander un stockage persistant
      </button>
      <p className="tiny muted">
        Demande au navigateur de ne pas purger les données sous pression de stockage. iOS refuse
        souvent — raison de plus pour exporter.
      </p>

      <div className="section-title">À propos</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Métadonnées fournies par Open Library (Internet Archive), Google Books et le catalogue
        général de la BnF. Aucune donnée personnelle ne quitte l'appareil : les seules requêtes
        réseau sont les recherches de livres.
      </p>

      {refreshing && (
        <RefreshSheet
          onClose={() => setRefreshing(false)}
          onDone={(result) => {
            setRefreshing(false)
            onChanged()
            setMessage({
              kind: 'info',
              text:
                `${result.coversAdded} couverture${result.coversAdded > 1 ? 's' : ''} récupérée${result.coversAdded > 1 ? 's' : ''}` +
                `, ${result.fieldsFilled} champ${result.fieldsFilled > 1 ? 's' : ''} complété${result.fieldsFilled > 1 ? 's' : ''}.`,
            })
          }}
        />
      )}

      {foreignFile && (
        <ImportSheet
          file={foreignFile}
          onClose={() => setForeignFile(null)}
          onDone={(result) => {
            setForeignFile(null)
            onChanged()
            setMessage({
              kind: 'info',
              text:
                `${result.added} livre${result.added > 1 ? 's' : ''} importé${result.added > 1 ? 's' : ''}` +
                (result.enriched > 0 ? `, ${result.enriched} complété${result.enriched > 1 ? 's' : ''} depuis les catalogues` : '') +
                (result.duplicates > 0 ? `, ${result.duplicates} déjà présent${result.duplicates > 1 ? 's' : ''}` : '') +
                '.',
            })
          }}
        />
      )}
    </>
  )
}
