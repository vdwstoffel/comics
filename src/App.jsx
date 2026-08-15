import { Routes, Route } from 'react-router-dom'
import Library from './pages/Library.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
    </Routes>
  )
}
