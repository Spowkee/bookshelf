import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBackClose } from '../lib/useBackClose'
import { IconChevronLeft } from './icons'

interface Props {
  onClose: () => void
  /** Titre affiché dans la barre de la feuille, à côté du bouton retour. */
  title?: string
  /** Empêche la fermeture (pendant un import en cours, par exemple). */
  locked?: boolean
  children: ReactNode
}

/** Distance de glissement au-delà de laquelle la feuille se referme. */
const DISMISS_THRESHOLD = 110

/**
 * Feuille modale glissant du bas.
 *
 * Trois façons d'en sortir, parce qu'aucune ne va de soi pour tout le monde :
 *  - le bouton retour en haut à gauche, toujours visible ;
 *  - le bouton retour d'Android, via `useBackClose` ;
 *  - le glissement vers le bas, geste attendu sur iOS.
 */
export function Sheet({ onClose, title, locked = false, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<number | null>(null)
  const [dragY, setDragY] = useState(0)

  useBackClose(() => {
    if (!locked) onClose()
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    document.addEventListener('keydown', onKey)
    // Fige le scroll de la page derriere la feuille.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, locked])

  function onTouchStart(e: React.TouchEvent) {
    if (locked) return
    // Le glissement ne demarre que si le contenu est deja en haut, sinon on
    // confisquerait le defilement interne de la fiche.
    if ((sheetRef.current?.scrollTop ?? 0) > 0) return
    dragStart.current = e.touches[0].clientY
  }

  function onTouchMove(e: React.TouchEvent) {
    if (dragStart.current === null) return
    const delta = e.touches[0].clientY - dragStart.current
    setDragY(delta > 0 ? delta : 0)
  }

  function onTouchEnd() {
    if (dragStart.current === null) return
    const shouldClose = dragY > DISMISS_THRESHOLD
    dragStart.current = null
    setDragY(0)
    if (shouldClose) onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={() => !locked && onClose()} role="presentation">
      <div
        ref={sheetRef}
        className="sheet"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sheet-grip" />

        {!locked && (
          <div className="sheet-head">
            <button className="sheet-back" onClick={onClose} aria-label="Retour">
              <IconChevronLeft />
              <span>Retour</span>
            </button>
            {title && <span className="sheet-title">{title}</span>}
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
