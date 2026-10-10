/**
 * A stand-in for the browser's uploader, so a test can see what was sent and decide how
 * and when the server answers.
 *
 * XMLHttpRequest rather than fetch because the real upload path needs the one thing fetch
 * still cannot do - report how much of the body has gone - and a test that stubbed fetch
 * would be testing a different uploader than the one that ships.
 */
export class FakeXhr {
  /** The most recent request, which is the one the test just provoked. */
  static last: FakeXhr | undefined
  static sent: FakeXhr[] = []

  method = ''
  url = ''
  body: FormData | undefined
  status = 200
  responseText = '{}'
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null }

  constructor() { FakeXhr.last = this }
  open(method: string, url: string) { this.method = method; this.url = url }
  send(body: FormData) { this.body = body; FakeXhr.sent.push(this) }

  /** The server answering, which the real one does well after send() returns. */
  finish(status: number, text: string) { this.status = status; this.responseText = text; this.onload?.() }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent)
  }
}

/** Point the global uploader at the fake and forget anything an earlier test sent. */
export function installFakeXhr() {
  FakeXhr.last = undefined
  FakeXhr.sent = []
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
}
