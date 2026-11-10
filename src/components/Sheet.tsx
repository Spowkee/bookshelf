import { useEffect, type ReactNode } from 'react'

interface Props {
  onClose: () => void
  children: ReactNode
}

/** Feuille modale glissant du bas — le geste attendu sur mobile. */
export function Sheet({ onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Fige le scroll de la page derriere la feuille.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        {children}
      </div>
    </div>
  )
}
