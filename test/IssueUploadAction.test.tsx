import { test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import IssueUploadAction from '../src/components/IssueUploadAction'
import { FakeXhr, installFakeXhr } from './helpers/fakeXhr'

const base = { editionName: 'Venom (2025)', issueId: 1234, label: '#256' }

function draw(props: Partial<ComponentProps<typeof IssueUploadAction>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <IssueUploadAction {...base} {...props} />
    </QueryClientProvider>,
  )
  return qc
}

const comic = () => new File(['pretend comic'], 'Venom.256.2026.scene-tag.cbz')

/** Picking a file in the hidden input, which is what pressing Upload leads to. */
function pick(file = comic()) {
  fireEvent.change(screen.getByLabelText(/^Upload #256$/), { target: { files: [file] } })
}

beforeEach(() => { installFakeXhr() })
afterEach(() => { cleanup() })

test('it offers to upload, named for the comic it would fill', () => {
  draw()
  expect(screen.getByText(/^↑ Upload$/)).toBeInTheDocument()
  expect(screen.getByLabelText(/^Upload #256$/)).toHaveAttribute('type', 'file')
})

// Both formats the library takes. The server turns a .cbr into a .cbz on the way in.
test('it accepts the two archive formats the library stores', () => {
  draw()
  expect(screen.getByLabelText(/^Upload #256$/)).toHaveAttribute('accept', '.cbz,.cbr')
})

// The reason this button exists rather than sending you to the Upload page: the run and
// the issue are already known here, so nothing has to be typed and the metadata comes
// from Comic Vine's own id rather than from a guess at the file name.
test('the file carries the run and the issue it was pressed on', async () => {
  draw()
  pick()
  await waitFor(() => expect(FakeXhr.last).toBeDefined())
  const sent = FakeXhr.last!
  expect(sent.body!.get('edition')).toBe('Venom (2025)')
  expect(sent.body!.get('issueId')).toBe('1234')
  expect((sent.body!.get('file') as File).name).toBe('Venom.256.2026.scene-tag.cbz')
})

test('it says how far the file has got while it is going', async () => {
  draw()
  pick()
  await waitFor(() => expect(FakeXhr.last).toBeDefined())
  act(() => { FakeXhr.last!.progress(42, 100) })
  expect(await screen.findByText(/Uploading… 42%/)).toBeInTheDocument()
})

// The comic landed but carries only what its own file said. The whole point of uploading
// into a gap was the metadata, so a silent success here would be a lie.
test('a comic stored without its metadata says so', async () => {
  draw()
  pick()
  await waitFor(() => expect(FakeXhr.last).toBeDefined())
  act(() => { FakeXhr.last!.finish(200, JSON.stringify({ book: { id: 7 }, metadataApplied: false })) })
  expect(await screen.findByText(/metadata/i)).toBeInTheDocument()
})

test('a refused upload reports on the issue it was pressed on', async () => {
  draw()
  pick()
  await waitFor(() => expect(FakeXhr.last).toBeDefined())
  act(() => { FakeXhr.last!.finish(413, '{"error":"file too large"}') })
  expect(await screen.findByText(/Could not upload that one/i)).toBeInTheDocument()
})

// The gap has closed: the run now owns this issue, and every shelf that counted it as
// missing is wrong until it is asked again.
test('a stored comic refreshes the run that was missing it', async () => {
  const qc = draw()
  const stale: string[] = []
  qc.invalidateQueries = (async (filters?: { queryKey?: unknown[] }) => {
    stale.push(String(filters?.queryKey?.[0]))
  }) as typeof qc.invalidateQueries

  pick()
  await waitFor(() => expect(FakeXhr.last).toBeDefined())
  act(() => { FakeXhr.last!.finish(200, JSON.stringify({ book: { id: 7 }, metadataApplied: true })) })

  await waitFor(() => expect(stale).toContain('edition-issues'))
  expect(stale).toEqual(expect.arrayContaining(['editions', 'series', 'edition', 'edition-issues']))
})
