export function stripHtml(s) {
  if (!s) return undefined
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined
}
