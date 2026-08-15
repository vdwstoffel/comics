import { Routes, Route, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import Library from './pages/Library'
import Series from './pages/Series'
import BookDetail from './pages/BookDetail'
import Reader from './pages/Reader'
import Upload from './pages/Upload'

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

function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="page-container">{children}</main>
    </>
  )
}

function ReaderLayout({ children }: { children: ReactNode }) {
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
