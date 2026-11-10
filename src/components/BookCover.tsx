import { useEffect, useState, type ReactNode } from 'react'
import { getCoverBlob } from '../db/repo'

interface Props {
  bookId?: string
  coverUrl?: string
  title: string
  className?: string
  /** Pastille de statut ou tout autre repère superposé à la couverture. */
  children?: ReactNode
}

/**
 * Affiche la couverture selon trois niveaux de repli :
 *   1. le blob stocké en local  → marche hors-ligne, c'est le cas normal,
 *   2. l'URL distante           → pour les résultats de recherche pas encore ajoutés,
 *   3. une vignette typographique → si le livre n'a aucune couverture connue.
 */
export function BookCover({ bookId, coverUrl, title, className, children }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [remoteFailed, setRemoteFailed] = useState(false)

  useEffect(() => {
    if (!bookId) return
    let revoked = false
    let url: string | null = null

    getCoverBlob(bookId).then((blob) => {
      if (!blob || revoked) return
      url = URL.createObjectURL(blob)
      setBlobUrl(url)
    })

    return () => {
      revoked = true
      // Sans ce revoke, chaque defilement de la grille fuit quelques Mo.
      if (url) URL.revokeObjectURL(url)
      setBlobUrl(null)
    }
  }, [bookId])

  const src = blobUrl ?? (remoteFailed ? null : coverUrl)

  return (
    <div className={`cover ${className ?? ''}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setRemoteFailed(true)} />
      ) : (
        <div className="cover-fallback">
          <span>{title}</span>
        </div>
      )}
      {children}
    </div>
  )
}
