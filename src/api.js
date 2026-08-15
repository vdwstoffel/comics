async function json(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
export const api = {
  getSeries: () => json('/api/series'),
  getSeriesDetail: (id) => json(`/api/series/${id}`),
  getBook: (id) => json(`/api/books/${id}`),
  putProgress: (id, body) => json(`/api/books/${id}/progress`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  patchMetadata: (id, body) => json(`/api/books/${id}/metadata`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  embed: (id) => json(`/api/books/${id}/embed`, { method: 'POST' }),
  cvSearch: (q, type) => json(`/api/comicvine/search?q=${encodeURIComponent(q)}&type=${type}`),
  applyIssue: (id, issueId) => json(`/api/books/${id}/comicvine`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issueId }),
  }),
}
