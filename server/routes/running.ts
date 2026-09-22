import { fetchSourcePage } from '../lib/comicIndexSource.js'
import { WIKI_PAGES, apiUrl, articleUrl, parseRunsJson, parseRunsHtml } from '../lib/wikiRuns.js'
import type { RunningSeries } from '../lib/wikiRuns.js'
import type { App } from '../types.js'

export interface RunningRouteOpts {
  /** Injected so tests never touch the network, exactly as ReleaseRouteOpts does it. */
  fetchPage?: (url: string) => Promise<string>
}

export default async function runningRoutes(app: App, opts: RunningRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts

  /**
   * Every Marvel and DC series currently being published.
   *
   * Deliberately NOT behind the Comic Vine key check that guards `/api/releases`: this
   * reads Wikipedia and has nothing to do with Comic Vine, so the tab works on a fresh
   * install with no key entered.
   *
   * Nothing is cached, by design - see the spec. Each request reads both pages.
   */
  app.get('/api/releases/running', async () => {
    const read = async (page: string): Promise<RunningSeries[]> => {
      const series = parseRunsHtml(parseRunsJson(await fetchPage(apiUrl(page))))
      // Zero rows is a failure, not an answer. The Active tables are never empty in
      // practice - Marvel does not stop publishing - so an empty parse means the page was
      // restructured and our heading names no longer match. Reporting that as "no series"
      // would render a confident, empty table; reporting it as a failure says so.
      if (series.length === 0) throw new Error(`no series parsed from ${page}`)
      return series
    }

    // allSettled, not all: one publisher's page failing must not blank the other's table.
    const results = await Promise.allSettled(WIKI_PAGES.map(({ page }) => read(page)))

    const failed: string[] = []
    const publishers = WIKI_PAGES.map(({ publisher, page }, i) => {
      const result = results[i]!
      if (result.status === 'rejected') {
        app.log.warn({ err: result.reason, publisher }, 'Wikipedia running-series read failed')
        failed.push(publisher)
      }
      return {
        name: publisher,
        sourceUrl: articleUrl(page),
        series: result.status === 'fulfilled' ? result.value : [],
      }
    })

    return { publishers, ...(failed.length ? { failed } : {}) }
  })
}
