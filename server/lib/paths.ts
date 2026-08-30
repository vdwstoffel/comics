/**
 * Sanitize an edition name into a safe folder name.
 * Replaces `/` and `\` runs with `_`, then replaces `..` runs with `_`, then trims.
 * Returns "Unsorted" if the result would be empty.
 *
 * This matches the inline logic previously in server/routes/upload.ts.
 */
export function sanitizeEditionFolder(name: string): string {
  const sanitized = (name || 'Unsorted')
    .replace(/[\\/]+/g, '_')
    .replace(/\.\.+/g, '_')
    .trim()
  return sanitized || 'Unsorted'
}
