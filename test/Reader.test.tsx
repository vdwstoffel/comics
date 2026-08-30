import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Reader from '../src/pages/Reader'
import { stubFullscreen } from './helpers/fullscreen'

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/books/5' && !opts) return { ok: true, json: async () => ({ book: { id: 5, pageCount: 3 }, progress: { lastPage: 0, completed: false } }) }
    return { ok: true, json: async () => ({ progress: { lastPage: 1, completed: false } }) }
  }) as unknown as typeof fetch
})

function renderReader() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/read/5']}>
        <Routes><Route path="/read/:id" element={<Reader />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

test('renders first page and advances, saving progress', async () => {
  renderReader()
  expect(await screen.findByText('1 / 3')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(await screen.findByText('2 / 3')).toBeInTheDocument()
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/progress', expect.objectContaining({ method: 'PUT' })))
})

test('scrubber renders with correct max and navigates on change', async () => {
  const { container } = renderReader()
  // Wait for the reader to be ready
  await screen.findAllByText('1 / 3')

  // Scope to this render to avoid conflicts with other rendered readers
  const { getByRole, findByText } = within(container)

  const slider = getByRole('slider', { name: 'Go to page' })
  expect(slider).toHaveAttribute('max', '2') // pageCount - 1 = 3 - 1 = 2

  // Simulate releasing the scrubber on page index 2 (page 3)
  fireEvent.change(slider, { target: { value: '2' } })

  expect(await findByText('3 / 3')).toBeInTheDocument()
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/books/5/progress', expect.objectContaining({ method: 'PUT' })))
})

test('enters fullscreen when the reader opens', async () => {
  const fs = stubFullscreen()
  renderReader()
  await screen.findByText('1 / 3')
  await waitFor(() => expect(fs.requestFullscreen).toHaveBeenCalled())
  fs.restore()
})

test('the fullscreen button leaves fullscreen once in it', async () => {
  const fs = stubFullscreen()
  const { container } = renderReader()
  await screen.findByText('1 / 3')

  const button = await within(container).findByRole('button', { name: 'Exit fullscreen' })
  fireEvent.click(button)

  await waitFor(() => expect(fs.exitFullscreen).toHaveBeenCalled())
  expect(await within(container).findByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument()
  fs.restore()
})

test('f toggles fullscreen', async () => {
  const fs = stubFullscreen()
  const { container } = renderReader()
  await screen.findByText('1 / 3')

  fireEvent.keyDown(window, { key: 'f' })
  await waitFor(() => expect(fs.exitFullscreen).toHaveBeenCalled())

  fs.requestFullscreen.mockClear()
  fireEvent.keyDown(window, { key: 'f' })
  await waitFor(() => expect(fs.requestFullscreen).toHaveBeenCalled())
  expect(await within(container).findByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  fs.restore()
})

test('the button follows the browser leaving fullscreen on Escape', async () => {
  const fs = stubFullscreen()
  const { container } = renderReader()
  await screen.findByText('1 / 3')
  await within(container).findByRole('button', { name: 'Exit fullscreen' })

  fs.escape()

  expect(await within(container).findByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument()
  fs.restore()
})

test('leaves fullscreen when the reader closes', async () => {
  const fs = stubFullscreen()
  const { unmount } = renderReader()
  await screen.findByText('1 / 3')
  fs.exitFullscreen.mockClear()

  unmount()

  await waitFor(() => expect(fs.exitFullscreen).toHaveBeenCalled())
  fs.restore()
})

test('still reads normally when the browser refuses fullscreen', async () => {
  const fs = stubFullscreen({ refuse: true })
  const { container } = renderReader()

  expect(await screen.findByText('1 / 3')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(await screen.findByText('2 / 3')).toBeInTheDocument()
  expect(await within(container).findByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument()
  fs.restore()
})
