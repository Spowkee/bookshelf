/**
 * Lecture et écriture de CSV conformes à la RFC 4180.
 *
 * Écrit à la main plutôt qu'importé : un `split(',')` casse dès qu'un titre
 * contient une virgule — « Paris, je t'aime » — ou qu'un résumé contient un
 * saut de ligne, ce qui est la norme dans les exports de bibliothèques. Les
 * bibliothèques du marché font le travail, mais pour ~80 lignes autant éviter
 * une dépendance de plus dans un bundle qu'on veut léger.
 */

export type CsvRow = Record<string, string>

export interface ParsedCsv {
  headers: string[]
  rows: CsvRow[]
  delimiter: string
}

/**
 * Devine le séparateur en comparant le nombre de colonnes obtenu avec chacun.
 * Le bon séparateur est celui qui donne le plus de colonnes **de façon
 * régulière** : compter les occurrences brutes se ferait piéger par un texte
 * bourré de virgules dans un fichier à points-virgules.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64_000)
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestScore = -1

  for (const delim of candidates) {
    const rows = parseRows(sample, delim).slice(0, 20)
    if (rows.length < 2) continue

    const widths = rows.map((r) => r.length)
    const first = widths[0]
    if (first < 2) continue

    const consistent = widths.filter((w) => w === first).length / widths.length
    // On privilegie la regularite, puis le nombre de colonnes.
    const score = consistent * 100 + first
    if (score > bestScore) {
      bestScore = score
      best = delim
    }
  }
  return best
}

/** Découpe le texte en lignes de champs bruts, sans interpréter d'en-tête. */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Retire le BOM UTF-8 qu'Excel ajoute systematiquement.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // Guillemet echappe par doublement : "" -> "
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"') {
      inQuotes = true
      i++
      continue
    }

    // Enrobage Excel : ="valeur". Goodreads et d'autres exports l'emploient
    // pour empecher le tableur de convertir un ISBN en notation scientifique.
    // La RFC ne rend le guillemet special qu'en debut de champ, donc sans ce
    // cas particulier la virgule de ="Camus, Albert" serait prise pour un
    // separateur et decalerait toutes les colonnes suivantes.
    if (char === '=' && text[i + 1] === '"' && field === '') {
      inQuotes = true
      i += 2
      continue
    }

    if (char === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }

    if (char === '\r' || char === '\n') {
      // Avale le \r\n de Windows comme une seule fin de ligne.
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }

    field += char
    i++
  }

  // Derniere ligne sans saut final.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const delim = delimiter ?? detectDelimiter(text)
  const raw = parseRows(text, delim).filter((r) => r.some((c) => c.trim() !== ''))

  if (raw.length === 0) return { headers: [], rows: [], delimiter: delim }

  const headers = raw[0].map((h, idx) => h.trim() || `colonne_${idx + 1}`)
  const rows: CsvRow[] = []

  for (const line of raw.slice(1)) {
    const row: CsvRow = {}
    headers.forEach((h, idx) => {
      row[h] = (line[idx] ?? '').trim()
    })
    rows.push(row)
  }

  return { headers, rows, delimiter: delim }
}

/** Échappe un champ : guillemets seulement si nécessaire, doublés à l'intérieur. */
function escapeField(value: string, delimiter: string): string {
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function toCsv(headers: string[], rows: Array<Record<string, string>>, delimiter = ','): string {
  const lines = [headers.map((h) => escapeField(h, delimiter)).join(delimiter)]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeField(row[h] ?? '', delimiter)).join(delimiter))
  }
  // CRLF : exige par la RFC, et seul format qu'Excel ouvre sans broncher.
  return lines.join('\r\n')
}
