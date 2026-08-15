import { Routes, Route, Link } from 'react-router-dom'
import Library from './pages/Library.jsx'
import Series from './pages/Series.jsx'
import BookDetail from './pages/BookDetail.jsx'
import Reader from './pages/Reader.jsx'
import Upload from './pages/Upload.jsx'

function Header() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link to="/" className="app-header__brand">Comics</Link>
        <Link to="/upload" className="app-header__upload">+ Upload</Link>
      </div>
    </header>
  )
}

function Layout({ children }) {
  return (
    <>
      <Header />
      <main className="page-container">{children}</main>
    </>
  )
}

function ReaderLayout({ children }) {
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><Library /></Layout>} />
      <Route path="/series/:id" element={<Layout><Series /></Layout>} />
      <Route path="/book/:id" element={<Layout><BookDetail /></Layout>} />
      <Route path="/read/:id" element={<ReaderLayout><Reader /></ReaderLayout>} />
      <Route path="/upload" element={<Layout><Upload /></Layout>} />
    </Routes>
  )
}
