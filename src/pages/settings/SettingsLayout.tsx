import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

/**
 * Settings as a sidebar and one pane, rather than every section stacked down one page.
 * Four sections on one scroll meant the thing you came to change was rarely the thing on
 * screen, and the follow-up rows at the bottom pushed the rest out of sight entirely.
 *
 * Each section is a url of its own, so the back button steps between them and a link can
 * point at one - which is what lets /settings/metadata keep working from Bulk upload.
 */
// Spelled out rather than left to NavLink's default `active` class, so the modifier
// reads like every other one in the stylesheet.
const item = ({ isActive }: { isActive: boolean }) =>
  `settings-nav__item${isActive ? ' settings-nav__item--active' : ''}`

export default function SettingsLayout() {
  useDocumentTitle('Settings')

  // Only the count, for the badge. Same query key as the pane itself, so the two share
  // one cache entry and the number beside the tab is never out of step with the rows.
  const { data: followupData } = useQuery({
    queryKey: ['metadata-followups'], queryFn: api.metadataFollowups,
  })
  const followupCount = followupData?.followups?.length ?? 0

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <div className="settings-page">
        <nav className="settings-nav" aria-label="Settings sections">
          <NavLink to="/settings/comic-vine" className={item}>Comic Vine</NavLink>
          <NavLink to="/settings/downloads" className={item}>Downloads</NavLink>
          <NavLink to="/settings/reading" className={item}>Reading</NavLink>
          {/* Listed only when there is something on it. A tab that is empty every time you
              open it teaches you to stop opening it, and the badge is the point of the
              entry: it is how you learn there is work without going to look. */}
          {followupCount > 0 && (
            <NavLink to="/settings/metadata" className={item}>
              Missing metadata
              <span
                className="settings-nav__count"
                aria-label={`${followupCount} ${followupCount === 1 ? 'comic' : 'comics'}`}
              >
                {followupCount}
              </span>
            </NavLink>
          )}
        </nav>
        <div className="settings-pane">
          <Outlet />
        </div>
      </div>
    </>
  )
}
