import { Routes, Route } from 'react-router-dom'
import Library from './pages/Library.jsx'
import Series from './pages/Series.jsx'
import BookDetail from './pages/BookDetail.jsx'
import Reader from './pages/Reader.jsx'
import Upload from './pages/Upload.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/series/:id" element={<Series />} />
      <Route path="/book/:id" element={<BookDetail />} />
      <Route path="/read/:id" element={<Reader />} />
      <Route path="/upload" element={<Upload />} />
    </Routes>
  )
}
