/**
 * Derive the franchise a series belongs to by stripping edition markers from its name,
 * so "Amazing Spider-Man (2025)" and "Amazing Spider-Man by Nick Spencer Omnibus" share
 * a group. It is a heuristic over titles - stored on the series so a wrong guess can be
 * corrected by hand rather than being recomputed forever.
 */

const STRIP: RegExp[] = [
  /\s*[:,]?\s*(the\s+)?complete collection.*$/i,      // ": The Complete Collection"
  /\s+by\s+\S.*$/i,                                    // "by Nick Spencer Omnibus"
  /\s*\((?!\d{4}\)\s*$)[^)]*\)\s*$/,                   // "(New 52 TPB)"
  /\s*\(\d{4}\)\s*$/,                                  // "(2025)"
  /\s+vol\.?\s*\d+.*$/i,                               // "Vol. 2", "Vol 5"
  /\s+(omnibus|tpb)e?s?\s*$/i,                         // "Omnibus", "TPB"
]

export function deriveGroupName(name: string): string {
  const original = name.trim().replace(/\s+/g, ' ')
  let group = original

  for (const pattern of STRIP) {
    group = group.replace(pattern, '')
  }

  // Stripping everything away would collapse unrelated series into one empty group.
  return group.trim() || original || name
}
