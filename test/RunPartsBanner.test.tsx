import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import RunPartsBanner from '../src/components/RunPartsBanner'

const CV_URL = 'https://comicvine.gamespot.com/mortal-thor/4050-177511/'
const MORTAL_THOR = {
  volumeId: 177511, name: 'Mortal Thor', startYear: 2026, siteUrl: CV_URL, first: '7', last: '13',
}

afterEach(() => { cleanup() })

function show(props: Partial<Parameters<typeof RunPartsBanner>[0]> = {}) {
  const onConfirm = vi.fn()
  const onDecline = vi.fn()
  const view = render(
    <RunPartsBanner proposal={MORTAL_THOR} saving={false} onConfirm={onConfirm} onDecline={onDecline} {...props} />,
  )
  return { onConfirm, onDecline, ...view }
}

test('a suggestion names the volume and the stretch it holds, linked for checking', () => {
  show()
  expect(screen.getByText(/Continues as/)).toHaveTextContent('Continues as Mortal Thor (2026) #7–13?')
  expect(screen.getByRole('link', { name: 'Mortal Thor (2026)' })).toHaveAttribute('href', CV_URL)
})

test('yes confirms the suggestion and no declines it', () => {
  const { onConfirm, onDecline } = show()
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
  expect(onConfirm).toHaveBeenCalledWith(MORTAL_THOR)
  fireEvent.click(screen.getByRole('button', { name: 'No' }))
  expect(onDecline).toHaveBeenCalledWith(177511)
})

test('a stretch of one issue reads as that issue', () => {
  show({ proposal: { ...MORTAL_THOR, last: '7' } })
  expect(screen.getByText(/Continues as/)).toHaveTextContent('Continues as Mortal Thor (2026) #7?')
})

test('while saving, neither answer can be pressed twice', () => {
  show({ saving: true })
  expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'No' })).toBeDisabled()
})

test('with nothing to ask it draws nothing at all', () => {
  const { container } = show({ proposal: null })
  expect(container).toBeEmptyDOMElement()
})
