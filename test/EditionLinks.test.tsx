import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import EditionLinks from '../src/components/EditionLinks'

const ASM_URL = 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/'
const ASM = { volumeId: 142577, name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: ASM_URL }
const MT_URL = 'https://comicvine.gamespot.com/mortal-thor/4050-177511/'
const MORTAL_THOR = { volumeId: 177511, name: 'Mortal Thor', startYear: 2026, siteUrl: MT_URL, first: '7', last: '13' }

afterEach(() => { cleanup() })

function show(props: Partial<Parameters<typeof EditionLinks>[0]> = {}) {
  const handlers = {
    onSetCollects: vi.fn(async () => ({})),
    onClearCollects: vi.fn(),
    onRecheckCollects: vi.fn(),
    onAddPart: vi.fn(async () => ({})),
    onRemovePart: vi.fn(),
  }
  render(<EditionLinks collects={null} parts={[]} saving={false} {...handlers} {...props} />)
  return handlers
}

test('a confirmed reprint says which volume it is shelved under, and can be taken back', () => {
  const { onClearCollects } = show({ collects: ASM })
  expect(screen.getByText(/Shelved under/)).toHaveTextContent('Shelved under The Amazing Spider-Man (2022)')
  expect(screen.getByRole('link', { name: 'The Amazing Spider-Man (2022)' })).toHaveAttribute('href', ASM_URL)
  fireEvent.click(screen.getByRole('button', { name: 'Not this volume' }))
  expect(onClearCollects).toHaveBeenCalled()
})

test('a Comic Vine volume link pasted by hand becomes what it reprints', async () => {
  const { onSetCollects } = show()
  const field = screen.getByLabelText('Volume this edition is part of')
  fireEvent.change(field, { target: { value: ASM_URL } })
  fireEvent.click(screen.getByRole('button', { name: 'Set' }))
  expect(onSetCollects).toHaveBeenCalledWith(142577)
  await waitFor(() => expect(field).toHaveValue(''))
})

test('a bare volume id works too, and Enter is that field\'s button', () => {
  const { onSetCollects } = show()
  const field = screen.getByLabelText('Volume this edition is part of')
  fireEvent.change(field, { target: { value: '142577' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(onSetCollects).toHaveBeenCalledWith(142577)
})

test('nothing that names a volume is not sent', () => {
  const { onSetCollects } = show()
  fireEvent.change(screen.getByLabelText('Volume this edition is part of'), { target: { value: 'spider-man' } })
  fireEvent.click(screen.getByRole('button', { name: 'Set' }))
  expect(onSetCollects).not.toHaveBeenCalled()
})

// Detection reads prose and will miss. A miss, or a mistaken No, must not cost the
// feature on that edition for good.
test('Comic Vine can be asked again what this reprints', () => {
  const { onRecheckCollects } = show()
  fireEvent.click(screen.getByRole('button', { name: 'Ask Comic Vine' }))
  expect(onRecheckCollects).toHaveBeenCalled()
})

test('a volume taken into the run is listed with its stretch, and can be taken back', () => {
  const { onRemovePart } = show({ parts: [MORTAL_THOR] })
  expect(screen.getByRole('link', { name: 'Mortal Thor (2026)' })).toHaveAttribute('href', MT_URL)
  expect(screen.getByText(/#7–13/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Not part of this run' }))
  expect(onRemovePart).toHaveBeenCalledWith(177511)
})

test('another volume of the run can be added by hand', () => {
  const { onAddPart } = show()
  fireEvent.change(screen.getByLabelText('Volume holding more of this run'), { target: { value: MT_URL } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(onAddPart).toHaveBeenCalledWith(177511)
})

test('a refused link stays in the field to be corrected, with the reason beside it', async () => {
  const onAddPart = vi.fn(async () => { throw new Error('nope') })
  show({ onAddPart, error: 'that volume shares issue numbers with this run' })
  const field = screen.getByLabelText('Volume holding more of this run')
  fireEvent.change(field, { target: { value: '123862' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))

  await waitFor(() => expect(onAddPart).toHaveBeenCalled())
  expect(field).toHaveValue('123862')
  expect(screen.getByRole('alert')).toHaveTextContent('shares issue numbers')
})

test('an edition with no volume of its own has no run to add to', () => {
  show({ parts: null })
  expect(screen.queryByLabelText('Volume holding more of this run')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Volume this edition is part of')).toBeInTheDocument()
})
