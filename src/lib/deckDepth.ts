/**
 * How many cards to draw behind a volume's cover on the unread shelf.
 *
 * Thickness, not a number: the count is already printed under the tile, so what the deck
 * adds is something you can read across a whole shelf without stopping to read anything.
 * Three steps is as much as the eye separates at this size, and the tile reserves a fixed
 * gutter to draw them into — so the cap is a drawing constraint as much as a visual one.
 *
 * One unread comic gets no deck at all. A stack behind it would say "several" about a
 * tile that stands for exactly one.
 */
export function deckDepth(count: number): number {
  if (count >= 10) return 3
  if (count >= 5) return 2
  if (count >= 2) return 1
  return 0
}
