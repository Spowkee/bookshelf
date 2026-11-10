import { useRef, useState } from 'react'

interface Props {
  /** Lettres réellement présentes dans la liste affichée. */
  available: Set<string>
  onPick: (letter: string) => void
}

/** L'alphabet complet, plus « # » pour les titres commençant par un chiffre. */
export const INDEX_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]

/**
 * Barre A–Z façon répertoire téléphonique.
 *
 * Deux gestes, parce qu'on ne s'en sert pas de la même façon selon qu'on sait
 * où l'on va : un appui simple saute à la lettre, un glissement du doigt le
 * long de la barre fait défiler en continu.
 *
 * Les lettres absentes restent affichées mais estompées et inertes : les
 * masquer ferait bouger la position des autres d'une recherche à l'autre, et
 * on ne retrouverait plus le « M » au même endroit.
 */
export function AlphabetIndex({ available, onPick }: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const lastSent = useRef<string | null>(null)
  const [active, setActive] = useState<string | null>(null)

  /** Déduit la lettre visée depuis la position verticale du doigt. */
  function letterAt(clientY: number): string | null {
    const bar = barRef.current
    if (!bar) return null
    const rect = bar.getBoundingClientRect()
    const ratio = (clientY - rect.top) / rect.height
    const index = Math.floor(ratio * INDEX_LETTERS.length)
    if (index < 0 || index >= INDEX_LETTERS.length) return null
    return INDEX_LETTERS[index]
  }

  function handle(clientY: number) {
    const letter = letterAt(clientY)
    if (!letter || !available.has(letter)) return
    setActive(letter)
    // Sans ce garde, un glissement lent relance le defilement a chaque pixel.
    if (letter !== lastSent.current) {
      lastSent.current = letter
      onPick(letter)
    }
  }

  function end() {
    lastSent.current = null
    setActive(null)
  }

  return (
    <>
      <div
        ref={barRef}
        className="alpha-bar"
        role="navigation"
        aria-label="Index alphabétique"
        onTouchStart={(e) => handle(e.touches[0].clientY)}
        onTouchMove={(e) => {
          // Empeche la page de defiler pendant qu'on scrube la barre.
          e.preventDefault()
          handle(e.touches[0].clientY)
        }}
        onTouchEnd={end}
        onTouchCancel={end}
      >
        {INDEX_LETTERS.map((letter) => {
          const present = available.has(letter)
          return (
            <button
              key={letter}
              className="alpha-letter"
              data-present={present}
              data-active={active === letter}
              disabled={!present}
              onClick={() => present && onPick(letter)}
              tabIndex={-1}
            >
              {letter}
            </button>
          )
        })}
      </div>

      {/* Pastille de la lettre en cours, comme dans les contacts iOS :
          le doigt masque la barre, il faut afficher la lettre ailleurs. */}
      {active && <div className="alpha-bubble">{active}</div>}
    </>
  )
}

/** Première lettre d'un texte, repliée sans accent. « # » si ce n'est pas une lettre. */
export function indexLetter(text: string): string {
  const first = text
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .charAt(0)
  return /[A-Z]/.test(first) ? first : '#'
}
