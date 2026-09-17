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
  // The second is hidden behind the spoiler blur, so it is named by its number rather
  // than its title. It is still a way through to the comic.
  expect(within(dialog).getByRole('link', { name: /#256/ })).toHaveAttribute('href', '/book/2')
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

// --- spoiler blur ------------------------------------------------------------

const THREE: VolumeGroup = {
  editionId: 9,
  editionName: 'Venom (2025)',
  books: [book(1, '255', 'Bad Things'), book(2, '256', 'Worse Things'), book(3, '257', 'Worst Things')],
}

// The next one you would read is the one you have already decided to see. Everything
// after it is a cover for a story you have not read yet.
test('everything after the first unread issue is hidden', () => {
  renderDialog(THREE)

  expect(screen.queryByRole('button', { name: /reveal the cover of #255/i })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /reveal the cover of #256/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /reveal the cover of #257/i })).toBeInTheDocument()
})

test('the first issue is shown in full', () => {
  renderDialog(THREE)
  expect(screen.getByText('Bad Things')).toBeInTheDocument()
})

// A title spoils as readily as the art it sits under - "Death Spiral, Part 3 of 9" tells
// you the thing the blur is there to hide. A hidden issue is named by its number alone.
test('a hidden issue shows its number rather than its title', () => {
  renderDialog(THREE)

  expect(screen.queryByText('Worse Things')).not.toBeInTheDocument()
  expect(screen.queryByText('Worst Things')).not.toBeInTheDocument()
  expect(screen.getByText('#256')).toBeInTheDocument()
})

test('a hidden cover is actually blurred', () => {
  renderDialog(THREE)
  const hidden = screen.getByAltText('#256')
  expect(hidden.closest('.cover-tile__image-box')).toHaveClass('cover-tile__image-box--blurred')
})

test('revealing one issue leaves the rest hidden', () => {
  renderDialog(THREE)
  fireEvent.click(screen.getByRole('button', { name: /reveal the cover of #256/i }))

  expect(screen.getByText('Worse Things')).toBeInTheDocument()
  expect(screen.getByAltText('Worse Things').closest('.cover-tile__image-box'))
    .not.toHaveClass('cover-tile__image-box--blurred')
  expect(screen.queryByText('Worst Things')).not.toBeInTheDocument()
})

test('a revealed issue loses its reveal button', () => {
  renderDialog(THREE)
  fireEvent.click(screen.getByRole('button', { name: /reveal the cover of #256/i }))
  expect(screen.queryByRole('button', { name: /reveal the cover of #256/i })).not.toBeInTheDocument()
})

// The tile wraps its whole body in a link. A reveal button nested inside it would be
// invalid markup and every reveal would open the comic instead of uncovering it.
test('revealing does not open the comic', () => {
  renderDialog(THREE)
  const reveal = screen.getByRole('button', { name: /reveal the cover of #256/i })
  expect(reveal.closest('a')).toBeNull()
})

// Nothing to spoil: the one unread issue is the one you are about to read.
test('a volume with a single unread issue hides nothing', () => {
  renderDialog({ ...GROUP, books: [book(1, '255', 'Bad Things')] })
  expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument()
  expect(screen.getByText('Bad Things')).toBeInTheDocument()
})
