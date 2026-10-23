import { test, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useDocumentTitle } from '../src/lib/useDocumentTitle'

afterEach(() => { cleanup(); document.title = '' })

test('a page that knows its subject names it before the app', () => {
  renderHook(() => useDocumentTitle('Uncanny X-Men'))
  expect(document.title).toBe('Uncanny X-Men — Comix')
})

test('a page with nothing to add is the app alone', () => {
  renderHook(() => useDocumentTitle())
  expect(document.title).toBe('Comix')
})

// Every page that names itself from a query calls this with nothing on the first render.
// Showing the bare app name until the answer lands is the point: the alternative is a tab
// that reads "undefined" for as long as the request takes.
test('a subject still loading is the app alone, and names itself once it arrives', () => {
  const { rerender } = renderHook(
    ({ subject }: { subject: string | undefined }) => useDocumentTitle(subject),
    { initialProps: { subject: undefined as string | undefined } },
  )
  expect(document.title).toBe('Comix')

  rerender({ subject: 'Uncanny X-Men' })
  expect(document.title).toBe('Uncanny X-Men — Comix')
})

// `data?.edition.name` is null, not undefined, on a response that came back without one,
// and a blank name is what an untitled row holds. Neither is a subject.
test('a subject that is null or blank reads as nothing at all', () => {
  const { rerender } = renderHook(
    ({ subject }: { subject: string | null | undefined }) => useDocumentTitle(subject),
    { initialProps: { subject: null as string | null | undefined } },
  )
  expect(document.title).toBe('Comix')

  rerender({ subject: '   ' })
  expect(document.title).toBe('Comix')
})

// The reason every route calls this, including the ones with nothing to say: a page that
// stayed silent would wear the title of the page you came from.
test('the page you move to owns the title', () => {
  const first = renderHook(() => useDocumentTitle('Uncanny X-Men'))
  expect(document.title).toBe('Uncanny X-Men — Comix')

  first.unmount()
  renderHook(() => useDocumentTitle('Settings'))
  expect(document.title).toBe('Settings — Comix')
})
