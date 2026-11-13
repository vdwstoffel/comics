import type { ReadingList } from './types.js'
import { hickmansAvengers } from './hickmansAvengers.js'

/**
 * Every reading list the app knows. A new list is a new module beside this one, added
 * here - see .claude/skills/reading-list for how one is written.
 */
export const READING_LISTS: ReadingList[] = [hickmansAvengers]
