import { useState } from 'react'
import { test, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EditionCombobox from '../src/components/EditionCombobox'

const EDITIONS = [
  { id: 1, name: 'Batman (2016)', bookCount: 12 },
  { id: 2, name: 'Batman: Year One', bookCount: 4 },
  { id: 3, name: 'Saga', bookCount: 60 },
]

/** The component is controlled, so the test owns the value the way Upload does. */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <EditionCombobox
      value={value}
      onChange={setValue}
      options={EDITIONS}
      placeholder="Edition name"
    />
  )
}

const input = () => screen.getByPlaceholderText('Edition name')
const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent)

test('typing narrows the list to case-insensitive substring matches', () => {
  render(<Harness />)

  fireEvent.change(input(), { target: { value: 'batman' } })

  expect(optionNames()).toEqual(['Batman (2016)12', 'Batman: Year One4'])
})

test('the list stays closed until the field is focused', () => {
  render(<Harness />)

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

  fireEvent.focus(input())

  expect(optionNames()).toEqual(['Batman (2016)12', 'Batman: Year One4', 'Saga60'])
})

test('clicking an option fills the field with that edition name', () => {
  render(<Harness />)
  fireEvent.focus(input())

  fireEvent.click(screen.getByText('Batman: Year One'))

  expect(input()).toHaveValue('Batman: Year One')
})

test('clicking an option closes the list', () => {
  render(<Harness />)
  fireEvent.focus(input())

  fireEvent.click(screen.getByText('Saga'))

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('Enter selects the option reached with ArrowDown', () => {
  render(<Harness />)
  fireEvent.focus(input())

  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'Enter' })

  expect(input()).toHaveValue('Batman: Year One')
})

test('ArrowUp steps back to the previous option', () => {
  render(<Harness />)
  fireEvent.focus(input())

  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'ArrowUp' })
  fireEvent.keyDown(input(), { key: 'Enter' })

  expect(input()).toHaveValue('Batman (2016)')
})

test('Escape closes the list without changing what was typed', () => {
  render(<Harness />)
  fireEvent.change(input(), { target: { value: 'Bat' } })

  fireEvent.keyDown(input(), { key: 'Escape' })

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(input()).toHaveValue('Bat')
})

test('typing clears the highlight so Enter leaves the typed name alone', () => {
  render(<Harness />)
  fireEvent.change(input(), { target: { value: 'Bat' } })
  fireEvent.keyDown(input(), { key: 'ArrowDown' })

  fireEvent.change(input(), { target: { value: 'Batman:' } })
  fireEvent.keyDown(input(), { key: 'Enter' })

  expect(input()).toHaveValue('Batman:')
})

test('leaving the field closes the list', () => {
  render(<Harness />)
  fireEvent.focus(input())

  fireEvent.blur(input())

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('clicking an option still selects it even though the field blurs', () => {
  render(<Harness />)
  fireEvent.focus(input())
  const option = screen.getByText('Saga')

  // A real browser fires mousedown first, then blurs the input - unless the
  // mousedown was default-prevented, which is what keeps the list alive long
  // enough for the click to land on it.
  const blurs = fireEvent.mouseDown(option)
  if (blurs) fireEvent.blur(input())
  fireEvent.click(option)

  expect(input()).toHaveValue('Saga')
})

test('a name matching no existing edition shows no list', () => {
  render(<Harness />)

  fireEvent.change(input(), { target: { value: 'Something Brand New' } })

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('the highlighted option is marked selected', () => {
  render(<Harness />)
  fireEvent.focus(input())

  fireEvent.keyDown(input(), { key: 'ArrowDown' })

  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Batman (2016)')
})
