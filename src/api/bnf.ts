import type { BookDraft } from './types'
import { isbn13to10, toIsbn13 } from '../lib/isbn'
import { coverUrlFromIsbn } from './openlibrary'
import { fetchWithTimeout } from '../lib/timeout'

/**
 * Catalogue général de la BnF — protocole SRU, notices UNIMARC/XML.
 *
 * C'est la source de référence pour l'édition française, en particulier les
 * livres anciens ou peu diffusés que ni Open Library ni Google ne connaissent.
 * Elle sert de troisième recours quand les deux autres ne trouvent rien.
 *
 * Deux pièges vérifiés sur le service réel :
 *  1. l'index `bib.isbn` contient les ISBN-10, pas les ISBN-13. Chercher
 *     "9782070360024" renvoie 0 résultat là où "2070360024" renvoie la notice.
 *     On interroge donc l'ISBN-10 en premier quand la conversion est possible.
 *  2. les notices ne portent pas d'image : on retombe sur la couverture Open
 *     Library, indexée par ISBN et souvent présente malgré tout.
 */
export const BNF_ENABLED = true

const SRU = 'https://catalogue.bnf.fr/api/SRU'

function sruUrl(query: string, max = 1): string {
  const params = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    query,
    recordSchema: 'unimarcxchange',
    maximumRecords: String(max),
  })
  return `${SRU}?${params}`
}

/**
 * Les balises portent des préfixes (`mxc:datafield`, `srw:numberOfRecords`) et
 * le document déclare cinq espaces de noms. `getElementsByTagNameNS('*', nom)`
 * ignore le préfixe et l'URI : la BnF peut les changer sans rien casser ici.
 * Ne jamais utiliser `getElementsByTagName('mxc:datafield')`, qui dépend du
 * préfixe littéral.
 */
const NS_ANY = '*'

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(NS_ANY, name))
}

function datafields(doc: Document): Map<string, Element[]> {
  const byTag = new Map<string, Element[]>()
  for (const el of byLocalName(doc, 'datafield')) {
    const tag = el.getAttribute('tag')
    if (!tag) continue
    const list = byTag.get(tag)
    if (list) list.push(el)
    else byTag.set(tag, [el])
  }
  return byTag
}

function sub(field: Element | undefined, code: string): string | undefined {
  if (!field) return undefined
  for (const el of byLocalName(field, 'subfield')) {
    if (el.getAttribute('code') === code) {
      const text = el.textContent?.trim()
      if (text) return text
    }
  }
  return undefined
}

/** UNIMARC 700/701/702 : $a = nom de famille, $b = prénom. */
function personName(field: Element): string | undefined {
  const surname = sub(field, 'a')
  const forename = sub(field, 'b')
  if (!surname) return undefined
  return forename ? `${forename} ${surname}` : surname
}

function parseRecord(doc: Document, fallbackIsbn13?: string): BookDraft | null {
  const f = datafields(doc)
  const title = sub(f.get('200')?.[0], 'a')
  if (!title) return null

  const authors = [...(f.get('700') ?? []), ...(f.get('701') ?? []), ...(f.get('702') ?? [])]
    .map(personName)
    .filter((n): n is string => !!n)

  // 215$a ressemble a "1 volume 191 p" : on isole le nombre suivi de "p".
  const extent = sub(f.get('215')?.[0], 'a')
  const pageMatch = extent?.match(/(\d+)\s*p/)

  const dateText = sub(f.get('210')?.[0], 'd') ?? sub(f.get('214')?.[0], 'd')
  const yearMatch = dateText?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)

  const rawIsbn = sub(f.get('010')?.[0], 'a')
  const isbn13 = (rawIsbn ? toIsbn13(rawIsbn) : null) ?? fallbackIsbn13

  const subjects = (f.get('606') ?? []).map((el) => sub(el, 'a')).filter((s): s is string => !!s)

  // 200$f est la mention de responsabilite brute ("Albert Camus"), utilisee
  // seulement si les champs auteurs structures sont absents de la notice.
  const statement = sub(f.get('200')?.[0], 'f')

  return {
    isbn13,
    title,
    subtitle: sub(f.get('200')?.[0], 'e'),
    authors: authors.length > 0 ? authors : statement ? [statement] : [],
    publisher: sub(f.get('210')?.[0], 'c') ?? sub(f.get('214')?.[0], 'c'),
    publishedYear: yearMatch ? Number(yearMatch[1]) : undefined,
    pageCount: pageMatch ? Number(pageMatch[1]) : undefined,
    language: sub(f.get('101')?.[0], 'a'),
    description: sub(f.get('330')?.[0], 'a'),
    subjects: subjects.slice(0, 12),
    coverUrl: isbn13 ? coverUrlFromIsbn(isbn13) : undefined,
    source: 'bnf',
    sourceId: rawIsbn,
  }
}

async function runSru(
  query: string,
  fallbackIsbn13: string | undefined,
  signal?: AbortSignal,
): Promise<BookDraft | null> {
  const res = await fetchWithTimeout(sruUrl(query), { signal })
  if (!res.ok) throw new Error(`BnF: HTTP ${res.status}`)
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')

  // SRU repond 200 meme sur une requete invalide : seul le compteur fait foi.
  const countEl = byLocalName(doc, 'numberOfRecords')[0]
  if (!countEl || Number(countEl.textContent ?? '0') === 0) return null

  return parseRecord(doc, fallbackIsbn13)
}

export async function lookupIsbn(rawIsbn: string, signal?: AbortSignal): Promise<BookDraft | null> {
  if (!BNF_ENABLED) return null

  const isbn13 = toIsbn13(rawIsbn) ?? undefined
  const isbn10 = isbn13 ? isbn13to10(isbn13) : null

  // L'ISBN-10 d'abord : c'est la forme indexee pour tout le fonds ancien.
  const attempts = [isbn10, isbn13].filter((v): v is string => !!v)
  for (const candidate of attempts) {
    const found = await runSru(`bib.isbn all "${candidate}"`, isbn13, signal)
    if (found) return found
  }
  return null
}
