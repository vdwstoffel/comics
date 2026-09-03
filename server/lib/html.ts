export function stripHtml(s: string | null | undefined): string | undefined {
  if (!s) return undefined
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined
}

/** One piece of a Comic Vine profile, ready to render without any HTML reaching the page. */
export type Block =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] }

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

/**
 * Tags come out before entities go in, so an escaped `&lt;here&gt;` survives as literal
 * text instead of being mistaken for markup and deleted.
 */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

// Dropped whole rather than unwrapped: their content is images and captions, which the
// portrait already covers and which would hotlink to Comic Vine on every expand.
const DISCARDED = /<(figure|noscript|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const BLOCK = /<(h[1-6]|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi

/**
 * Turn a Comic Vine profile into an outline of blocks.
 *
 * `stripHtml` cannot do this job: flattening the whole article welds each heading onto the
 * sentence after it ("…and Shapeshifter.OriginRoderick Kingsley was a famous…"). Keeping the
 * block boundaries is what makes 30KB of prose readable. Links are reduced to their text on
 * the way through — every href in a profile is relative, so rendering one inside the app
 * would point it at our own origin.
 */
export function toBlocks(s: string | null | undefined): Block[] {
  if (!s) return []

  const html = s.replace(DISCARDED, '')
  const blocks: Block[] = []

  const pushText = (raw: string, make: (text: string) => Block) => {
    const text = textOf(raw)
    if (text) blocks.push(make(text))
  }

  let cursor = 0
  for (const m of html.matchAll(BLOCK)) {
    // Anything sitting between two block tags is prose too; don't lose it.
    pushText(html.slice(cursor, m.index), (text) => ({ kind: 'para', text }))
    cursor = m.index + m[0].length

    const tag = m[1].toLowerCase()
    const inner = m[2]

    if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(LIST_ITEM)].map((li) => textOf(li[1])).filter(Boolean)
      if (items.length) blocks.push({ kind: 'list', items })
    } else if (tag === 'p') {
      pushText(inner, (text) => ({ kind: 'para', text }))
    } else {
      // h1 and h5/h6 are rare but real; clamp so the card only ever renders three depths.
      const level = Math.min(4, Math.max(2, Number(tag[1]))) as 2 | 3 | 4
      pushText(inner, (text) => ({ kind: 'heading', level, text }))
    }
  }
  pushText(html.slice(cursor), (text) => ({ kind: 'para', text }))

  return blocks
}
