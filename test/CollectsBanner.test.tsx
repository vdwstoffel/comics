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

// An answer is said on the count line and changed in the edit dialog; the page only asks.
test('a confirmed link asks nothing on the page', () => {
  const { container } = render(
    <CollectsBanner proposal={PROPOSAL} confirmed saving={false} onConfirm={vi.fn()} onDecline={vi.fn()} />,
  )
  expect(container).toBeEmptyDOMElement()
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
