/**
 * Signal d'abandon combinant un délai d'expiration et un signal externe.
 *
 * `fetch` sans signal attend indéfiniment. Un serveur qui accepte la connexion
 * puis ne répond jamais — cas courant quand un catalogue limite le débit au
 * lieu de renvoyer une erreur — bloque alors la boucle pour toujours : l'import
 * semble « tourner dans le vide », sans message ni progression.
 *
 * `AbortSignal.any` ferait l'affaire mais n'est arrivé que tardivement dans
 * Safari ; on compose à la main pour ne pas exclure d'iPhone encore en service.
 */
export const DEFAULT_TIMEOUT_MS = 9000

export interface TimedSignal {
  signal: AbortSignal
  /** À appeler quand la requête est terminée, pour libérer le minuteur. */
  done: () => void
  /** Vrai si l'abandon vient du délai et non de l'utilisateur. */
  timedOut: () => boolean
}

export function withTimeout(external?: AbortSignal, ms = DEFAULT_TIMEOUT_MS): TimedSignal {
  const controller = new AbortController()
  let expired = false

  const timer = setTimeout(() => {
    expired = true
    controller.abort(new DOMException('Délai dépassé', 'TimeoutError'))
  }, ms)

  const relay = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) relay()
    else external.addEventListener('abort', relay, { once: true })
  }

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', relay)
    },
    timedOut: () => expired,
  }
}

/** Enveloppe un `fetch` avec expiration. Lève une erreur explicite au délai. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const t = withTimeout(init.signal ?? undefined, ms)
  try {
    return await fetch(url, { ...init, signal: t.signal })
  } catch (e) {
    if (t.timedOut()) throw new Error(`Pas de réponse après ${Math.round(ms / 1000)} s`)
    throw e
  } finally {
    t.done()
  }
}
