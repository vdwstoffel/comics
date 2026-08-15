import { useState } from 'react'
import type { FormEvent } from 'react'

export default function Upload() {
  const [series, setSeries] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    const form = new FormData()
    if (series) form.set('series', series)
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
            <input className="input" placeholder="Series name" value={series} onChange={(e) => setSeries(e.target.value)} />
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
