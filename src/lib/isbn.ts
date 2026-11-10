/** Nettoie un ISBN : retire tirets, espaces, et met le X final en majuscule. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(isbn[i])
  sum += isbn[9] === 'X' ? 10 : Number(isbn[9])
  return sum % 11 === 0
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^[0-9]{13}$/.test(isbn)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10 === Number(isbn[12])
}

export function isValidIsbn(raw: string): boolean {
  const isbn = normalizeIsbn(raw)
  return isValidIsbn10(isbn) || isValidIsbn13(isbn)
}

/** Convertit un ISBN-10 en ISBN-13 (préfixe 978 + nouvelle clé de contrôle). */
export function isbn10to13(isbn10: string): string | null {
  const isbn = normalizeIsbn(isbn10)
  if (!isValidIsbn10(isbn)) return null
  const body = '978' + isbn.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3)
  return body + String((10 - (sum % 10)) % 10)
}

export function isbn13to10(isbn13: string): string | null {
  const isbn = normalizeIsbn(isbn13)
  if (!isValidIsbn13(isbn) || !isbn.startsWith('978')) return null
  const body = isbn.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(body[i])
  const check = (11 - (sum % 11)) % 11
  return body + (check === 10 ? 'X' : String(check))
}

/** Ramène n'importe quelle forme d'ISBN valide à son ISBN-13 canonique. */
export function toIsbn13(raw: string): string | null {
  const isbn = normalizeIsbn(raw)
  if (isValidIsbn13(isbn)) return isbn
  if (isValidIsbn10(isbn)) return isbn10to13(isbn)
  return null
}

/** Affichage lisible : 978-2-07-036822-8 */
export function formatIsbn(isbn13: string): string {
  if (isbn13.length !== 13) return isbn13
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 6)}-${isbn13.slice(6, 12)}-${isbn13.slice(12)}`
}
