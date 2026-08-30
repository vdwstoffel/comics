/**
 * Derive the series an edition belongs to by stripping edition markers from its name,
 * so "Amazing Spider-Man (2025)" and "Amazing Spider-Man by Nick Spencer Omnibus" share
 * a series. It is a heuristic over titles - stored on the edition so a wrong guess can
 * be corrected by hand rather than being recomputed forever.
 */

const STRIP: RegExp[] = [
  /\s*[:,]?\s*(the\s+)?complete collection.*$/i,      // ": The Complete Collection"
  /\s+by\s+\S.*$/i,                                    // "by Nick Spencer Omnibus"
  /\s*\((?!\d{4}\)\s*$)[^)]*\)\s*$/,                   // "(New 52 TPB)"
  /\s*\(\d{4}\)\s*$/,                                  // "(2025)"
  /\s+vol\.?\s*\d+.*$/i,                               // "Vol. 2", "Vol 5"
  /\s+(omnibus|tpb)e?s?\s*$/i,                         // "Omnibus", "TPB"
]

export function deriveSeriesName(name: string): string {
  const original = name.trim().replace(/\s+/g, ' ')
  let series = original

  for (const pattern of STRIP) {
    series = series.replace(pattern, '')
  }

  // Stripping everything away would collapse unrelated editions into one empty series.
  return series.trim() || original || name
}
