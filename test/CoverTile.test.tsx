import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
