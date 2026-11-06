import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useAppliedSettings } from './useAppliedSettings'

export default function ComicVineSection() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const applied = useAppliedSettings()

  // The field is a draft, seeded once from the server and owned by the keyboard after
  // that. Binding it straight to the query would fight your typing on every refetch, and
  // would wipe a rejected key you are halfway through correcting.
  const [draftKey, setDraftKey] = useState<string | null>(null)
  useEffect(() => {
    if (settings && draftKey === null) setDraftKey(settings.comicVineApiKey)
  }, [settings, draftKey])

  const saveKey = useMutation({
    mutationFn: (comicVineApiKey: string) => api.updateSettings({ comicVineApiKey }),
    ...applied,
  })

  return (
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
    </section>
  )
}
