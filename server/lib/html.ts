export function stripHtml(s: string | null | undefined): string | undefined {
  if (!s) return undefined
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined
}
