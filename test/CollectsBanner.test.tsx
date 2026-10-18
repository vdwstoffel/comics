import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CollectsBanner from '../src/components/CollectsBanner'

const CV_URL = 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/'
const PROPOSAL = { volumeId: 142577, name: 'The Amazing Spider-Man', startYear: 2022, siteUrl: CV_URL }

afterEach(() => { cleanup() })

function show(props: Partial<Parameters<typeof CollectsBanner>[0]> = {}) {
  const onConfirm = vi.fn()
  const onDecline = vi.fn()
  render(
    <CollectsBanner
      proposal={PROPOSAL}
      confirmed={false}
      saving={false}
      onConfirm={onConfirm}
      onDecline={onDecline}
      {...props}
    />,
  )
  return { onConfirm, onDecline }
}

// Spec §4.2: a wrong link folds two unrelated runs onto one shelf and looks, at a
// glance, like the feature working. Checking it has to be one click.
test('a proposal can be checked against Comic Vine before saying yes', () => {
  show()
  expect(screen.getByRole('link', { name: /The Amazing Spider-Man \(2022\)/ })).toHaveAttribute('href', CV_URL)
  expect(screen.getByRole('button', { name: /^Yes/ })).toBeInTheDocument()
})

test('saying yes hands back the proposal it was shown', () => {
  const { onConfirm } = show()
  fireEvent.click(screen.getByRole('button', { name: /^Yes/ }))
  expect(onConfirm).toHaveBeenCalledWith(PROPOSAL)
})

test('saying no declines without writing a link', () => {
  const { onDecline } = show()
  fireEvent.click(screen.getByRole('button', { name: /^No/ }))
  expect(onDecline).toHaveBeenCalled()
})

// Spec §5.5: the quick link to the reprinted volume belongs on every edition page.
test('a confirmed edition says what it collects and links the volume', () => {
  show({ confirmed: true })
  expect(screen.getByText(/Collects/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /The Amazing Spider-Man \(2022\)/ })).toHaveAttribute('href', CV_URL)
  expect(screen.queryByRole('button', { name: /^Yes/ })).not.toBeInTheDocument()
})

test('a confirmed link can be taken back', () => {
  const { onDecline } = show({ confirmed: true })
  fireEvent.click(screen.getByRole('button', { name: /Not a collection/ }))
  expect(onDecline).toHaveBeenCalled()
})

test('nothing proposed draws nothing at all', () => {
  const { container } = render(
    <CollectsBanner proposal={null} confirmed={false} saving={false} onConfirm={vi.fn()} onDecline={vi.fn()} />,
  )
  expect(container).toBeEmptyDOMElement()
})

test('a volume with no year is still named', () => {
  show({ proposal: { ...PROPOSAL, startYear: null } })
  expect(screen.getByRole('link', { name: 'The Amazing Spider-Man' })).toBeInTheDocument()
})

test('while saving, neither answer can be pressed twice', () => {
  show({ saving: true })
  expect(screen.getByRole('button', { name: /^Yes/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /^No/ })).toBeDisabled()
})

// Spec §3.3: detection reads prose and will miss. A miss, or a mistaken No, must not
// cost the feature on that edition for good.
test('with nothing proposed there is a quiet way in, not a standing form', () => {
  render(
    <CollectsBanner proposal={null} confirmed={false} saving={false}
      onConfirm={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} onSetByHand={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: /Collects another volume/ })).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('a Comic Vine volume link pasted by hand becomes a link', () => {
  const onSetByHand = vi.fn()
  render(
    <CollectsBanner proposal={null} confirmed={false} saving={false}
      onConfirm={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} onSetByHand={onSetByHand} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Collects another volume/ }))
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Set$/ }))
  expect(onSetByHand).toHaveBeenCalledWith(142577)
})

test('a bare volume id works too', () => {
  const onSetByHand = vi.fn()
  render(
    <CollectsBanner proposal={null} confirmed={false} saving={false}
      onConfirm={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} onSetByHand={onSetByHand} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Collects another volume/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '142577' } })
  fireEvent.click(screen.getByRole('button', { name: /^Set$/ }))
  expect(onSetByHand).toHaveBeenCalledWith(142577)
})

test('nothing that names a volume cannot be set', () => {
  const onSetByHand = vi.fn()
  render(
    <CollectsBanner proposal={null} confirmed={false} saving={false}
      onConfirm={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} onSetByHand={onSetByHand} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Collects another volume/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'spider-man' } })
  fireEvent.click(screen.getByRole('button', { name: /^Set$/ }))
  expect(onSetByHand).not.toHaveBeenCalled()
})

test('Comic Vine can be asked again after a decline', () => {
  const onRecheck = vi.fn()
  render(
    <CollectsBanner proposal={null} confirmed={false} saving={false}
      onConfirm={vi.fn()} onDecline={vi.fn()} onRecheck={onRecheck} onSetByHand={vi.fn()} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Collects another volume/ }))
  fireEvent.click(screen.getByRole('button', { name: /Ask Comic Vine/ }))
  expect(onRecheck).toHaveBeenCalled()
})
