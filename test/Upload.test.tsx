import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Upload from '../src/pages/Upload'

test('Upload page renders a series field and file input', () => {
  render(<MemoryRouter><Upload /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Series name')).toBeInTheDocument()
  expect(screen.getByLabelText(/comic file/i)).toBeInTheDocument()
})
