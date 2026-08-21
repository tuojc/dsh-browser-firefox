/** Atomic composer draft helpers for rejected prompt restoration. */

export interface ComposerDraft<Image> {
  text: string
  images: Image[]
}

export function emptyComposerDraft<Image>(): ComposerDraft<Image> {
  return { text: '', images: [] }
}

/** Restore both submitted parts together, or preserve a newer draft unchanged. */
export function restoreSubmittedDraft<Image>(
  current: ComposerDraft<Image>,
  submitted: ComposerDraft<Image>,
): ComposerDraft<Image> {
  return current.text === '' && current.images.length === 0 ? submitted : current
}
