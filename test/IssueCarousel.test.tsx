import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import IssueCarousel from '../src/components/IssueCarousel'

const RUN = [
  { key: '1', label: '#1', coverUrl: '/api/books/11/thumbnail', readState: 'read' as const, readTo: '/read/11' },
  { key: '2', label: '#2', coverUrl: '/api/books/12/thumbnail', readState: 'unread' as const, readTo: '/read/12' },
  { key: '3', label: '#3' },
  { key: '4', label: '#4', coverUrl: '/api/books/14/thumbnail', readState: 'unread' as const, readTo: '/read/14' },
]

function draw(props: Partial<ComponentProps<typeof IssueCarousel>> = {}) {
  const onMove = vi.fn()
  const r = render(
    <MemoryRouter>
      <IssueCarousel entries={RUN} index={1} onMove={onMove} {...props} />
    </MemoryRouter>,
  )
  return { ...r, onMove }
}

test('the centred issue is the one the index names', () => {
  draw()
  expect(screen.getByTestId('carousel-current')).toHaveTextContent('#2')
})

// The peek is the whole reason for the side slots: it says there is more run that way.
test('the issues either side of the centre are drawn behind it', () => {
  draw()
  expect(screen.getByTestId('carousel-prev-peek')).toHaveTextContent('#1')
  expect(screen.getByTestId('carousel-next-peek')).toHaveTextContent('#3')
})

// A neighbour is scenery. A screen reader reading three issues at once would make the
// centred one impossible to find.
test('the neighbours are hidden from a screen reader', () => {
  draw()
  expect(screen.getByTestId('carousel-prev-peek')).toHaveAttribute('aria-hidden', 'true')
})

test('pressing next asks for the issue after this one', () => {
  const { onMove } = draw()
  fireEvent.click(screen.getByRole('button', { name: /next issue/i }))
  expect(onMove).toHaveBeenCalledWith(2)
})

test('pressing previous asks for the issue before this one', () => {
  const { onMove } = draw()
  fireEvent.click(screen.getByRole('button', { name: /previous issue/i }))
  expect(onMove).toHaveBeenCalledWith(0)
})

// You cannot walk off either end of a run.
test('previous is dead at the first issue and next at the last', () => {
  const { unmount } = draw({ index: 0 })
  expect(screen.getByRole('button', { name: /previous issue/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /next issue/i })).toBeEnabled()
  unmount()
  draw({ index: RUN.length - 1 })
  expect(screen.getByRole('button', { name: /next issue/i })).toBeDisabled()
})

// Reading a run is a left-and-right motion, so the keys that mean left and right do it.
test('the arrow keys walk the run', () => {
  const { onMove } = draw()
  fireEvent.keyDown(screen.getByTestId('carousel'), { key: 'ArrowRight' })
  expect(onMove).toHaveBeenCalledWith(2)
  fireEvent.keyDown(screen.getByTestId('carousel'), { key: 'ArrowLeft' })
  expect(onMove).toHaveBeenCalledWith(0)
})

// A cover is a spoiler for a comic you have not read, which is every comic you do not
// have. The gap gets its number and nothing else.
test('an issue you do not have shows no art', () => {
  draw({ index: 2 })
  const current = screen.getByTestId('carousel-current')
  expect(current).toHaveTextContent('#3')
  expect(current.querySelector('img')).toBeNull()
})

test('the centred cover opens the comic', () => {
  draw()
  expect(screen.getByRole('link', { name: /read #2/i })).toHaveAttribute('href', '/read/12')
})

// Portrait means touch, and a page turn is a horizontal drag.
test('a swipe left moves on to the next issue', () => {
  const { onMove } = draw()
  const strip = screen.getByTestId('carousel')
  fireEvent.pointerDown(strip, { clientX: 300, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(strip, { clientX: 200, clientY: 105, pointerId: 1 })
  expect(onMove).toHaveBeenCalledWith(2)
})

test('a swipe right goes back', () => {
  const { onMove } = draw()
  const strip = screen.getByTestId('carousel')
  fireEvent.pointerDown(strip, { clientX: 200, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(strip, { clientX: 300, clientY: 95, pointerId: 1 })
  expect(onMove).toHaveBeenCalledWith(0)
})

// Scrolling down the page to the info block must never be mistaken for a page turn.
test('a vertical drag is not a swipe', () => {
  const { onMove } = draw()
  const strip = screen.getByTestId('carousel')
  fireEvent.pointerDown(strip, { clientX: 300, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(strip, { clientX: 290, clientY: 400, pointerId: 1 })
  expect(onMove).not.toHaveBeenCalled()
})

// A tap on the cover is a tap, not a drag — otherwise opening a comic would be a lottery.
test('a short drag is not a swipe', () => {
  const { onMove } = draw()
  const strip = screen.getByTestId('carousel')
  fireEvent.pointerDown(strip, { clientX: 300, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(strip, { clientX: 288, clientY: 100, pointerId: 1 })
  expect(onMove).not.toHaveBeenCalled()
})

// Nothing to peek at past the end of the run.
test('the end of the run has no next neighbour', () => {
  draw({ index: RUN.length - 1 })
  expect(screen.queryByTestId('carousel-next-peek')).toBeNull()
})

// A gap's plate is a dashed blank carrying its number and nothing else, and it is the
// biggest empty space on the page. What to do about the gap goes there, rather than in
// the identity line below where it read as a footnote to a comic that is not there.
test('the centred gap carries what to do about it on its plate', () => {
  draw({ index: 2, action: <button type="button">↓ Get</button> })
  const plate = document.querySelector('.issue-carousel__current .issue-carousel__plate')
  expect(plate).not.toBeNull()
  expect(within(plate as HTMLElement).getByRole('button', { name: '↓ Get' })).toBeInTheDocument()
})

// The peeks are dimmed, aria-hidden and a page-turn away. Controls there would be a second
// set of buttons for a comic you are not looking at.
test('the peeking neighbours carry no controls', () => {
  draw({ index: 2, action: <button type="button">↓ Get</button> })
  expect(screen.getAllByRole('button', { name: '↓ Get' })).toHaveLength(1)
})
