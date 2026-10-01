import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import IssueIdentity from '../src/components/IssueIdentity'

const base = {
  label: '#12',
  title: 'The Eighth Day',
  date: '2025-08-13',
  pageCount: 22,
}

const draw = (props: Partial<ComponentProps<typeof IssueIdentity>> = {}) =>
  render(<MemoryRouter><IssueIdentity {...base} {...props} /></MemoryRouter>)

test('names the issue by number and story title', () => {
  draw()
  expect(screen.getByRole('heading')).toHaveTextContent('#12')
  expect(screen.getByRole('heading')).toHaveTextContent('The Eighth Day')
})

// An issue Comic Vine never gave a story title to is most of them.
test('an issue with no story title is still named by its number', () => {
  draw({ title: null })
  expect(screen.getByRole('heading')).toHaveTextContent('#12')
})

test('carries the cover date and the length', () => {
  draw()
  expect(screen.getByText(/2025-08-13/)).toBeInTheDocument()
  expect(screen.getByText(/22 pages/)).toBeInTheDocument()
})

// The same subline the issue's own page carries: number, year, publisher.
test('names the year and the publisher', () => {
  draw({ year: 2026, publisher: 'Marvel' })
  expect(screen.getByText(/2026/)).toBeInTheDocument()
  expect(screen.getByText(/Marvel/)).toBeInTheDocument()
})

// Whether the file itself carries its metadata is the difference between a comic that
// travels with what is known about it and one that does not.
test('says when the metadata is written into the file', () => {
  draw({ comicinfoSynced: true })
  expect(screen.getByText(/metadata embedded/i)).toBeInTheDocument()
})

test('says nothing about metadata when the file carries none', () => {
  draw({ comicinfoSynced: false })
  expect(screen.queryByText(/metadata embedded/i)).toBeNull()
})

// How far in you are is the one thing you want to see before deciding to open it.
test('a comic you are partway through says how far', () => {
  draw({ readState: 'reading', percent: 60 })
  expect(screen.getByText(/60%/)).toBeInTheDocument()
})

test('a finished comic says so rather than showing a bar at 100', () => {
  draw({ readState: 'read' })
  expect(screen.getByText(/^Read$/)).toBeInTheDocument()
})

// The way to fill a gap belongs beside the issue's name, but this block knows nothing
// about downloads - the page passes the control in.
test('draws whatever action the page gives it', () => {
  draw({ action: <button type="button">↓ Get</button> })
  expect(screen.getByRole('button', { name: '↓ Get' })).toBeInTheDocument()
})

// The comic's own page is gone, so what it could do to a comic is reached from here.
test('offers to edit what is known about the comic', () => {
  draw({ onEdit: () => {} })
  expect(screen.getByRole('button', { name: /edit metadata/i })).toBeInTheDocument()
})

test('a gap has no metadata to edit', () => {
  draw()
  expect(screen.queryByRole('button', { name: /edit metadata/i })).toBeNull()
})

// Removing a comic deletes a file from disk, so the control is offered only where there
// is a comic to remove - never on a gap, which is an absence already.
test('offers to remove the comic when there is one', () => {
  draw({ onRemove: () => {} })
  expect(screen.getByRole('button', { name: /remove issue/i })).toBeInTheDocument()
})

test('offers no removal when there is nothing to remove', () => {
  draw()
  expect(screen.queryByRole('button', { name: /remove issue/i })).toBeNull()
})
