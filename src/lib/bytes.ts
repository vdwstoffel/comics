const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * A byte count as a person reads it: "40 GB", "1.2 TB", "512 B".
 *
 * Decimal units rather than binary, because that is what a drive is sold and reported in -
 * `df` says 916G for this disk, and a pane that called the same disk 853 GiB would look
 * like it was measuring something else.
 *
 * A decimal only below ten of a unit, where it is the difference between "4 GB" and
 * "4.9 GB" - nearly a gigabyte, and the whole answer to whether the next download fits.
 * Above that it is noise, and bytes never get one at all.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const decimals = unit > 0 && value < 10 ? 1 : 0
  return `${value.toFixed(decimals)} ${UNITS[unit]}`
}
