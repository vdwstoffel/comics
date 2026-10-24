import { Routes, Route, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Library from './pages/Library'
import Series from './pages/Series'
import SeriesAnnuals from './pages/SeriesAnnuals'
import Edition from './pages/Edition'
import Volume from './pages/Volume'
import BookRedirect from './pages/BookRedirect'
import Reader from './pages/Reader'
import Upload from './pages/Upload'
import SearchComics from './pages/SearchComics'
import Arcs from './pages/Arcs'
import Arc from './pages/Arc'
import Following from './pages/Following'
import LibrarySearch from './pages/LibrarySearch'
import Releases from './pages/Releases'
import Downloads from './pages/Downloads'
import Settings from './pages/Settings'
import MetadataFollowups from './pages/MetadataFollowups'
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

/**
 * Searches the comics you own. It submits to a results page rather than answering in place:
 * there is no menu of suggestions and no history, because the results are shelves and a
 * shelf wants a page.
 *
 * This is not the search that looks outward at what could be downloaded; that one is the
 * Get comics link, and it is why that link no longer says Search.
 */
function LibrarySearchBox() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // The results page has no box of its own, so this is the only place to refine a search.
  // Elsewhere there is no query to show.
  const searching = pathname === '/library/search' ? (params.get('q') ?? '') : ''
  const [text, setText] = useState(searching)
  const [shown, setShown] = useState(searching)
  // Follows the url as well as the keyboard: a link, back or a reload changes the query
  // without anyone typing in the box. Done while rendering rather than in an effect so the
  // box never paints the old query. That is all this guarantees: it keeps the box in step
  // with the url. Focus survives a search only within a layout. Layout and LibraryLayout are
  // different component types, so going between them (say /releases to /library/search)
  // remounts the whole header, dropping focus and any text typed but not submitted. Known
  // limitation; lifting Header above Routes would fix it but restructures every route.
  if (shown !== searching) {
    setShown(searching)
    setText(searching)
  }

  const onResults = pathname === '/library/search'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (q === '') {
      // On the results page an empty box means "clear this search": the page would
      // otherwise keep showing, and filtering by, a query the box no longer holds.
      if (onResults) navigate('/')
      // Anywhere else there is nothing to ask. Leaving you where you are beats a results
      // page that says only to type something in the box you have just pressed Enter in.
      return
    }
    navigate(`/library/search?q=${encodeURIComponent(q)}`)
  }

  const change = (value: string) => {
    setText(value)
    // The native clear button of a search input empties the text and fires no submit, so
    // the change is the only signal. Raw value, not trimmed: a lone space is mid-edit.
    if (value === '' && onResults) navigate('/')
  }

  return (
    <form role="search" className="app-header__search" onSubmit={submit}>
      <input
        type="search"
        className="app-header__search-input"
        aria-label="Search your library"
        placeholder="Search your library"
        value={text}
        onChange={(e) => change(e.target.value)}
      />
    </form>
  )
}

// Remounts when you move between Layout and LibraryLayout; see LibrarySearchBox.
function Header() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Tabs />
        {/* Neither a tab nor a utility link: it is not a place to browse, and it is a form
            rather than a destination. Its own group keeps the tabs peers and the right-hand
            side links. */}
        <LibrarySearchBox />
        <nav className="app-header__nav">
          {/* A utility beside Get comics rather than a third tab: the tabs are the two
              things you browse. It lives here permanently because the download bar - the
              only other way in - appears only once something is already downloading, which
              made the queue's settings unreachable until you had committed to a download. */}
          <Link to="/downloads" className="app-header__link">Downloads</Link>
          <Link to="/settings" className="app-header__link">Settings</Link>
          <Link to="/search" className="app-header__link">Get comics</Link>
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
      <Route path="/following" element={<LibraryLayout><Following /></LibraryLayout>} />
      <Route path="/library/search" element={<LibraryLayout><LibrarySearch /></LibraryLayout>} />
      <Route path="/series/:name" element={<Layout><Series /></Layout>} />
      <Route path="/series/:name/annuals" element={<Layout><SeriesAnnuals /></Layout>} />
      <Route path="/edition/:id" element={<Layout><Edition /></Layout>} />
      {/* A run that arrived as several collections. Keyed by the Comic Vine volume,
          because that is the one thing all of its editions agree on. */}
      <Route path="/volume/:volumeId" element={<Layout><Volume /></Layout>} />
      {/* The comic's own page is gone; everything it said and did lives in the run. */}
      <Route path="/book/:id" element={<Layout><BookRedirect /></Layout>} />
      <Route path="/read/:id" element={<ReaderLayout><Reader /></ReaderLayout>} />
      <Route path="/upload" element={<Layout><Upload /></Layout>} />
      <Route path="/search" element={<Layout><SearchComics /></Layout>} />
      <Route path="/releases" element={<Layout><Releases /></Layout>} />
      <Route path="/downloads" element={<Layout><Downloads /></Layout>} />
      <Route path="/settings" element={<Layout><Settings /></Layout>} />
      {/* Split out of Settings: the list can run to dozens of rows and buried the settings
          below it. */}
      <Route path="/settings/metadata" element={<Layout><MetadataFollowups /></Layout>} />
    </Routes>
  )
}
