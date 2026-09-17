import { Routes, Route, Link, useLocation } from 'react-router-dom'
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
import Releases from './pages/Releases'
import Downloads from './pages/Downloads'
import DownloadBar from './components/DownloadBar'

/**
 * The two things you browse: what you have, and what just came out. They are peers rather
 * than a brand and a link, because they are the same kind of thing.
 *
 * A page that is neither - a book, an arc, the search - marks neither, rather than leaving
 * the library lit while you are somewhere else.
 */
function Tabs() {
  const { pathname } = useLocation()
  const tabs = [
    { to: '/', label: 'Library', active: pathname === '/' },
    { to: '/releases', label: 'Latest releases', active: pathname.startsWith('/releases') },
  ]
  return (
    <nav className="app-header__tabs">
      {tabs.map(({ to, label, active }) => (
        <Link
          key={to}
          to={to}
          className="app-header__tab"
          // Styling hangs off this too, so the mark a screen reader hears and the mark you
          // see can never disagree.
          aria-current={active ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}

function Header() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Tabs />
        <nav className="app-header__nav">
          {/* A utility beside Search rather than a third tab: the tabs are the two things
              you browse. It lives here permanently because the download bar - the only
              other way in - appears only once something is already downloading, which
              made the queue's settings unreachable until you had committed to a download. */}
          <Link to="/downloads" className="app-header__link">Downloads</Link>
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
      <DownloadBar />
      <main className="page-container">{children}</main>
    </>
  )
}

/** The rail-and-content shell. The arc views share it so the sidebar stays put. */
function LibraryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <DownloadBar />
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
      <Route path="/releases" element={<Layout><Releases /></Layout>} />
      <Route path="/downloads" element={<Layout><Downloads /></Layout>} />
    </Routes>
  )
}
