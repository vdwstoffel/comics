import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import EditionEditDialog from '../src/components/EditionEditDialog'

afterEach(() => { cleanup() })

function renderDialog(props: Partial<Parameters<typeof EditionEditDialog>[0]> = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <EditionEditDialog
      name="Batman Vol. 2 (New 52 TPB)"
      seriesName="Batman"
      onSave={onSave}
      onClose={onClose}
      {...props}
    />,
  )
  return { onSave, onClose }
}

test('shows both fields, labelled and prefilled', () => {
  renderDialog()
  expect(screen.getByRole('heading', { name: /edit edition/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/edition name/i)).toHaveValue('Batman Vol. 2 (New 52 TPB)')
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('Batman')
})

test('an empty series renders as an empty field, not the word null', () => {
  renderDialog({ seriesName: null })
  expect(screen.getByLabelText(/^series$/i)).toHaveValue('')
})

test('saving passes the edited values back, trimmed', () => {
  const { onSave } = renderDialog()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: '  Batman Vol. 2  ' } })
  fireEvent.change(screen.getByLabelText(/^series$/i), { target: { value: '  Batman  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith({ name: 'Batman Vol. 2', seriesName: 'Batman' })
})

test('pressing Enter in a field saves', () => {
  const { onSave } = renderDialog()
  fireEvent.keyDown(screen.getByLabelText(/edition name/i), { key: 'Enter' })
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
  fireEvent.click(screen.getByTestId('edition-edit-backdrop'))
  expect(onClose).toHaveBeenCalled()
})

test('clicking inside the panel does not close', () => {
  const { onClose } = renderDialog()
  fireEvent.click(screen.getByRole('heading', { name: /edit edition/i }))
  expect(onClose).not.toHaveBeenCalled()
})

test('a blank name cannot be saved', () => {
  const { onSave } = renderDialog()
  fireEvent.change(screen.getByLabelText(/edition name/i), { target: { value: '   ' } })
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
