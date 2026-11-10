/**
 * Déduction d'un genre à partir des sujets fournis par les catalogues.
 *
 * Le problème : les sujets bruts sont inexploitables tels quels pour trier.
 * Open Library renvoie de l'anglais non normalisé et très fin (« Philosophical
 * Novels », « Murder », « Detective and mystery stories »), Google des
 * catégories en arborescence (« Fiction / Thrillers / Suspense »), la BnF des
 * vedettes-matière Rameau. Trois vocabulaires, aucun commun.
 *
 * On ramène tout à une quinzaine de genres parlants, par repérage de mots-clés
 * en français ET en anglais. C'est volontairement grossier : un genre juste à
 * 85 % qu'on peut corriger d'un geste vaut mieux qu'une taxonomie savante que
 * personne ne comprend.
 */

export const GENRES = [
  'Roman',
  'Policier',
  'Thriller',
  'Science-fiction',
  'Fantasy',
  'Horreur',
  'Romance',
  'Roman historique',
  'Bande dessinée',
  'Manga',
  'Jeunesse',
  'Poésie',
  'Théâtre',
  'Biographie',
  'Histoire',
  'Essai',
  'Philosophie',
  'Sciences',
  'Informatique',
  'Économie',
  'Politique',
  'Religion',
  'Art',
  'Cuisine',
  'Voyage',
  'Nature',
  'Sport',
  'Santé',
  'Développement personnel',
] as const

export type Genre = (typeof GENRES)[number]

const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Règles dans l'ordre de priorité : la première qui accroche gagne.
 *
 * L'ordre est la partie délicate. « Manga » avant « Bande dessinée », sinon
 * tous les mangas deviennent des BD. Les genres précis avant « Roman », sinon
 * « Fiction » absorbe les polars et la SF. Et « Roman » reste en dernier
 * recours, parce que c'est le cas le plus fréquent.
 */
const RULES: Array<[Genre, RegExp]> = [
  ['Manga', /\bmanga|manhwa|manhua/],
  ['Bande dessinée', /bande dessinee|\bbd\b|comic|graphic novel|bandes dessinees/],
  ['Jeunesse', /jeunesse|juvenile|children|album jeunesse|picture book|young adult|litterature d'enfance/],
  ['Policier', /policier|polar|detective|mystery|crime fiction|whodunit|enquete|roman noir|hard[- ]?boiled|investigation|serie noire/],
  ['Thriller', /thriller|suspense|espionnage|spy stories/],
  ['Horreur', /horreur|horror|epouvante|vampire|zombie|fantastique terrifiant/],
  ['Science-fiction', /science[- ]?fiction|sci[- ]?fi|\bsf\b|dystopi|space opera|anticipation|cyberpunk|post[- ]apocalyp|uchroni|time travel/],
  ['Fantasy', /fantasy|fantastique|heroic|magie|magic|sorcier|wizard|dragon|merveilleux|imaginaire|mythologi/],
  ['Romance', /romance|sentimental|love stories|romantique|chick lit/],
  ['Roman historique', /roman historique|historical fiction/],
  ['Poésie', /poesie|poetry|poems|vers\b/],
  ['Théâtre', /theatre|drama|plays|piece de theatre|tragedie|comedie de moeurs/],
  ['Biographie', /biograph|autobiograph|memoir|temoignage|correspondance|journal intime/],
  ['Histoire', /\bhistoire\b|history|historical|guerre mondiale|world war|antiquite|moyen age|civilisation/],
  ['Philosophie', /philosoph|ethique|ethics|metaphysi|epistemolog/],
  ['Informatique', /informatique|computer|programming|programmation|software|logiciel|intelligence artificielle|data science/],
  ['Sciences', /science|mathemat|physique|physics|biolog|chimie|chemistry|astronom|geolog|medecine clinique/],
  ['Économie', /economi|finance|gestion|management|entreprise|business|marketing|comptabilit/],
  ['Politique', /politique|political|geopoliti|democrat|etat\b|sociolog|societ/],
  ['Religion', /religio|spiritualit|bible|coran|theolog|bouddhis|christian|islam|judaisme/],
  ['Art', /\bart\b|arts\b|peinture|painting|sculpture|architecture|photograph|musique|music|cinema|design/],
  ['Cuisine', /cuisine|cooking|recett|recipe|gastronom|patisserie|vin\b|oenolog/],
  ['Voyage', /voyage|travel|guide touristique|recit de voyage|tourisme/],
  ['Nature', /nature|ecolog|environnement|jardin|garden|animaux|botaniq|faune|flore/],
  ['Sport', /sport|football|cyclisme|randonnee|yoga|fitness|montagne|alpinisme/],
  ['Santé', /sante|health|nutrition|bien-etre|psycholog|medecine douce|therapie/],
  ['Développement personnel', /developpement personnel|self-help|productivit|motivation|habitudes|confiance en soi/],
  ['Essai', /essai|essays|critique|pamphlet|reflexion/],
  ['Roman', /roman|fiction|novel|litterature|literature|nouvelles|short stories|contes/],
]

/**
 * Devine le genre d'un livre d'après ses sujets.
 * Renvoie undefined si rien ne correspond — mieux vaut pas de genre qu'un faux.
 */
export function deriveGenre(subjects: string[], title?: string): Genre | undefined {
  if (subjects.length === 0 && !title) return undefined

  // Les sujets sont concaténés : un livre étiqueté « Fiction » + « Detective »
  // doit sortir « Policier », et l'ordre des sujets ne doit rien changer.
  const haystack = fold([...subjects, title ?? ''].join(' | '))

  for (const [genre, pattern] of RULES) {
    if (pattern.test(haystack)) return genre
  }
  return undefined
}

/** Le genre fait-il partie de la liste connue ? */
export function isKnownGenre(value: string | undefined): value is Genre {
  return !!value && (GENRES as readonly string[]).includes(value)
}
