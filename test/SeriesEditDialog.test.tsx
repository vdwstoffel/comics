import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SeriesEditDialog from '../src/components/SeriesEditDialog'

afterEach(() => { cleanup() })

function renderDialog(props: Partial<Parameters<typeof SeriesEditDialog>[0]> = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <SeriesEditDialog
      name="Batman Vol. 2 (New 52 TPB)"
      groupName="Batman"
      onSave={onSave}
      onClose={onClose}
      {...props}
    />,
  )
  return { onSave, onClose }
}

test('shows both fields, labelled and prefilled', () => {
  renderDialog()
  expect(screen.getByRole('heading', { name: /edit series/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/series name/i)).toHaveValue('Batman Vol. 2 (New 52 TPB)')
  expect(screen.getByLabelText(/group/i)).toHaveValue('Batman')
})

test('explains what the group field does', () => {
  renderDialog()
  expect(screen.getByText(/appear as one tile/i)).toBeInTheDocument()
})

test('an empty group renders as an empty field, not the word null', () => {
  renderDialog({ groupName: null })
  expect(screen.getByLabelText(/group/i)).toHaveValue('')
})

test('saving passes the edited values back, trimmed', () => {
  const { onSave } = renderDialog()
  fireEvent.change(screen.getByLabelText(/series name/i), { target: { value: '  Batman Vol. 2  ' } })
  fireEvent.change(screen.getByLabelText(/group/i), { target: { value: '  Batman  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith({ name: 'Batman Vol. 2', groupName: 'Batman' })
})

test('pressing Enter in a field saves', () => {
  const { onSave } = renderDialog()
  fireEvent.keyDown(screen.getByLabelText(/series name/i), { key: 'Enter' })
  expect(onSave).toHaveBeenCalled()
})

test('Cancel closes without saving', () => {
  const { onSave, onClose } = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
  expect(onClose).toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
})

test('Escape closes without saving', () => {
  const { onSave, onClose } = renderDialog()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
})

test('clicking the backdrop closes', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByTestId('series-edit-backdrop'))
  expect(onClose).toHaveBeenCalled()
})

test('clicking inside the panel does not close', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByRole('heading', { name: /edit series/i }))
  expect(onClose).not.toHaveBeenCalled()
})

test('a blank name cannot be saved', () => {
  const { onSave } = renderDialog()
  fireEvent.change(screen.getByLabelText(/series name/i), { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).not.toHaveBeenCalled()
})

test('Save is disabled while a save is in flight', () => {
  renderDialog({ saving: true })
  expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
})

test('an error is shown inside the dialog', () => {
  renderDialog({ error: 'Rename failed: folder exists' })
  expect(screen.getByText(/folder exists/)).toBeInTheDocument()
})

test('renaming is called out as moving files', () => {
  renderDialog()
  expect(screen.getByText(/moves the files/i)).toBeInTheDocument()
})
