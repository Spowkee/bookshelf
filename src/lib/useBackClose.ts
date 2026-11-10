import { useEffect } from 'react'

/**
 * Rend une couche modale « refermable par le retour arrière ».
 *
 * Le problème : une PWA installée n'a ni barre d'adresse ni bouton retour. Sur
 * Android, le bouton retour matériel **quitte l'application** au lieu de fermer
 * la fiche ouverte — réflexe universel, résultat désastreux. Sur iPhone en mode
 * plein écran, il n'y a tout simplement aucun geste de retour.
 *
 * La solution : empiler une entrée d'historique à l'ouverture. Le retour
 * arrière la dépile au lieu de sortir de l'app, et on referme la couche.
 *
 * Le nettoyage gère les deux façons de fermer :
 *  - par le retour arrière → l'entrée est déjà dépilée, on ne touche à rien ;
 *  - par le bouton ou le geste → on dépile nous-même, sinon l'historique se
 *    remplirait d'entrées fantômes et il faudrait appuyer trois fois sur
 *    « retour » pour sortir.
 */
export function useBackClose(onClose: () => void) {
  useEffect(() => {
    history.pushState({ bsLayer: true }, '')

    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      if ((history.state as { bsLayer?: boolean } | null)?.bsLayer) {
        history.back()
      }
    }
    // Monté une seule fois : la couche vit le temps de son montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
