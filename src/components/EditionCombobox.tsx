import { useState } from 'react'

export interface EditionOption {
  id: number
  name: string
  bookCount?: number
}

interface EditionComboboxProps {
  value: string
  onChange: (value: string) => void
  options: EditionOption[]
  placeholder?: string
}

export default function EditionCombobox({
  value, onChange, options, placeholder,
}: EditionComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const query = value.trim().toLowerCase()
  const matches = query
    ? options.filter((o) => o.name.toLowerCase().includes(query))
    : options

  const select = (name: string) => {
    onChange(name)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(Math.max(i + step, 0), matches.length - 1))
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (e.key === 'Enter' && open && active >= 0 && matches[active]) {
      // Only swallow Enter when it lands on a highlighted option; otherwise it
      // must reach the form so the upload still submits from the keyboard.
      e.preventDefault()
      select(matches[active].name)
    }
  }

  return (
    <div className="combobox">
      <input
        className="input"
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1) }}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setOpen(true)
          // The highlight belongs to the list as it was; once the query changes the
          // old row is meaningless, so Enter submits the form instead of selecting.
          setActive(-1)
          onChange(e.target.value)
        }}
      />
      {open && matches.length > 0 && (
        <ul
          className="combobox__list"
          role="listbox"
          // Keep the pointer press from blurring the input, which would close the
          // list before the click could ever reach an option.
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((o, i) => (
            <li
              className={`combobox__option${i === active ? ' combobox__option--active' : ''}`}
              role="option"
              aria-selected={i === active}
              key={o.id}
              onClick={() => select(o.name)}
            >
              <span className="combobox__name">{o.name}</span>
              {o.bookCount != null && <span className="combobox__count">{o.bookCount}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
