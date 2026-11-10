/**
 * Génère les icônes PNG de la PWA sans aucune dépendance.
 *
 * Pourquoi pas un simple SVG : iOS ignore le manifest pour l'icône d'écran
 * d'accueil et n'accepte que du PNG via <link rel="apple-touch-icon">. Il faut
 * donc du raster, et plutôt que d'ajouter sharp/canvas au projet pour trois
 * rectangles, on écrit le PNG à la main (zlib est dans Node).
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// --- encodage PNG ------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 6 // RGBA
  // Chaque scanline est préfixée de son octet de filtre (0 = aucun).
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- dessin ------------------------------------------------------------------

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]

function canvas(size, bg) {
  const buf = Buffer.alloc(size * size * 4)
  const [r, g, b] = hex(bg)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = 255
  }
  return buf
}

/** Rectangle plein, avec fusion alpha et coins arrondis optionnels. */
function rect(buf, size, x0, y0, w, h, color, alpha = 1, radius = 0) {
  const [r, g, b] = hex(color)
  const x1 = x0 + w
  const y1 = y0 + h
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) {
      if (radius > 0) {
        // Teste la distance au centre de l'arc dans chaque coin.
        const cx = x < x0 + radius ? x0 + radius : x > x1 - radius ? x1 - radius : x
        const cy = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y
        if (Math.hypot(x - cx, y - cy) > radius) continue
      }
      const i = (y * size + x) * 4
      buf[i] = Math.round(buf[i] * (1 - alpha) + r * alpha)
      buf[i + 1] = Math.round(buf[i + 1] * (1 - alpha) + g * alpha)
      buf[i + 2] = Math.round(buf[i + 2] * (1 - alpha) + b * alpha)
    }
  }
}

/**
 * Trois tranches de livres alignées sur une étagère. Le motif tient dans les
 * 60 % centraux : c'est la zone sûre d'une icône maskable, que les lanceurs
 * Android peuvent rogner en cercle ou en goutte sans amputer le dessin.
 */
function drawIcon(size) {
  const buf = canvas(size, '#9c5a3c')
  const u = size / 100
  const cream = '#faf7f2'

  const shelfY = 70 * u
  const books = [
    { x: 27, w: 11, h: 34, alpha: 1 },
    { x: 40, w: 9, h: 42, alpha: 0.82 },
    { x: 51, w: 12, h: 29, alpha: 0.92 },
    { x: 65, w: 8, h: 38, alpha: 0.68 },
  ]

  for (const bk of books) {
    rect(buf, size, bk.x * u, shelfY - bk.h * u, bk.w * u, bk.h * u, cream, bk.alpha, 1.5 * u)
  }

  // L'étagère.
  rect(buf, size, 23 * u, shelfY + 2 * u, 54 * u, 4 * u, cream, 1, 2 * u)

  return encodePng(size, size, buf)
}

mkdirSync(OUT, { recursive: true })
for (const size of [180, 192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), drawIcon(size))
  console.log(`public/icon-${size}.png`)
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#9c5a3c"/>
  <g fill="#faf7f2">
    <rect x="27" y="36" width="11" height="34" rx="2"/>
    <rect x="40" y="28" width="9" height="42" rx="2" opacity=".82"/>
    <rect x="51" y="41" width="12" height="29" rx="2" opacity=".92"/>
    <rect x="65" y="32" width="8" height="38" rx="2" opacity=".68"/>
    <rect x="23" y="72" width="54" height="4" rx="2"/>
  </g>
</svg>
`
writeFileSync(join(OUT, 'favicon.svg'), favicon)
console.log('public/favicon.svg')
