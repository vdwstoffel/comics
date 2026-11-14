import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import PostPartsDialog from '../src/components/PostPartsDialog'
import type { PostDownloads } from '../src/api'

afterEach(() => cleanup())

const POST: PostDownloads = {
  postUrl: 'https://getcomics.org/marvel/daredevil/',
  title: 'Daredevil Vol. 6 #1 – 32 + Annual',
  size: '1.4 GB',
  parts: [
    { heading: 'Daredevil #1 – Director’s Cut (2019)', size: '165 MB', url: 'u0' },
    { heading: 'Daredevil #1 – 12 (2019)', size: '462 MB', url: 'u1' },
    { heading: 'Daredevil #13 – 23 + Annual (2020)', size: '482 MB', url: 'u2' },
  ],
}

test('every part is listed under its own heading, all ticked', () => {
  render(<PostPartsDialog post={POST} onDownload={() => {}} onClose={() => {}} />)
  expect(screen.getByRole('heading', { name: POST.title! })).toBeInTheDocument()
  for (const part of POST.parts) {
    expect(screen.getByRole('checkbox', { name: part.heading })).toBeChecked()
  }
  expect(screen.getByText('462 MB')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download 3 parts' })).toBeEnabled()
})

test('only the parts left ticked are downloaded', () => {
  const onDownload = vi.fn()
  render(<PostPartsDialog post={POST} onDownload={onDownload} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('checkbox', { name: /Director/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Download 2 parts' }))
  expect(onDownload).toHaveBeenCalledWith([POST.parts[1], POST.parts[2]])
})

test('with nothing ticked there is nothing to download', () => {
  render(<PostPartsDialog post={POST} onDownload={() => {}} onClose={() => {}} />)
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
  expect(screen.getByRole('button', { name: 'Download 0 parts' })).toBeDisabled()
})
