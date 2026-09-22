/**
 * The publisher strip both Releases tabs sit above their content.
 *
 * It carries its own `aria-label` because it is a second tablist on the same page: the
 * outer strip chooses the view, this one chooses whose list you are reading, and a
 * screen reader that announced both as "tab list" would make them indistinguishable.
 */
export default function PublisherTabs({ names, current, onSelect }: {
  names: string[]
  current: string
  onSelect: (name: string) => void
}) {
  return (
    <div className="tabs tabs--nested" role="tablist" aria-label="Publisher">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={name === current}
          className={name === current ? 'tab tab--on' : 'tab'}
          onClick={() => onSelect(name)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}
