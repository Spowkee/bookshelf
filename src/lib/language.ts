/**
 * Normalisation des codes de langue.
 *
 * Les trois sources ne parlent pas le même dialecte :
 *  - Open Library et la BnF renvoient des codes MARC sur 3 lettres : `fre`, `eng`
 *  - Google Books renvoie de l'ISO 639-1 sur 2 lettres : `fr`, `en`
 *  - la BnF peut aussi renvoyer un chemin complet (`/languages/fre`)
 *
 * On ramène tout à l'ISO 639-1, et on affiche le nom en toutes lettres plutôt
 * qu'un code : « Français » est plus lisible que « fre » comme que « fr ».
 */

/** MARC/ISO 639-2 vers ISO 639-1, pour les langues réellement rencontrées. */
const MARC_TO_ISO: Record<string, string> = {
  fre: 'fr', fra: 'fr',
  eng: 'en',
  ger: 'de', deu: 'de',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  dut: 'nl', nld: 'nl',
  rus: 'ru',
  jpn: 'ja',
  chi: 'zh', zho: 'zh',
  ara: 'ar',
  pol: 'pl',
  swe: 'sv',
  dan: 'da',
  nor: 'no', nob: 'nb',
  fin: 'fi',
  gre: 'el', ell: 'el',
  heb: 'he',
  hun: 'hu',
  cze: 'cs', ces: 'cs',
  tur: 'tr',
  kor: 'ko',
  lat: 'la',
  cat: 'ca',
  ukr: 'uk',
  rum: 'ro', ron: 'ro',
  bul: 'bg',
  slo: 'sk', slk: 'sk',
  slv: 'sl',
  hrv: 'hr',
  srp: 'sr',
  vie: 'vi',
  tha: 'th',
  ind: 'id',
  per: 'fa', fas: 'fa',
  hin: 'hi',
  gle: 'ga',
  isl: 'is', ice: 'is',
  est: 'et',
  lav: 'lv',
  lit: 'lt',
  bre: 'br',
  oci: 'oc',
  baq: 'eu', eus: 'eu',
  glg: 'gl',
  epo: 'eo',
}

/**
 * Ramène un code de langue, quelle que soit sa forme, à l'ISO 639-1.
 * Renvoie undefined si la valeur est vide ou non reconnaissable.
 */
export function normalizeLanguage(raw: string | undefined): string | undefined {
  if (!raw) return undefined

  // La BnF peut renvoyer "/languages/fre" ; Google parfois "fr-FR".
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^.*\//, '')
    .split(/[-_]/)[0]

  if (!cleaned) return undefined
  if (cleaned.length === 2) return cleaned
  if (cleaned.length === 3) return MARC_TO_ISO[cleaned] ?? cleaned

  return undefined
}

/**
 * Nom de la langue en français : « fre » comme « fr » donnent « Français ».
 * Intl.DisplayNames est disponible partout depuis 2021 ; en cas d'absence ou
 * de code inconnu, on retombe sur le code en majuscules.
 */
export function languageLabel(raw: string | undefined): string | undefined {
  const code = normalizeLanguage(raw)
  if (!code) return undefined

  try {
    const name = new Intl.DisplayNames(['fr'], { type: 'language' }).of(code)
    if (name && name.toLowerCase() !== code) {
      return name.charAt(0).toUpperCase() + name.slice(1)
    }
  } catch {
    /* environnement sans Intl.DisplayNames */
  }
  return code.toUpperCase()
}
