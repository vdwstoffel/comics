import { test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import MissingIssueTile from '../src/components/MissingIssueTile'

const base = {
  label: '#14', siteUrl: 'https://cv/14', findTo: '/search?q=Black+Cat',
  hasMatch: false, onGet: () => {}, pending: false, failed: false,
}

const draw = (props: Partial<ComponentProps<typeof MissingIssueTile>> = {}) =>
  render(<MemoryRouter><MissingIssueTile {...base} {...props} /></MemoryRouter>)

test('a matched issue offers to get it', () => {
  draw({ hasMatch: true, matchTitle: 'Black Cat #14 (2026)' })
  expect(screen.getByRole('button', { name: /Get #14/ })).toBeInTheDocument()
})

// The button never guesses: anything less than one certain row sends you to search.
test('an unmatched issue offers to find it instead', () => {
  draw({ hasMatch: false })
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByRole('link', { name: /Find #14/ })).toHaveAttribute('href', '/search?q=Black+Cat')
})

test('pressing get calls the handler once', () => {
  const onGet = vi.fn()
  draw({ hasMatch: true, onGet })
  fireEvent.click(screen.getByRole('button'))
  expect(onGet).toHaveBeenCalledTimes(1)
})

test('a failed press reports on its own tile', () => {
  draw({ hasMatch: true, failed: true })
  expect(screen.getByText(/Could not get that one/i)).toBeInTheDocument()
})

// Pressing Get twice on the same issue is refused by the server; saying so up front is
// better than letting someone press a button that will 409.
test('an issue already queued says so instead of offering Get', () => {
  draw({ hasMatch: true, queued: true })
  expect(screen.getByText(/queued/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Get/ })).toBeNull()
  expect(screen.queryByRole('link', { name: /Find/ })).toBeNull()
})

// The releases tab passes a cover; an edition page does not.
test('cover art is drawn when one is given and absent when not', () => {
  const { unmount } = draw({ hasMatch: false, coverUrl: 'https://cv/cover.jpg' })
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cv/cover.jpg')
  unmount()
  draw({ hasMatch: false })
  expect(screen.queryByRole('img')).toBeNull()
})
