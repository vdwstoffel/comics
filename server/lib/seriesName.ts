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
  // An annual is a companion to a run rather than a run of its own, so it belongs on the
  // same shelf as the comic it is an annual of. Last, so the year has already gone:
  // "Amazing Spider-Man Annual (2026)" reaches here as "Amazing Spider-Man Annual".
  /\s+annuals?\s*$/i,                                  // "Annual", "Annuals"
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

/**
 * A leading article is not part of how a series is found or filed. Comic Vine names the
 * Amazing Spider-Man run with one and its annual without, and a reader looking for either
 * looks under A.
 */
export const LEADING_ARTICLE = /^(the|an|a)\s+/i

/**
 * What two spellings of one series agree on.
 *
 * For comparison only - never stored and never shown. The stored name keeps its article
 * and its case, because Comic Vine's name is the name.
 */
export function seriesMatchKey(name: string): string {
  return name.trim().replace(LEADING_ARTICLE, '').toLowerCase()
}
