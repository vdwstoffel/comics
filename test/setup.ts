import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest runs without `globals`, so Testing Library's automatic cleanup never
// registers. Without this, renders pile up in the DOM across tests in a file.
afterEach(cleanup)
