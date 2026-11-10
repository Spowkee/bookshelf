import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { BookDraft } from './api'
import {
  allBooks,
  findIncompleteBooks,
  isRefreshPromptSnoozed,
  snoozeRefreshPrompt,
  splitByFreshness,
} from './db/repo'
import type { Book } from './db/schema'
import { Library } from './components/Library'
import { ScanView } from './components/ScanView'
import { SearchView } from './components/SearchView'
import { Settings } from './components/Settings'
import { AddSheet } from './components/AddSheet'
import { BookDetail } from './components/BookDetail'
import { IconLibrary, IconScan, IconSearch, IconSettings } from './components/icons'

type Tab = 'library' | 'scan' | 'search' | 'settings'

const TABS: Array<{ id: Tab; label: string; title: string; Icon: () => ReactElement }> = [
  { id: 'library', label: 'Biblio', title: 'Ma bibliothèque', Icon: IconLibrary },
  { id: 'scan', label: 'Scanner', title: 'Scanner un livre', Icon: IconScan },
  { id: 'search', label: 'Chercher', title: 'Rechercher un livre', Icon: IconSearch },
  { id: 'settings', label: 'Réglages', title: 'Réglages', Icon: IconSettings },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('library')
  const [books, setBooks] = useState<Book[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<BookDraft | null>(null)
  const [selected, setSelected] = useState<Book | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [incomplete, setIncomplete] = useState(0)

  const refresh = useCallback(async () => {
    setBooks(await allBooks())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Au démarrage, repère les fiches incomplètes et le signale.
   *
   * Une bannière plutôt qu'une fenêtre modale : ouvrir l'app pour ajouter un
   * livre et tomber sur une question est le genre de friction qui fait
   * désinstaller. Elle attend qu'on la remarque, et se tait une semaine si on
   * l'écarte. Le délai laisse aussi le temps à la bibliothèque de s'afficher.
   */
  useEffect(() => {
    if (!loaded || books.length === 0) return
    let cancelled = false

    const timer = setTimeout(async () => {
      if (await isRefreshPromptSnoozed()) return
      const found = await findIncompleteBooks()
      const { pending } = splitByFreshness(found)
      if (!cancelled) setIncomplete(pending.length)
    }, 1200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [loaded, books.length])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="app">
      <header className="topbar">
        <h1>{current.title}</h1>
        <div className="spacer" />
        {tab === 'library' && books.length > 0 && (
          <button className="btn btn-primary" style={{ padding: '8px 14px' }} onClick={() => setTab('scan')}>
            + Livre
          </button>
        )}
      </header>

      <main className="main">
        {toast && <div className="banner banner-info">{toast}</div>}

        {incomplete > 0 && tab === 'library' && !toast && (
          <div className="banner banner-info prompt-banner">
            <div>
              <b>{incomplete} fiche{incomplete > 1 ? 's' : ''} incomplète{incomplete > 1 ? 's' : ''}.</b>{' '}
              Il manque une couverture, un résumé ou une pagination.
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-ghost tiny"
                onClick={() => {
                  setIncomplete(0)
                  void snoozeRefreshPrompt()
                }}
              >
                Plus tard
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-primary"
                style={{ padding: '7px 14px' }}
                onClick={() => {
                  setIncomplete(0)
                  setTab('settings')
                }}
              >
                Compléter
              </button>
            </div>
          </div>
        )}

        {tab === 'library' &&
          (loaded ? (
            <Library books={books} onOpen={setSelected} onGoScan={() => setTab('scan')} />
          ) : (
            <p className="center muted small">Chargement…</p>
          ))}

        {/* Le composant n'est monte que sur son onglet : la camera doit se
            couper des qu'on le quitte, sinon la LED reste allumee. */}
        {tab === 'scan' && <ScanView active onFound={setDraft} />}

        {tab === 'search' && <SearchView onPick={setDraft} />}

        {tab === 'settings' && <Settings books={books} onChanged={refresh} />}
      </main>

      <nav className="tabbar" role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className="tab"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      {draft && (
        <AddSheet
          draft={draft}
          onClose={() => setDraft(null)}
          onAdded={(book) => {
            setDraft(null)
            setToast(`« ${book.title} » ajouté.`)
            void refresh()
          }}
        />
      )}

      {selected && (
        <BookDetail
          book={selected}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onOpenBook={setSelected}
        />
      )}
    </div>
  )
}
