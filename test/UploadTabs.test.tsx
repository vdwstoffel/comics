import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UploadTabs from '../src/components/UploadTabs'

function drawAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><UploadTabs /></MemoryRouter>)
}

test('the tabs lead to the single upload and the bulk one', () => {
  drawAt('/upload')
  expect(screen.getByRole('link', { name: 'One comic' })).toHaveAttribute('href', '/upload')
  expect(screen.getByRole('link', { name: 'A whole volume' })).toHaveAttribute('href', '/upload/bulk')
})

test('on the single upload, only that tab is current', () => {
  drawAt('/upload')
  expect(screen.getByRole('link', { name: 'One comic' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'A whole volume' })).not.toHaveAttribute('aria-current')
})

// /upload is a prefix of /upload/bulk, so without `end` both would light up here.
test('on the bulk upload, only that tab is current', () => {
  drawAt('/upload/bulk')
  expect(screen.getByRole('link', { name: 'A whole volume' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'One comic' })).not.toHaveAttribute('aria-current')
})
