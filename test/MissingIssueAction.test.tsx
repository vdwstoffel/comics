import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import MissingIssueAction from '../src/components/MissingIssueAction'
import { FakeXhr, installFakeXhr } from './helpers/fakeXhr'

const base = {
  editionId: '9',
  editionName: 'Venom (2025)',
  issueId: 1234,
  label: '#256',
  seriesName: 'Venom',
}

function draw(props: Partial<ComponentProps<typeof MissingIssueAction>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><MissingIssueAction {...base} {...props} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  installFakeXhr()
  globalThis.fetch = vi.fn(async () => (
    { ok: true, json: async () => ({ active: [], queue: [], history: [] }) }
  )) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// The gap's two offers side by side: fetch the release the index found, or hand over the
// comic you already have.
test('a matched gap offers both ways to fill it', async () => {
  draw({ match: { indexId: 3, title: 'Venom 256 (2026)' }, offerUpload: true })
  expect(await screen.findByRole('button', { name: /Get #256/ })).toBeInTheDocument()
  expect(screen.getByLabelText(/^Upload #256$/)).toBeInTheDocument()
})

// Where Get has nothing to act on is exactly where having the file yourself matters most.
test('an unmatched gap still offers the upload', async () => {
  draw({ match: null, offerUpload: true })
  expect(await screen.findByRole('link', { name: /Find #256/ })).toBeInTheDocument()
  expect(screen.getByLabelText(/^Upload #256$/)).toBeInTheDocument()
})

// The run is the whole reason this is offered here rather than on the Upload page: the
// comic is filed into this edition and read as this issue, with nothing typed.
test('the upload is filed into the run it was pressed in', async () => {
  draw({ match: null, offerUpload: true })
  const input = await screen.findByLabelText(/^Upload #256$/)
  fireEvent.change(input, { target: { files: [new File(['x'], 'venom.cbz')] } })

  await waitFor(() => expect(FakeXhr.last).toBeDefined())
  expect(FakeXhr.last!.url).toBe('/api/upload')
  expect(FakeXhr.last!.body!.get('edition')).toBe('Venom (2025)')
  expect(FakeXhr.last!.body!.get('issueId')).toBe('1234')
})

// Off unless asked for. The run's sidebar lists every gap at once, and a file picker on
// each row is a column of controls for comics you are not looking at.
test('the upload is not offered unless the caller asks for it', async () => {
  draw({ match: { indexId: 3, title: 'Venom 256 (2026)' } })
  expect(await screen.findByRole('button', { name: /Get #256/ })).toBeInTheDocument()
  expect(screen.queryByLabelText(/^Upload #256$/)).toBeNull()
})
