/**
 * Détection de la série et du numéro de tome depuis le titre.
 *
 * Aucun des trois catalogues n'expose ces informations de façon exploitable :
 * Open Library a un champ `series` rempli au petit bonheur, Google ne l'expose
 * pas dans l'API publique, la BnF les noie dans la zone de collection. En
 * revanche, les éditeurs les mettent presque toujours dans le titre — c'est
 * donc là qu'on va les chercher.
 *
 * Le résultat est modifiable à la main dans la fiche du livre : l'heuristique
 * sert à éviter la saisie, pas à décider à la place de l'utilisateur.
 */

export interface SeriesInfo {
  series: string
  index?: number
}

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
}

function toNumber(raw: string): number | undefined {
  const cleaned = raw.trim().toLowerCase()
  const arabic = Number(cleaned)
  if (Number.isFinite(arabic) && arabic > 0) return arabic
  return ROMAN[cleaned]
}

/**
 * Motifs reconnus, du plus explicite au plus risqué. Chacun capture le nom de
 * la série (groupe 1) et le numéro (groupe 2) quand il existe.
 *
 * Volontairement absent : « Titre, 3 ». Un nombre nu après une virgule est
 * bien plus souvent une date, un lieu ou une partie du titre qu'un tome.
 */
const PATTERNS: RegExp[] = [
  // « Harry Potter, tome 3 » / « Harry Potter - Tome 3 » / « Harry Potter (tome 3) »
  /^(.+?)\s*[,\-–—(]\s*tomes?\s*\.?\s*([0-9]{1,2}|[ivx]{1,5})\b\)?/i,
  // « Le Trône de fer, T3 » / « ... T. 3 »
  /^(.+?)\s*[,\-–—(]\s*t\.?\s*([0-9]{1,2})\b\)?/i,
  // « Dune, volume 2 » / « ... vol. 2 »
  /^(.+?)\s*[,\-–—(]\s*vol(?:ume)?s?\s*\.?\s*([0-9]{1,2}|[ivx]{1,5})\b\)?/i,
  // « Fondation, livre 2 » — « livre » seulement suivi d'un nombre
  /^(.+?)\s*[,\-–—(]\s*livres?\s*\.?\s*([0-9]{1,2})\b\)?/i,
  // Anglais : « Dune, Book 2 »
  /^(.+?)\s*[,\-–—(]\s*book\s*\.?\s*([0-9]{1,2})\b\)?/i,
  // « Lanfeust de Troy #3 »
  /^(.+?)\s*#\s*([0-9]{1,2})\b/,
  // « Titre, Cycle 2 »
  /^(.+?)\s*[,\-–—(]\s*cycles?\s*\.?\s*([0-9]{1,2})\b\)?/i,
]

/** Nettoie un nom de série : ponctuation de fin, espaces, parenthèse ouverte. */
function tidy(name: string): string {
  return name
    .replace(/[\s,\-–—:;(]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Extrait la série et le tome d'un titre.
 * Renvoie null si le titre ne ressemble pas à un tome de série.
 */
export function parseSeries(title: string): SeriesInfo | null {
  if (!title.trim()) return null

  for (const pattern of PATTERNS) {
    const m = title.match(pattern)
    if (!m) continue

    const series = tidy(m[1])
    // Un nom de serie d'un seul caractere est presque surement un faux positif.
    if (series.length < 2) continue

    return { series, index: m[2] ? toNumber(m[2]) : undefined }
  }

  return null
}

/**
 * Libellé court pour l'affichage : « Harry Potter · tome 3 ».
 */
export function seriesLabel(series: string, index?: number): string {
  return index ? `${series} · tome ${index}` : series
}

/**
 * Clé de regroupement, insensible à la casse et aux accents, pour que
 * « Le trône de fer » et « Le Trône de Fer » tombent dans la même série.
 */
export function seriesKey(series: string): string {
  return series
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}
