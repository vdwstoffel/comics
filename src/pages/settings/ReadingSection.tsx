import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useAppliedSettings } from './useAppliedSettings'

export default function ReadingSection() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const applied = useAppliedSettings()

  const setHidePageBar = useMutation({
    mutationFn: (hidePageBar: boolean) => api.updateSettings({ hidePageBar }),
    ...applied,
  })

  return (
    <section>
      <h2 className="page-title">Reading</h2>
      <label className="settings__toggle">
        <input
          type="checkbox"
          // Unchecked until the settings answer, rather than briefly drawn the other
          // way: the box is about what the reader will do, and it should not claim
          // anything before the server has said what is stored.
          checked={settings?.hidePageBar ?? false}
          onChange={(e) => setHidePageBar.mutate(e.target.checked)}
          disabled={setHidePageBar.isPending || settings === undefined}
        />
        Hide the page bar while reading
      </label>
      {/* The two controls that leave with it, named - so turning this on is not a
          surprise the first time you want to jump halfway through an issue. */}
      <p className="settings__hint">
        The scrubber and the page count go; the fullscreen button stays, and pages still
        turn by tapping the sides or with the arrow keys.
      </p>
    </section>
  )
}
