import { Routes, Route, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import Library from './pages/Library'
import Series from './pages/Series'
import Edition from './pages/Edition'
import BookDetail from './pages/BookDetail'
import Reader from './pages/Reader'
import Upload from './pages/Upload'
import SearchComics from './pages/SearchComics'
import Arcs from './pages/Arcs'
import Arc from './pages/Arc'

function Header() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link to="/" className="app-header__brand">Comics</Link>
        <nav className="app-header__nav">
          <Link to="/search" className="app-header__link">Search</Link>
          <Link to="/upload" className="app-header__upload">+ Upload</Link>
        </nav>
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

/** The rail-and-content shell. The arc views share it so the sidebar stays put. */
function LibraryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <div className="library-shell">{children}</div>
    </>
  )
}

function ReaderLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryLayout><Library /></LibraryLayout>} />
      <Route path="/arcs" element={<LibraryLayout><Arcs /></LibraryLayout>} />
      <Route path="/arcs/:name" element={<LibraryLayout><Arc /></LibraryLayout>} />
      <Route path="/series/:name" element={<Layout><Series /></Layout>} />
      <Route path="/edition/:id" element={<Layout><Edition /></Layout>} />
      <Route path="/book/:id" element={<Layout><BookDetail /></Layout>} />
      <Route path="/read/:id" element={<ReaderLayout><Reader /></ReaderLayout>} />
      <Route path="/upload" element={<Layout><Upload /></Layout>} />
      <Route path="/search" element={<Layout><SearchComics /></Layout>} />
    </Routes>
  )
}
