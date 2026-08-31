import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ConfirmDeleteDialog from '../src/components/ConfirmDeleteDialog'

afterEach(() => { cleanup() })

function renderDialog(props: Partial<Parameters<typeof ConfirmDeleteDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <ConfirmDeleteDialog
      what={'series "Saga"'}
      detail="3 editions · 34 issues"
      fileCount={34}
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  )
  return { onConfirm, onClose }
}

test('names what is being removed, with the file count as the guard', () => {
  renderDialog()
  expect(screen.getByRole('heading', { name: /remove series "Saga"\?/i })).toBeInTheDocument()
  expect(screen.getByText('3 editions · 34 issues')).toBeInTheDocument()
  expect(screen.getByText(/34 files will be deleted from disk/i)).toBeInTheDocument()
  expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
})

test('a single file reads in the singular', () => {
  renderDialog({ what: 'issue #1', detail: undefined, fileCount: 1 })
  expect(screen.getByText(/1 file will be deleted from disk/i)).toBeInTheDocument()
})

test('Remove confirms', () => {
  const { onConfirm } = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(onConfirm).toHaveBeenCalled()
})

test('Cancel closes without confirming', () => {
  const { onConfirm, onClose } = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
  expect(onClose).toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
})

test('Escape closes without confirming', () => {
  const { onConfirm, onClose } = renderDialog()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
})

test('clicking the backdrop closes, clicking the panel does not', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByRole('heading', { name: /remove/i }))
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('confirm-delete-backdrop'))
  expect(onClose).toHaveBeenCalled()
})

test('Remove is disabled while the delete is in flight', () => {
  renderDialog({ deleting: true })
  expect(screen.getByRole('button', { name: /removing/i })).toBeDisabled()
})

test('an error is shown inside the dialog', () => {
  renderDialog({ error: 'Remove failed: 500' })
  expect(screen.getByText(/Remove failed: 500/)).toBeInTheDocument()
})

// The file count is the only guard on an irreversible delete, so it must never be
// possible to confirm while the real number is still loading.
test('Remove stays disabled until the file count is known', () => {
  const { onConfirm } = renderDialog({ fileCount: null })
  expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled()
  expect(screen.getByText(/counting the files/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /remove/i }))
  expect(onConfirm).not.toHaveBeenCalled()
})
