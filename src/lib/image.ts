/**
 * Réduction d'image avant stockage.
 *
 * Une photo prise au téléphone pèse 3 à 5 Mo. Stockée telle quelle, une
 * cinquantaine de couvertures photographiées suffiraient à dépasser le quota
 * du navigateur — et sur iOS, un stockage trop gourmand est le premier à être
 * purgé. On ramène donc à la taille d'une vraie couverture : 600 px de large
 * en JPEG, soit ~60 Ko, largement assez pour une vignette et une fiche.
 */
const MAX_WIDTH = 600
const QUALITY = 0.82

export async function downscaleImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)

  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas indisponible')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob) throw new Error("Conversion de l'image impossible")
    return blob
  } finally {
    // Sans ca, la memoire du bitmap source n'est liberee qu'au bon vouloir
    // du ramasse-miettes : repete sur plusieurs photos, l'onglet sature.
    bitmap.close()
  }
}
