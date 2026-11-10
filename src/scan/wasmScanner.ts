import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import type { Scanner } from './scanner'

/**
 * Moteur de secours pour les navigateurs sans BarcodeDetector — en pratique,
 * Safari, donc tout iPhone.
 *
 * Ce module est chargé dynamiquement : le binaire ZXing pèse ~940 Ko et
 * Android ne s'en sert jamais. Il n'est téléchargé qu'au premier scan sur un
 * appareil qui en a besoin, puis mis en cache définitivement par le service
 * worker. Pas de pénalité à l'installation.
 */

const SCAN_WIDTH = 640
const BAND_RATIO = 0.45

export function createWasmScanner(): Scanner {
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl } })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  return {
    engine: 'wasm',
    async detect(video) {
      if (!ctx || video.videoWidth === 0) return null

      // On ne décode que la bande centrale visée, réduite à 640 px de large.
      // Ça divise le travail par ~10 sans perte : un EAN-13 reste largement
      // lisible à cette résolution.
      const scale = SCAN_WIDTH / video.videoWidth
      const w = SCAN_WIDTH
      const h = Math.round(video.videoHeight * scale * BAND_RATIO)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      const srcBandHeight = video.videoHeight * BAND_RATIO
      const srcY = (video.videoHeight - srcBandHeight) / 2
      ctx.drawImage(video, 0, srcY, video.videoWidth, srcBandHeight, 0, 0, w, h)

      const results = await readBarcodes(ctx.getImageData(0, 0, w, h), {
        formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
        tryHarder: true,
        tryRotate: false, // le livre est tenu droit : economise du CPU
        maxNumberOfSymbols: 1,
      })

      const hit = results.find((r) => r.isValid && r.text)
      return hit ? hit.text : null
    },
    dispose() {
      canvas.width = 0
      canvas.height = 0
    },
  }
}
