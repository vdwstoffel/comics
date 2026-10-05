import { createComicVine } from '../lib/comicvine.js'
import { addFollow, listFollows, removeFollow } from '../models/follows.js'
import type { Follow, FollowKind } from '../models/follows.js'
import { getEdition } from '../models/editions.js'
import { getComicVineKey } from '../models/settings.js'
import { findLiveByIssue } from '../models/downloadQueue.js'
import { resolveArcId } from '../services/arcIdentity.js'
import { nextWantedIssue, attemptFollow } from '../services/following.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { App } from '../types.js'

interface FollowBody { kind?: string; editionId?: number; name?: string }
interface FollowParams { kind: string; refId: string }

export interface FollowRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

const KINDS: FollowKind[] = ['volume', 'arc']
const isKind = (v: unknown): v is FollowKind => KINDS.includes(v as FollowKind)

export default async function followRoutes(app: App, opts: FollowRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  /**
   * What each follow is waiting for. A volume follow whose edition has gone, or was never
   * matched to Comic Vine, is dropped here rather than drawn as a tile that can never do
   * anything. Arc follows are never dropped: an unknown arc reads as caught up.
   */
  app.get('/api/follows', async () => {
    const views = []
    for (const follow of listFollows(app.db)) {
      const outcome = nextWantedIssue(app.db, follow)
      if (outcome.state === 'unresolved') {
        removeFollow(app.db, follow.kind, follow.refId)
        continue
      }
      // The names the solicitation calendar matches a run on - `cvStartYear` above all,
      // which is what tells a relaunch from the run before it. The shelf does the matching
      // itself, against a calendar only the browser has; the server's part is to say which
      // volume this follow is, in every name that volume answers to.
      const edition = follow.kind === 'volume' ? getEdition(app.db, follow.refId) : undefined

      views.push({
        kind: follow.kind,
        refId: follow.refId,
        name: follow.name,
        state: outcome.state,
        ...(edition
          ? {
              edition: {
                name: edition.name,
                seriesName: edition.seriesName,
                cvName: edition.cvName,
                cvStartYear: edition.cvStartYear,
              },
            }
          : {}),
        ...(outcome.state === 'wanted'
          ? {
              want: {
                id: outcome.issue.id,
                number: outcome.issue.number ?? null,
                name: outcome.issue.name ?? null,
              },
              // Whether the thing it wants is already on its way, which is a different
              // sentence from "waiting" and the one a reader actually wants to read.
              queued: findLiveByIssue(app.db, outcome.issue.id) !== undefined,
            }
          : {}),
      })
    }
    return { follows: views }
  })

  /**
   * Follow a run or an arc, each addressed the way it is addressed everywhere else: a
   * volume by its edition id, an arc by the name its page is reached under.
   *
   * Attempts once on the way out. Following a run you are already part-way through
   * should do the obvious thing immediately rather than making you re-read an issue to
   * trigger it.
   */
  app.post<{ Body: FollowBody }>('/api/follows', async (req, reply) => {
    const body = req.body || {}
    if (!isKind(body.kind)) return reply.code(400).send({ error: 'follow a volume or an arc' })

    let follow: Follow
    if (body.kind === 'volume') {
      const edition = getEdition(app.db, Number(body.editionId))
      if (!edition) return reply.code(404).send({ error: 'edition not found' })
      // The whole mechanism rests on an issue list and a match rule, and both need the
      // volume. Accepting this follow would leave it permanently inert, which looks
      // exactly like a bug.
      if (edition.comicvineId == null) {
        return reply.code(409).send({ error: 'match this volume to Comic Vine before following it' })
      }
      follow = addFollow(app.db, 'volume', edition.id, edition.cvName || edition.name)
    } else {
      const name = (body.name ?? '').trim()
      if (!name) return reply.code(400).send({ error: 'which arc?' })
      const resolved = await resolveArcId(app.db, cv, name)
      if ('code' in resolved) return reply.code(resolved.code).send({ error: resolved.error })
      follow = addFollow(app.db, 'arc', resolved.id, name)
    }

    // Never lets a failed fetch fail the follow: the row is already saved, and the next
    // sweep tries again.
    try {
      await attemptFollow(app, follow, fetchPage)
    } catch (err) {
      app.log.warn({ err, kind: follow.kind, refId: follow.refId }, 'follow attempt failed')
    }
    return { follow }
  })

  app.delete<{ Params: FollowParams }>('/api/follows/:kind/:refId', async (req, reply) => {
    const { kind, refId } = req.params
    if (!isKind(kind)) return reply.code(400).send({ error: 'follow a volume or an arc' })
    if (!removeFollow(app.db, kind, Number(refId))) {
      return reply.code(404).send({ error: 'not following that' })
    }
    return { unfollowed: true }
  })
}
