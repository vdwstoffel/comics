import { NavLink } from 'react-router-dom'

/**
 * One comic or a whole volume - the choice made before anything else on either upload page.
 *
 * Tabs rather than a sentence with a link in it: the link was there, but it read as the
 * same grey text around it, and "where do I click for a folder" went unanswered.
 */
export default function UploadTabs() {
  return (
    <nav className="upload-tabs" aria-label="Upload">
      {/* `end`, or the single upload would stay lit on /upload/bulk as well. */}
      <NavLink to="/upload" end className="upload-tabs__tab">One comic</NavLink>
      <NavLink to="/upload/bulk" className="upload-tabs__tab">A whole volume</NavLink>
    </nav>
  )
}
