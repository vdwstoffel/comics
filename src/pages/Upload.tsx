import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import EditionCombobox from '../components/EditionCombobox'

export default function Upload() {
  const [edition, setEdition] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: editionsData } = useQuery({
    queryKey: ['editions', null],
    queryFn: () => api.getEditions(),
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    const form = new FormData()
    if (edition) form.set('edition', edition)
    form.set('file', file, file.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setPct(Math.round((ev.loaded / ev.total) * 100)) }
    xhr.onload = () => { setPct(null); setMsg(xhr.status === 200 ? 'Uploaded!' : `Error: ${xhr.status}`) }
    xhr.onerror = () => { setPct(null); setMsg('Upload failed') }
    xhr.send(form)
  }

  return (
    <div className="upload-wrap">
      <div className="upload-card">
        <h1>Upload a comic</h1>
        <form onSubmit={submit}>
          <div className="field">
            <EditionCombobox
              value={edition}
              onChange={setEdition}
              options={editionsData?.editions ?? []}
              placeholder="Edition name"
            />
          </div>
          <div className="field">
            <label className="file-label">
              Comic file (.cbz or .cbr)
              <input className="file-input" type="file" accept=".cbz,.cbr" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <button className="btn" type="submit" disabled={!file || pct !== null}>Upload</button>
        </form>
        {pct !== null && <p className="upload-progress">Uploading… {pct}%</p>}
        {msg && <p className="upload-msg">{msg}</p>}
      </div>
    </div>
  )
}
