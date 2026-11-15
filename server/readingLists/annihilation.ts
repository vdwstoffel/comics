import type { ReadingList } from './types.js'

// Written by scripts/reading-list-entries.ts from scripts/reading-lists/annihilation.json and Comic Vine.
// Change the draft and write it again; never edit the entries.
export const annihilation: ReadingList = {
  id: 7,
  slug: 'annihilation',
  name: 'Annihilation',
  publisher: 'Marvel',
  years: '2006',
  description: 'From the Negative Zone, Annihilus sends a wave of destruction across the universe, and the Nova Corps is wiped out in an hour. The cosmic heroes who are left, a lone Nova among them, have to turn a rout into a war.',
  cover: 'https://comicvine.gamespot.com/a/uploads/scale_medium/0/77/99510-18291-107044-1-drax-the-destroyer.jpg',
  phases: [
    {
      name: 'The Wave',
      note: 'In Full, four limited series follow Nova, the Silver Surfer, the Super-Skrull and Ronan as the wave spreads.',
      issues: [
        { cv: 107044, volume: 'Drax the Destroyer', volumeId: 18291, number: '1', coverDate: '2005-11-30', title: 'Earthfall', siteUrl: 'https://comicvine.gamespot.com/drax-the-destroyer-1-earthfall/4000-107044/', extra: true },
        { cv: 107164, volume: 'Drax the Destroyer', volumeId: 18291, number: '2', coverDate: '2005-12-31', title: 'Illegal Aliens', siteUrl: 'https://comicvine.gamespot.com/drax-the-destroyer-2-illegal-aliens/4000-107164/', extra: true },
        { cv: 107165, volume: 'Drax the Destroyer', volumeId: 18291, number: '3', coverDate: '2006-01-31', title: 'From the Ashes', siteUrl: 'https://comicvine.gamespot.com/drax-the-destroyer-3-from-the-ashes/4000-107165/', extra: true },
        { cv: 107166, volume: 'Drax the Destroyer', volumeId: 18291, number: '4', coverDate: '2006-02-28', title: 'Hard penance', siteUrl: 'https://comicvine.gamespot.com/drax-the-destroyer-4-hard-penance/4000-107166/', extra: true },
        { cv: 107043, volume: 'Annihilation: Prologue', volumeId: 18290, number: '1', coverDate: '2006-05-01', title: 'Annihilation Day', siteUrl: 'https://comicvine.gamespot.com/annihilation-prologue-1-annihilation-day/4000-107043/' },
        { cv: 105470, volume: 'Annihilation: Nova', volumeId: 18017, number: '1', coverDate: '2006-06-30', title: 'All For One', siteUrl: 'https://comicvine.gamespot.com/annihilation-nova-1-all-for-one/4000-105470/', extra: true },
        { cv: 105476, volume: 'Annihilation: Nova', volumeId: 18017, number: '2', coverDate: '2006-07-31', title: 'And One For All', siteUrl: 'https://comicvine.gamespot.com/annihilation-nova-2-and-one-for-all/4000-105476/', extra: true },
        { cv: 105477, volume: 'Annihilation: Nova', volumeId: 18017, number: '3', coverDate: '2006-08-31', title: 'Safety In Numbers', siteUrl: 'https://comicvine.gamespot.com/annihilation-nova-3-safety-in-numbers/4000-105477/', extra: true },
        { cv: 105478, volume: 'Annihilation: Nova', volumeId: 18017, number: '4', coverDate: '2006-09-30', title: 'Ten Minutes and Counting', siteUrl: 'https://comicvine.gamespot.com/annihilation-nova-4-ten-minutes-and-counting/4000-105478/', extra: true },
        { cv: 125533, volume: 'Annihilation: Silver Surfer', volumeId: 20185, number: '1', coverDate: '2006-06-30', title: 'Opposing Force', siteUrl: 'https://comicvine.gamespot.com/annihilation-silver-surfer-1-opposing-force/4000-125533/', extra: true },
        { cv: 120431, volume: 'Annihilation: Silver Surfer', volumeId: 20185, number: '2', coverDate: '2006-07-31', title: 'The Culling', siteUrl: 'https://comicvine.gamespot.com/annihilation-silver-surfer-2-the-culling/4000-120431/', extra: true },
        { cv: 125535, volume: 'Annihilation: Silver Surfer', volumeId: 20185, number: '3', coverDate: '2006-08-31', title: 'Annihilation', siteUrl: 'https://comicvine.gamespot.com/annihilation-silver-surfer-3-annihilation/4000-125535/', extra: true },
        { cv: 125591, volume: 'Annihilation: Silver Surfer', volumeId: 20185, number: '4', coverDate: '2006-09-30', title: 'Resurrection', siteUrl: 'https://comicvine.gamespot.com/annihilation-silver-surfer-4-resurrection/4000-125591/', extra: true },
        { cv: 105471, volume: 'Annihilation: Super-Skrull', volumeId: 18018, number: '1', coverDate: '2006-06-30', siteUrl: 'https://comicvine.gamespot.com/annihilation-super-skrull-1/4000-105471/', extra: true },
        { cv: 120428, volume: 'Annihilation: Super-Skrull', volumeId: 18018, number: '2', coverDate: '2006-07-31', siteUrl: 'https://comicvine.gamespot.com/annihilation-super-skrull-2/4000-120428/', extra: true },
        { cv: 120429, volume: 'Annihilation: Super-Skrull', volumeId: 18018, number: '3', coverDate: '2006-08-31', siteUrl: 'https://comicvine.gamespot.com/annihilation-super-skrull-3/4000-120429/', extra: true },
        { cv: 120430, volume: 'Annihilation: Super-Skrull', volumeId: 18018, number: '4', coverDate: '2006-09-30', siteUrl: 'https://comicvine.gamespot.com/annihilation-super-skrull-4/4000-120430/', extra: true },
        { cv: 120432, volume: 'Annihilation: Ronan', volumeId: 20186, number: '1', coverDate: '2006-06-30', siteUrl: 'https://comicvine.gamespot.com/annihilation-ronan-1/4000-120432/', extra: true },
        { cv: 125235, volume: 'Annihilation: Ronan', volumeId: 20186, number: '2', coverDate: '2006-07-31', siteUrl: 'https://comicvine.gamespot.com/annihilation-ronan-2/4000-125235/', extra: true },
        { cv: 125236, volume: 'Annihilation: Ronan', volumeId: 20186, number: '3', coverDate: '2006-08-31', siteUrl: 'https://comicvine.gamespot.com/annihilation-ronan-3/4000-125236/', extra: true },
        { cv: 125237, volume: 'Annihilation: Ronan', volumeId: 20186, number: '4', coverDate: '2006-09-30', siteUrl: 'https://comicvine.gamespot.com/annihilation-ronan-4/4000-125237/', extra: true },
      ],
    },
    {
      name: 'Annihilation',
      issues: [
        { cv: 108532, volume: 'Annihilation', volumeId: 18137, number: '1', coverDate: '2006-10-31', title: 'Blood And Thunder', siteUrl: 'https://comicvine.gamespot.com/annihilation-1-blood-and-thunder/4000-108532/' },
        { cv: 108533, volume: 'Annihilation', volumeId: 18137, number: '2', coverDate: '2006-11-30', title: 'Centurions', siteUrl: 'https://comicvine.gamespot.com/annihilation-2-centurions/4000-108533/' },
        { cv: 108534, volume: 'Annihilation', volumeId: 18137, number: '3', coverDate: '2006-12-31', title: 'Desperate Measures', siteUrl: 'https://comicvine.gamespot.com/annihilation-3-desperate-measures/4000-108534/' },
        { cv: 108535, volume: 'Annihilation', volumeId: 18137, number: '4', coverDate: '2007-01-31', title: 'Revelation', siteUrl: 'https://comicvine.gamespot.com/annihilation-4-revelation/4000-108535/' },
        { cv: 106256, volume: 'Annihilation', volumeId: 18137, number: '5', coverDate: '2007-01-31', title: 'Ascension', siteUrl: 'https://comicvine.gamespot.com/annihilation-5-ascension/4000-106256/' },
        { cv: 106331, volume: 'Annihilation', volumeId: 18137, number: '6', coverDate: '2007-03-31', title: 'Finale', siteUrl: 'https://comicvine.gamespot.com/annihilation-6-finale/4000-106331/' },
      ],
    },
    {
      name: 'Aftermath',
      issues: [
        { cv: 106711, volume: 'Annihilation: Heralds of Galactus', volumeId: 18215, number: '1', coverDate: '2007-04-30', title: 'Heralds of Galactus: Terrax: Parasites and Stardust: A Death of Hope', siteUrl: 'https://comicvine.gamespot.com/annihilation-heralds-of-galactus-1-heralds-of-gala/4000-106711/', extra: true },
        { cv: 107996, volume: 'Annihilation: Heralds of Galactus', volumeId: 18215, number: '2', coverDate: '2007-05-31', title: "Afterburn & Brother's Keeper", siteUrl: 'https://comicvine.gamespot.com/annihilation-heralds-of-galactus-2-afterburn-broth/4000-107996/', extra: true },
        { cv: 120235, volume: 'What If? Annihilation', volumeId: 20151, number: '1', coverDate: '2008-01-31', title: 'What If Annihilation Reached Earth?', siteUrl: 'https://comicvine.gamespot.com/what-if-annihilation-1-what-if-annihilation-reache/4000-120235/', extra: true },
        { cv: 108362, volume: 'Nova', volumeId: 18462, number: '1', coverDate: '2007-06-01', title: "What's Next", siteUrl: 'https://comicvine.gamespot.com/nova-1-whats-next/4000-108362/', extra: true },
        { cv: 109264, volume: 'Nova', volumeId: 18462, number: '2', coverDate: '2007-07-01', title: 'Alienation', siteUrl: 'https://comicvine.gamespot.com/nova-2-alienation/4000-109264/', extra: true },
        { cv: 110434, volume: 'Nova', volumeId: 18462, number: '3', coverDate: '2007-08-01', title: 'Home Truths', siteUrl: 'https://comicvine.gamespot.com/nova-3-home-truths/4000-110434/', extra: true },
      ],
    },
  ],
}
