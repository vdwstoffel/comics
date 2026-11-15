import type { ReadingList } from '../../server/readingLists/types.js'

/**
 * A reading list small enough to reason about: two core issues with a tie-in between them,
 * a phase that is nothing but tie-ins, then a finale the guide splits into two sections -
 * one core issue, then a section of nothing but a tie-in. Core reads 101, 102, 103; Full
 * reads 101, 901, 102, 902, 103, 904.
 *
 * Tests stand it in for the real lists with
 *   vi.mock('../server/readingLists/index.js', async () =>
 *     ({ READING_LISTS: [(await import('./helpers/readingListFixture')).LIST] }))
 */
export const LIST: ReadingList = {
  id: 7,
  slug: 'test-list',
  name: 'Test List',
  publisher: 'Marvel',
  years: '2013',
  description: 'A story across two series.',
  cover: 'https://cv/cover.jpg',
  phases: [
    {
      name: 'One',
      note: 'Where it starts.',
      issues: [
        { cv: 101, volume: 'Avengers', volumeId: 500, number: '1', coverDate: '2013-02-01' },
        { cv: 901, volume: 'Mighty Avengers', volumeId: 900, number: '1', coverDate: '2013-11-01', siteUrl: 'https://comicvine.gamespot.com/mighty-avengers-1/4000-901/', extra: true },
        { cv: 102, volume: 'Avengers', volumeId: 500, number: '2', coverDate: '2013-03-01', title: 'The Garden' },
      ],
    },
    {
      name: 'Tie-ins only',
      issues: [
        { cv: 902, volume: 'Infinity: The Hunt', volumeId: 950, number: '1', coverDate: '2013-12-01', extra: true },
      ],
    },
    {
      name: 'Two',
      note: 'The finale.',
      sections: [
        {
          name: 'Last Days',
          issues: [{ cv: 103, volume: 'Avengers', volumeId: 500, number: '3', coverDate: '2013-04-01' }],
        },
        {
          name: 'Battleworld',
          note: 'Tie-ins only.',
          issues: [{ cv: 904, volume: 'Secret Wars Journal', volumeId: 980, number: '1', coverDate: '2015-07-01', extra: true }],
        },
      ],
    },
  ],
}
