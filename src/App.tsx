import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { BookDraft } from './api'
import { allBooks } from './db/repo'
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

  const refresh = useCallback(async () => {
    setBooks(await allBooks())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
        />
      )}
    </div>
  )
}
