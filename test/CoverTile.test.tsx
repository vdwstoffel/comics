import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import CoverTile from '../src/components/CoverTile'

afterEach(() => cleanup())

function renderTile(props: Parameters<typeof CoverTile>[0]) {
  return render(
    <MemoryRouter>
      <CoverTile {...props} />
    </MemoryRouter>
  )
}

test('CoverTile renders no read-state indicator when readState is undefined', () => {
  renderTile({ to: '/book/1', title: 'Book One' })
  expect(screen.queryByLabelText('Read')).toBeNull()
  expect(screen.queryByLabelText(/In progress/i)).toBeNull()
})

test('CoverTile renders no read-state indicator for unread', () => {
  renderTile({ to: '/book/1', title: 'Book One', readState: 'unread', percent: 0 })
  expect(screen.queryByLabelText('Read')).toBeNull()
  expect(screen.queryByLabelText(/In progress/i)).toBeNull()
})

test('CoverTile renders check badge for read state', () => {
  renderTile({ to: '/book/1', title: 'Book One', readState: 'read', percent: 100 })
  expect(screen.getByLabelText('Read')).toBeInTheDocument()
  expect(screen.queryByLabelText(/In progress/i)).toBeNull()
})

test('CoverTile renders progress bar for reading state', () => {
  renderTile({ to: '/book/1', title: 'Book One', readState: 'reading', percent: 50 })
  const bar = screen.getByLabelText('In progress: 50%')
  expect(bar).toBeInTheDocument()
  expect(bar).toHaveStyle({ width: '50%' })
  expect(screen.queryByLabelText('Read')).toBeNull()
})

// --- external tiles ---------------------------------------------------------

// An issue in an arc that the library does not have links out to Comic Vine, which is
// not a route this app can navigate to.
test('a tile given an href links out instead of routing', () => {
  renderTile({ href: 'https://comicvine.gamespot.com/x/4000-1/', title: 'Part Three' })
  const link = screen.getByRole('link', { name: /Part Three/ })
  expect(link).toHaveAttribute('href', 'https://comicvine.gamespot.com/x/4000-1/')
  expect(link).toHaveAttribute('target', '_blank')
})

test('a tile with no image shows an empty cover box rather than a broken one', () => {
  renderTile({ href: 'https://cv/x', title: 'Part Three' })
  expect(screen.queryByRole('img')).toBeNull()
})

test('a tile still routes internally when given `to`', () => {
  renderTile({ to: '/book/7', title: 'Part One', img: '/api/books/7/thumbnail' })
  expect(screen.getByRole('link', { name: /Part One/ })).toHaveAttribute('href', '/book/7')
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/books/7/thumbnail')
})

// The shelf opens a comic in the reader and tells it where to go when you close it. That
// instruction travels as router state, so an href cannot show it arrived - only following
// the link can.
test('carries router state through to where it leads', () => {
  function Landed() {
    const { state } = useLocation()
    return <span data-testid="landed">{JSON.stringify(state)}</span>
  }
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<CoverTile to="/read/7" title="Venom #1" state={{ back: 'run' }} />} />
        <Route path="/read/:id" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('link'))
  expect(screen.getByTestId('landed')).toHaveTextContent('{"back":"run"}')
})
