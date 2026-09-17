import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VolumeIssuesDialog from '../src/components/VolumeIssuesDialog'
import type { VolumeGroup } from '../src/lib/volumeGroups'
import type { ApiLibraryBook } from '../src/api'

const book = (id: number, number: string, title: string | null): ApiLibraryBook => ({
  id, editionId: 9, editionName: 'Venom (2025)', title, number,
  pageCount: 20, comicinfoSynced: false, readState: 'unread', percent: 0,
})

const GROUP: VolumeGroup = {
  editionId: 9,
  editionName: 'Venom (2025)',
  books: [book(1, '255', 'Bad Things'), book(2, '256', 'Worse Things')],
}

afterEach(() => { cleanup() })

function renderDialog(group: VolumeGroup = GROUP) {
  const onClose = vi.fn()
  render(<MemoryRouter><VolumeIssuesDialog group={group} onClose={onClose} /></MemoryRouter>)
  return { onClose }
}

test('the dialog is named after the volume it holds', () => {
  renderDialog()
  expect(screen.getByRole('dialog', { name: 'Venom (2025)' })).toBeInTheDocument()
})

test('it lists the volume\'s unread issues, each linking to the comic', () => {
  renderDialog()
  const dialog = screen.getByRole('dialog')

  expect(within(dialog).getByRole('link', { name: /Bad Things/ })).toHaveAttribute('href', '/book/1')
  expect(within(dialog).getByRole('link', { name: /Worse Things/ })).toHaveAttribute('href', '/book/2')
})

test('it says how many there are', () => {
  renderDialog()
  expect(within(screen.getByRole('dialog')).getByText('2 unread')).toBeInTheDocument()
})

// The whole volume is one click away from the list of what is left in it.
test('it offers a way through to the volume itself', () => {
  renderDialog()
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: /open the volume/i }))
    .toHaveAttribute('href', '/edition/9?status=unread')
})

test('Escape closes it', () => {
  const { onClose } = renderDialog()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('clicking the backdrop closes it', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByTestId('volume-issues-backdrop'))
  expect(onClose).toHaveBeenCalled()
})

// Reaching for a comic must not dismiss the thing you are reaching into.
test('clicking inside it does not close it', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByRole('dialog'))
  expect(onClose).not.toHaveBeenCalled()
})

test('the close button closes it', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalled()
})

test('a volume holding one issue reads in the singular', () => {
  renderDialog({ ...GROUP, books: [book(1, '255', 'Bad Things')] })
  expect(within(screen.getByRole('dialog')).getByText('1 unread')).toBeInTheDocument()
})
