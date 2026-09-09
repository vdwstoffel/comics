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

// ---- zoom ----

/** jsdom gives every element a zero box; the zoom maths needs a real one. */
function sizeViewport(width = 1000, height = 800) {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
  })
}

const viewportOf = () => document.querySelector('.reader-viewport') as HTMLElement
const pageImg = () => screen.getByAltText('page 1') as HTMLImageElement

test('a page opens unzoomed', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')

  expect(pageImg().style.transform).toBe('')
})

test('the wheel zooms the page in', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')

  fireEvent.wheel(viewportOf(), { deltaY: -100, clientX: 500, clientY: 400 })

  expect(pageImg().style.transform).toMatch(/scale\((?!1\))/)
})

test('the wheel will not shrink a page below its fit', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')

  fireEvent.wheel(viewportOf(), { deltaY: 400, clientX: 500, clientY: 400 })

  expect(pageImg().style.transform).toBe('')
})

// The turn zones cover the left and right thirds; panning across one would otherwise
// flip the page out from under you.
test('the page-turn zones stand down while zoomed', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')
  expect(screen.getByLabelText('next')).toBeEnabled()

  fireEvent.wheel(viewportOf(), { deltaY: -100, clientX: 500, clientY: 400 })

  expect(screen.getByLabelText('next')).toBeDisabled()
  expect(screen.getByLabelText('previous')).toBeDisabled()
})

test('dragging pans a zoomed page', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')
  fireEvent.wheel(viewportOf(), { deltaY: -100, clientX: 500, clientY: 400 })
  const before = pageImg().style.transform

  fireEvent.pointerDown(viewportOf(), { pointerId: 1, clientX: 500, clientY: 400 })
  fireEvent.pointerMove(viewportOf(), { pointerId: 1, clientX: 460, clientY: 380 })
  fireEvent.pointerUp(viewportOf(), { pointerId: 1 })

  expect(pageImg().style.transform).not.toBe(before)
})

test('double-clicking a zoomed page puts it back to fit', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')
  fireEvent.wheel(viewportOf(), { deltaY: -100, clientX: 500, clientY: 400 })
  expect(pageImg().style.transform).not.toBe('')

  fireEvent.doubleClick(viewportOf())

  expect(pageImg().style.transform).toBe('')
})

// Landing on page 2 zoomed into a corner of page 1 is disorienting.
test('turning the page returns to fit', async () => {
  sizeViewport()
  renderReader()
  await screen.findByAltText('page 1')
  fireEvent.wheel(viewportOf(), { deltaY: -100, clientX: 500, clientY: 400 })
  expect(pageImg().style.transform).not.toBe('')

  fireEvent.keyDown(window, { key: 'ArrowRight' })

  await screen.findByAltText('page 2')
  expect(screen.getByAltText('page 2').style.transform).toBe('')
})
