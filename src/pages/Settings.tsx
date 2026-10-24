import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiSettings } from '../api'
import { FollowupList, FOLLOWUP_PAGE_SIZE } from '../components/FollowupList'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export default function Settings() {
  useDocumentTitle('Settings')
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })

  // The field is a draft, seeded once from the server and owned by the keyboard after
  // that. Binding it straight to the query would fight your typing on every refetch, and
  // would wipe a rejected key you are halfway through correcting.
  const [draftKey, setDraftKey] = useState<string | null>(null)
  useEffect(() => {
    if (settings && draftKey === null) setDraftKey(settings.comicVineApiKey)
  }, [settings, draftKey])

  // Both mutations take the echoed response as the new truth, then reconcile. The echo is
  // what stops a control showing its old value until the refetch lands.
  const applied = {
    onSuccess: (next: ApiSettings) => {
      qc.setQueryData(['settings'], next)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  }

  const saveKey = useMutation({
    mutationFn: (comicVineApiKey: string) => api.updateSettings({ comicVineApiKey }),
    ...applied,
  })

  const setConcurrency = useMutation({
    mutationFn: (downloadConcurrency: number) => api.updateSettings({ downloadConcurrency }),
    ...applied,
  })

  const setHidePageBar = useMutation({
    mutationFn: (hidePageBar: boolean) => api.updateSettings({ hidePageBar }),
    ...applied,
  })

  // Only the count: the list itself lives on its own page, because sixteen rows inline
  // pushed Downloads and Reading off the screen. Same query key as that page, so the two
  // share one cache entry and the count here is never out of step with the list there.
  const { data: followupData } = useQuery({
    queryKey: ['metadata-followups'], queryFn: api.metadataFollowups,
  })
  const followupCount = followupData?.followups?.length ?? 0

  return (
    <>
      <h1 className="page-title">Settings</h1>

      <section>
        <h2 className="page-title">Comic Vine</h2>
        <form
          className="settings__row"
          onSubmit={(e) => { e.preventDefault(); saveKey.mutate(draftKey ?? '') }}
        >
          <label className="settings__field">
            API key
            <input
              type="text"
              value={draftKey ?? ''}
              // Editing clears the last verdict: "Saved." beside a key you have since
              // changed is a lie about what is stored.
              onChange={(e) => { setDraftKey(e.target.value); saveKey.reset() }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {/* Until the settings query answers, draftKey is still null and would submit as
              '' - the empty-string path that skips verification and clears the stored key.
              Gating on settings being loaded is what keeps a stray early click, or a query
              that never resolves, from wiping a key that was never touched. */}
          <button className="btn" type="submit" disabled={saveKey.isPending || settings === undefined}>
            {saveKey.isPending ? 'Checking…' : 'Save'}
          </button>
        </form>

        {/* Saving is a round trip through Comic Vine, so it reports what Comic Vine said.
            A rejected key and an unreachable Comic Vine look identical from here, and this
            message is the only thing that tells them apart. */}
        {saveKey.isError && <p className="error-text">{(saveKey.error as Error).message}</p>}
        {saveKey.isSuccess && <p className="settings__hint">Saved.</p>}

        <p className="settings__hint">
          A free key comes from{' '}
          <a href="https://comicvine.gamespot.com/api/" target="_blank" rel="noreferrer">
            comicvine.gamespot.com/api
          </a>
          . Without one, search, matching and Latest releases are unavailable — the rest of
          the library works as normal.
        </p>

        {/* Nothing to follow up is the normal state, and a link to an empty page would only
            ask the reader to work out whether it means "none" or "not loaded yet". One
            line, not a card: this is a pointer to the list, not the list. */}
        {followupCount > 0 && (
          <p className="settings__followups-link">
            <Link to="/settings/metadata">
              Metadata follow-ups — {followupCount} {followupCount === 1 ? 'comic' : 'comics'}
            </Link>
          </p>
        )}
      </section>

      <section>
        <h2 className="page-title">Downloads</h2>
        <label className="settings__concurrency">
          Download at once
          <select
            value={String(settings?.downloadConcurrency ?? 1)}
            onChange={(e) => setConcurrency.mutate(Number(e.target.value))}
            disabled={setConcurrency.isPending}
          >
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {/* A dial invites the reading that higher is better. It depends on where the
            bottleneck is: a saturated link gains nothing from more connections. */}
        <p className="settings__hint">More at once is not always faster — it depends on your connection.</p>
      </section>

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

      {/* Last, by the user's instruction, and its own section rather than a part of Comic
          Vine. Hidden outright when nothing is missing: a heading over an empty box
          would only raise the question of whether it had loaded. */}
      {followupCount > 0 && (
        <section>
          <h2 className="page-title">Missing metadata</h2>
          <FollowupList pageSize={FOLLOWUP_PAGE_SIZE} />
        </section>
      )}
    </>
  )
}
