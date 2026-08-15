import type { ComicMeta } from '../types.js'

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decode(m[1].trim()) : undefined
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function encode(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function parseComicInfo(xml: string): ComicMeta {
  const year = tag(xml, 'Year')
  const month = tag(xml, 'Month')
  const date = year ? (month ? `${year}-${String(month).padStart(2, '0')}` : year) : undefined
  return {
    title: tag(xml, 'Title'),
    series: tag(xml, 'Series'),
    number: tag(xml, 'Number'),
    writer: tag(xml, 'Writer'),
    penciller: tag(xml, 'Penciller'),
    summary: tag(xml, 'Summary'),
    publisher: tag(xml, 'Publisher'),
    date,
  }
}

export function buildComicInfo(m: ComicMeta): string {
  const parts = ['<?xml version="1.0" encoding="utf-8"?>', '<ComicInfo>']
  const add = (name: string, val: unknown) => { if (val != null && val !== '') parts.push(`  <${name}>${encode(val)}</${name}>`) }
  add('Title', m.title)
  add('Series', m.series)
  add('Number', m.number)
  add('Writer', m.writer)
  add('Penciller', m.penciller)
  add('Summary', m.summary)
  add('Publisher', m.publisher)
  if (m.date) {
    const [y, mo] = String(m.date).split('-')
    add('Year', y)
    if (mo) add('Month', String(Number(mo)))
  }
  parts.push('</ComicInfo>')
  return parts.join('\n')
}
