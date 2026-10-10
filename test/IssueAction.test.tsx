import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import IssueAction from '../src/components/IssueAction'

const base = {
  label: 'Spider-Man: Long Way Home #3',
  findTo: '/search?q=Black+Cat',
  hasMatch: false,
  onGet: () => {},
  pending: false,
  failed: false,
}

const draw = (props: Partial<ComponentProps<typeof IssueAction>> = {}) =>
  render(<MemoryRouter><IssueAction {...base} {...props} /></MemoryRouter>)

// The whole point of pulling this out of the tile: the carousel, the sidebar list and the
// grid tile all offer the same thing, so they must offer it in the same words.
test('a matched issue offers to get it, named for the comic', () => {
  draw({ hasMatch: true, matchTitle: 'Black Cat #14 (2026)' })
  const get = screen.getByRole('button')
  expect(get).toHaveTextContent(/^↓ Get$/)
  expect(get).toHaveAccessibleName('Get Spider-Man: Long Way Home #3')
})

test('the name follows the button into its working state', () => {
  draw({ hasMatch: true, pending: true })
  expect(screen.getByRole('button')).toHaveAccessibleName('Getting Spider-Man: Long Way Home #3')
})

// The button never guesses: anything less than one certain row sends you to search.
test('an unmatched issue offers to find it instead', () => {
  draw({ hasMatch: false })
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByRole('link', { name: /Find Spider-Man: Long Way Home #3/ }))
    .toHaveAttribute('href', '/search?q=Black+Cat')
})

test('pressing get calls the handler once', () => {
  const onGet = vi.fn()
  draw({ hasMatch: true, onGet })
  fireEvent.click(screen.getByRole('button'))
  expect(onGet).toHaveBeenCalledTimes(1)
})

test('an issue already queued says so instead of offering anything to press', () => {
  draw({ hasMatch: true, queued: true })
  expect(screen.getByText(/queued/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Get/ })).toBeNull()
  expect(screen.queryByRole('link', { name: /Find/ })).toBeNull()
})

test('a failed press reports where it was pressed', () => {
  draw({ hasMatch: true, failed: true })
  expect(screen.getByText(/Could not get that one/i)).toBeInTheDocument()
})

// Upload is offered beside whichever of Get or Find is showing, because the two answer
// different questions: Get fetches the release the index found, Upload takes the comic you
// already have. A gap with no match is exactly where having the file yourself matters most.
test('an upload offer is drawn beside Get', () => {
  draw({ hasMatch: true, upload: <button type="button">↑ Upload</button> })
  expect(screen.getByRole('button', { name: /Get/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Upload/ })).toBeInTheDocument()
})

test('an upload offer is drawn beside Find too', () => {
  draw({ hasMatch: false, upload: <button type="button">↑ Upload</button> })
  expect(screen.getByRole('link', { name: /Find/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Upload/ })).toBeInTheDocument()
})

// A download for this issue is already running. Uploading the same comic now would land a
// second copy beside the one about to arrive, so the queue is left to finish.
test('an issue already queued offers no upload either', () => {
  draw({ hasMatch: true, queued: true, upload: <button type="button">↑ Upload</button> })
  expect(screen.getByText(/queued/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull()
})

// The arc page and the releases tab draw this same control but have no edition to file a
// comic into, so they pass nothing and the offer stays away rather than filing it wrongly.
test('no upload offer is drawn where none was given', () => {
  draw({ hasMatch: true })
  expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull()
})
