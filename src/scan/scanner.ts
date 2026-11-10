/**
 * Deux moteurs de décodage :
 *  - `native` : l'API BarcodeDetector du navigateur (Chrome/Android). Le
 *     décodage se fait dans le code natif, quasi gratuit en CPU.
 *  - `wasm`   : ZXing compilé en WebAssembly, chargé à la demande. Safari
 *     n'implémente pas BarcodeDetector, c'est donc ce chemin sur iPhone.
 */
export type ScanEngine = 'native' | 'wasm'

export interface Scanner {
  engine: ScanEngine
  /** Analyse une frame. Renvoie le code brut, ou null si rien n'est lisible. */
  detect(video: HTMLVideoElement): Promise<string | null>
  dispose(): void
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<string[]>
}

const WANTED_NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

async function tryCreateNative(): Promise<Scanner | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (!Ctor) return null
  try {
    const supported = await Ctor.getSupportedFormats()
    const formats = WANTED_NATIVE_FORMATS.filter((f) => supported.includes(f))
    if (formats.length === 0) return null
    const detector = new Ctor({ formats })
    return {
      engine: 'native',
      async detect(video) {
        const results = await detector.detect(video)
        return results.length > 0 ? results[0].rawValue : null
      },
      dispose() {},
    }
  } catch {
    return null
  }
}

export async function createScanner(): Promise<Scanner> {
  const native = await tryCreateNative()
  if (native) return native
  const { createWasmScanner } = await import('./wasmScanner')
  return createWasmScanner()
}

/**
 * Ouvre la caméra arrière. `facingMode: environment` est une préférence, pas
 * une garantie : sur desktop on tombera sur la webcam, ce qui est le
 * comportement voulu pour tester.
 */
export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Ce navigateur ne donne pas accès à la caméra. Sur iPhone, l'app doit être ouverte dans Safari, et la page servie en https.",
    )
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  })
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}
