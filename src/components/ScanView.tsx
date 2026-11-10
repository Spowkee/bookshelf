import { useCallback, useEffect, useRef, useState } from 'react'
import { createScanner, openCamera, stopCamera, type Scanner } from '../scan/scanner'
import { lookupByIsbn, type BookDraft } from '../api'
import { isValidIsbn, normalizeIsbn, toIsbn13 } from '../lib/isbn'

interface Props {
  active: boolean
  onFound: (draft: BookDraft) => void
}

type Phase = 'idle' | 'starting' | 'scanning' | 'looking-up' | 'error'

/** Rythme d'analyse. ~8 images/s : assez réactif, sans faire chauffer le téléphone. */
const SCAN_INTERVAL_MS = 120

export function ScanView({ active, onFound }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scannerRef = useRef<Scanner | null>(null)
  const loopRef = useRef<number | null>(null)
  const busyRef = useRef(false)

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<string>('')
  const [manual, setManual] = useState('')
  const [notFound, setNotFound] = useState<string | null>(null)

  const handleIsbn = useCallback(
    async (rawCode: string) => {
      const isbn13 = toIsbn13(rawCode)
      // Les codes-barres EAN-13 des livres commencent par 978 ou 979. Tout le
      // reste est un code produit quelconque : on l'ignore sans rien afficher.
      if (!isbn13) return

      busyRef.current = true
      setPhase('looking-up')
      setNotFound(null)
      try {
        const draft = await lookupByIsbn(isbn13)
        if (draft) {
          navigator.vibrate?.(60)
          onFound(draft)
        } else {
          setNotFound(isbn13)
        }
      } catch {
        setError('Impossible de joindre les serveurs. Vérifie ta connexion.')
      } finally {
        setPhase('scanning')
        // Fenetre morte apres un scan : sans ca, la meme etiquette est relue
        // en boucle tant que le livre reste devant l'objectif.
        setTimeout(() => {
          busyRef.current = false
        }, 1500)
      }
    },
    [onFound],
  )

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function start() {
      setPhase('starting')
      setError(null)
      try {
        const [stream, scanner] = await Promise.all([openCamera(), createScanner()])
        if (cancelled) {
          stopCamera(stream)
          return
        }
        streamRef.current = stream
        scannerRef.current = scanner
        setEngine(scanner.engine)

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        // playsInline est obligatoire sur iOS, sinon Safari bascule la video
        // en plein ecran natif et masque toute l'interface.
        video.setAttribute('playsinline', 'true')
        await video.play()
        setPhase('scanning')

        loopRef.current = window.setInterval(async () => {
          if (busyRef.current || !videoRef.current || !scannerRef.current) return
          try {
            const code = await scannerRef.current.detect(videoRef.current)
            if (code && !busyRef.current) await handleIsbn(code)
          } catch {
            /* frame illisible : on passe a la suivante */
          }
        }, SCAN_INTERVAL_MS)
      } catch (e) {
        if (cancelled) return
        setPhase('error')
        const msg = e instanceof Error ? e.message : String(e)
        setError(
          /denied|NotAllowed/i.test(msg)
            ? "Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, puis recharge la page."
            : msg,
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      if (loopRef.current) window.clearInterval(loopRef.current)
      loopRef.current = null
      scannerRef.current?.dispose()
      scannerRef.current = null
      stopCamera(streamRef.current)
      streamRef.current = null
      busyRef.current = false
      setPhase('idle')
    }
  }, [active, handleIsbn])

  async function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const isbn = normalizeIsbn(manual)
    if (!isValidIsbn(isbn)) {
      setError("Cet ISBN n'est pas valide (la clé de contrôle ne tombe pas juste).")
      return
    }
    setError(null)
    busyRef.current = false
    await handleIsbn(isbn)
    setManual('')
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}

      {notFound && (
        <div className="banner banner-info">
          ISBN {notFound} lu correctement, mais aucune des sources ne connaît ce livre. Tu peux le
          chercher par titre dans l'onglet Recherche.
        </div>
      )}

      <div className="scan-stage">
        <video ref={videoRef} muted playsInline />
        <div className="scan-frame">
          <div className="scan-laser" />
        </div>
        <div className="scan-hint">
          {phase === 'starting' && 'Ouverture de la caméra…'}
          {phase === 'scanning' && 'Vise le code-barres au dos du livre'}
          {phase === 'looking-up' && 'Recherche du livre…'}
          {phase === 'error' && 'Caméra indisponible'}
        </div>
      </div>

      {engine && (
        <p className="tiny muted center" style={{ marginTop: -6 }}>
          Décodage {engine === 'native' ? 'natif du navigateur' : 'ZXing (WebAssembly)'}
        </p>
      )}

      <div className="section-title">Ou saisis l'ISBN à la main</div>
      <form onSubmit={submitManual} className="row">
        <input
          className="input"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="978-2-07-036822-8"
          inputMode="numeric"
          autoComplete="off"
        />
        <button className="btn btn-primary" type="submit" disabled={!manual.trim()}>
          Chercher
        </button>
      </form>
      <p className="tiny muted">
        Utile pour les livres anciens sans code-barres, ou quand l'étiquette est abîmée.
      </p>
    </>
  )
}
