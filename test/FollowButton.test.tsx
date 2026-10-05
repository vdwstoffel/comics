import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FollowButton from '../src/components/FollowButton'
import { api } from '../src/api'

function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getFollows').mockResolvedValue({ follows: [] })
})

test('a run you do not follow offers to follow it', async () => {
  const follow = vi.spyOn(api, 'followVolume').mockResolvedValue({
    follow: { kind: 'volume', refId: 3, name: 'Iron Man', createdAt: '2026-10-04' },
  })
  show(<FollowButton target={{ kind: 'volume', editionId: 3 }} refId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Follow' }))
  await waitFor(() => expect(follow).toHaveBeenCalledWith(3))
})

test('a run you already follow offers to stop', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'volume', refId: 3, name: 'Iron Man', state: 'dormant' }],
  })
  const unfollow = vi.spyOn(api, 'unfollow').mockResolvedValue({ unfollowed: true })
  show(<FollowButton target={{ kind: 'volume', editionId: 3 }} refId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Following' }))
  await waitFor(() => expect(unfollow).toHaveBeenCalledWith('volume', 3))
})

test('an arc is followed by name', async () => {
  const follow = vi.spyOn(api, 'followArc').mockResolvedValue({
    follow: { kind: 'arc', refId: 56676, name: 'Death Spiral', createdAt: '2026-10-04' },
  })
  show(<FollowButton target={{ kind: 'arc', name: 'Death Spiral' }} refId={56676} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Follow' }))
  await waitFor(() => expect(follow).toHaveBeenCalledWith('Death Spiral'))
})

test('a run with no Comic Vine match says why it cannot be followed', async () => {
  show(
    <FollowButton
      target={{ kind: 'volume', editionId: 3 }}
      refId={3}
      unavailable="Match this volume to Comic Vine to follow it"
    />,
  )
  const button = await screen.findByRole('button', { name: 'Follow' })
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription('Match this volume to Comic Vine to follow it')
})

test('an arc whose id is not known yet cannot be unfollowed by guess', async () => {
  vi.spyOn(api, 'getFollows').mockResolvedValue({
    follows: [{ kind: 'arc', refId: 56676, name: 'Death Spiral', state: 'dormant' }],
  })
  show(<FollowButton target={{ kind: 'arc', name: 'Death Spiral' }} refId={null} />)
  // With no id to match on, it offers to follow rather than claiming a state it cannot check.
  expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument()
})

// Pins both the invalidation and that the mutation waits for the refetch.
test('the label flips once the follow has been re-read', async () => {
  const get = vi.spyOn(api, 'getFollows')
    .mockResolvedValueOnce({ follows: [] })
    .mockResolvedValue({ follows: [{ kind: 'volume', refId: 3, name: 'Iron Man', state: 'dormant' }] })
  vi.spyOn(api, 'followVolume').mockResolvedValue({
    follow: { kind: 'volume', refId: 3, name: 'Iron Man', createdAt: '2026-10-04' },
  })
  show(<FollowButton target={{ kind: 'volume', editionId: 3 }} refId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Follow' }))
  expect(await screen.findByRole('button', { name: 'Following' })).toBeEnabled()
  expect(get).toHaveBeenCalledTimes(2)
})

test('nothing is claimed while the follow list is still loading', async () => {
  vi.spyOn(api, 'getFollows').mockReturnValue(new Promise(() => {}))
  show(<FollowButton target={{ kind: 'volume', editionId: 3 }} refId={3} />)
  const button = await screen.findByRole('button')
  expect(button).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument()
})
