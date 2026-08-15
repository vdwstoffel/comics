import { useState } from 'react'

export default function Upload() {
  const [series, setSeries] = useState('')
  const [file, setFile] = useState(null)
  const [pct, setPct] = useState(null)
  const [msg, setMsg] = useState(null)

  function submit(e) {
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
    <div style={{ padding: 16, maxWidth: 480 }}>
      <h1>Upload a comic</h1>
      <form onSubmit={submit}>
        <input placeholder="Series name" value={series} onChange={(e) => setSeries(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
        <label style={{ display: 'block', marginBottom: 8 }}>
          Comic file (.cbz)
          <input type="file" accept=".cbz" onChange={(e) => setFile(e.target.files[0])} />
        </label>
        <button type="submit" disabled={!file || pct !== null}>Upload</button>
      </form>
      {pct !== null && <p>Uploading… {pct}%</p>}
      {msg && <p>{msg}</p>}
    </div>
  )
}
