import { useEffect, useState } from 'react'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  min?: number
  step?: number
}

// Number input that keeps partial text while typing and reports only valid numbers
export default function NumberField({ label, value, onChange, unit, min, step }: Props) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const n = Number(text)
  const invalid = text.trim() === '' || !Number.isFinite(n) || (min !== undefined && n < min)
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          step={step ?? 'any'}
          aria-invalid={invalid}
          onChange={(e) => {
            setText(e.target.value)
            const v = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onChange(v)
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  )
}
