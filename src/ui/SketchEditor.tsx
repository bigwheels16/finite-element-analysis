import { useEffect, useRef, useState } from 'react'
import type { Shape } from '../geometry/types'

export type Tool = 'select' | 'rect' | 'circle' | 'polygon'

interface Props {
  shapes: Shape[]
  onChange: (shapes: Shape[]) => void
  selected: number | null
  onSelect: (index: number | null) => void
  axisLabels: [string, string]
}

type Draft =
  | { kind: 'rect' | 'circle'; start: [number, number]; end: [number, number] }
  | { kind: 'polygon'; points: [number, number][]; cursor: [number, number] }

const SNAPS = [0.5, 1, 2, 5, 10, 20, 50, 100]

// Grid step giving roughly 20 lines across the view
function gridStep(span: number): number {
  return SNAPS.find((s) => span / s <= 24) ?? 100
}

function shapeBounds(shapes: Shape[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  for (const s of shapes) {
    if (s.kind === 'rect') { add(s.x, s.y); add(s.x + s.w, s.y + s.h) }
    else if (s.kind === 'circle') { add(s.cx - s.r, s.cy - s.r); add(s.cx + s.r, s.cy + s.r) }
    else for (const [x, y] of s.points) add(x, y)
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 100, 100]
}

export default function SketchEditor({ shapes, onChange, selected, onSelect, axisLabels }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [tool, setTool] = useState<Tool>('rect')
  const [hole, setHole] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  // Visible window in sketch coordinates: centre and width
  const [view, setView] = useState(() => {
    const [x0, y0, x1, y1] = shapeBounds(shapes)
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(x1 - x0, y1 - y0) * 1.4 + 10 }
  })
  const [size, setSize] = useState({ w: 400, h: 300 })
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  useEffect(() => {
    const el = svg.current!
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = size.w / view.w // px per mm
  const viewH = size.h / scale
  const step = gridStep(view.w)
  const snap = (v: number) => Math.round(v / (step / 2)) * (step / 2)

  const toSketch = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = svg.current!.getBoundingClientRect()
    const x = view.cx + (e.clientX - rect.left - size.w / 2) / scale
    const y = view.cy - (e.clientY - rect.top - size.h / 2) / scale
    return [snap(x), snap(y)]
  }

  const finishPolygon = (raw: [number, number][]) => {
    setDraft(null)
    // Drop repeated corners left by double-clicks
    const points = raw.filter(([x, y], i) => {
      const [px, py] = raw[(i + raw.length - 1) % raw.length]
      return raw.length === 1 || x !== px || y !== py
    })
    if (points.length >= 3) {
      onChange([...shapes, { kind: 'polygon', points, hole }])
      onSelect(shapes.length)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === 'Escape') setDraft(null)
      if (e.key === 'Enter' && draft?.kind === 'polygon') finishPolygon(draft.points)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null && !draft) {
        onChange(shapes.filter((_, i) => i !== selected))
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2 || (tool === 'select' && e.target === svg.current)) {
      pan.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }
      if (tool === 'select' && e.button === 0) onSelect(null)
      svg.current!.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const p = toSketch(e)
    if (tool === 'rect' || tool === 'circle') {
      setDraft({ kind: tool, start: p, end: p })
      svg.current!.setPointerCapture(e.pointerId)
    } else if (tool === 'polygon') {
      if (draft?.kind === 'polygon') {
        const [fx, fy] = draft.points[0]
        if (draft.points.length >= 3 && Math.hypot(p[0] - fx, p[1] - fy) * scale < 10) finishPolygon(draft.points)
        else setDraft({ ...draft, points: [...draft.points, p], cursor: p })
      } else setDraft({ kind: 'polygon', points: [p], cursor: p })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const { x, y, cx, cy } = pan.current
      setView({ ...view, cx: cx - (e.clientX - x) / scale, cy: cy + (e.clientY - y) / scale })
      return
    }
    if (!draft) return
    const p = toSketch(e)
    if (draft.kind === 'polygon') setDraft({ ...draft, cursor: p })
    else setDraft({ ...draft, end: p })
  }

  const onPointerUp = () => {
    if (pan.current) {
      pan.current = null
      return
    }
    if (!draft || draft.kind === 'polygon') return
    const [x0, y0] = draft.start, [x1, y1] = draft.end
    setDraft(null)
    let shape: Shape | null = null
    if (draft.kind === 'rect' && x0 !== x1 && y0 !== y1) {
      shape = { kind: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), hole }
    } else if (draft.kind === 'circle') {
      const r = Math.hypot(x1 - x0, y1 - y0)
      if (r > 0) shape = { kind: 'circle', cx: x0, cy: y0, r: +r.toFixed(3), hole }
    }
    if (shape) {
      onChange([...shapes, shape])
      onSelect(shapes.length)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    const mx = view.cx + (e.clientX - rect.left - size.w / 2) / scale
    const my = view.cy - (e.clientY - rect.top - size.h / 2) / scale
    const f = Math.exp(e.deltaY * 0.001)
    const w = Math.min(1e4, Math.max(2, view.w * f))
    const k = w / view.w
    setView({ w, cx: mx - (mx - view.cx) * k, cy: my - (my - view.cy) * k })
  }

  const fitView = () => {
    const [x0, y0, x1, y1] = shapeBounds(shapes)
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(x1 - x0, (y1 - y0) * (size.w / size.h)) * 1.3 + 10 })
  }

  // Sketch to screen
  const sx = (x: number) => (x - view.cx) * scale + size.w / 2
  const sy = (y: number) => size.h / 2 - (y - view.cy) * scale

  const grid: React.ReactNode[] = []
  const left = view.cx - view.w / 2, bottom = view.cy - viewH / 2
  for (let x = Math.ceil(left / step) * step; x <= left + view.w; x += step) {
    grid.push(<line key={`x${x}`} x1={sx(x)} x2={sx(x)} y1={0} y2={size.h} className={Math.abs(x) < 1e-9 ? 'axis' : 'grid'} />)
  }
  for (let y = Math.ceil(bottom / step) * step; y <= bottom + viewH; y += step) {
    grid.push(<line key={`y${y}`} y1={sy(y)} y2={sy(y)} x1={0} x2={size.w} className={Math.abs(y) < 1e-9 ? 'axis' : 'grid'} />)
  }

  const drawShape = (s: Shape, key: string | number, cls: string, onClick?: () => void) => {
    const common = {
      className: `${cls} ${s.hole ? 'hole' : 'solid'}`,
      onPointerDown: onClick && tool === 'select' ? (e: React.PointerEvent) => { e.stopPropagation(); onClick() } : undefined,
    }
    if (s.kind === 'rect') return <rect key={key} x={sx(s.x)} y={sy(s.y + s.h)} width={s.w * scale} height={s.h * scale} {...common} />
    if (s.kind === 'circle') return <circle key={key} cx={sx(s.cx)} cy={sy(s.cy)} r={s.r * scale} {...common} />
    return <polygon key={key} points={s.points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} {...common} />
  }

  let preview: React.ReactNode = null
  if (draft?.kind === 'rect') {
    const [x0, y0] = draft.start, [x1, y1] = draft.end
    preview = drawShape({ kind: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), hole }, 'draft', 'draft')
  } else if (draft?.kind === 'circle') {
    preview = drawShape({ kind: 'circle', cx: draft.start[0], cy: draft.start[1], r: Math.hypot(draft.end[0] - draft.start[0], draft.end[1] - draft.start[1]), hole }, 'draft', 'draft')
  } else if (draft?.kind === 'polygon') {
    preview = <polyline className={`draft ${hole ? 'hole' : 'solid'}`} points={[...draft.points, draft.cursor].map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} />
  }

  return (
    <div className="sketch">
      <div className="toolbar" role="toolbar" aria-label="Sketch tools">
        {(['select', 'rect', 'circle', 'polygon'] as Tool[]).map((t) => (
          <button key={t} type="button" aria-pressed={tool === t} onClick={() => { setTool(t); setDraft(null) }}>
            {{ select: 'Select', rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon' }[t]}
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={hole} onChange={(e) => setHole(e.target.checked)} /> Draw as hole
        </label>
        <button type="button" onClick={fitView}>Fit</button>
      </div>
      <svg
        ref={svg}
        className="sketch-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => draft?.kind === 'polygon' && finishPolygon(draft.points)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {grid}
        {shapes.map((s, i) => drawShape(s, i, i === selected ? 'shape selected' : 'shape', () => onSelect(i)))}
        {preview}
        <text x={size.w - 8} y={size.h - 8} textAnchor="end" className="sketch-label">
          {axisLabels[0]} → · {axisLabels[1]} ↑ · grid {step} mm
        </text>
      </svg>
      <p className="hint">
        {tool === 'polygon'
          ? 'Click to add corners; click the first corner, double-click or press Enter to close. Esc cancels.'
          : tool === 'select'
            ? 'Click a shape to edit it; Delete removes it. Drag empty space or right-drag to pan; scroll to zoom.'
            : 'Drag to draw. Points snap to half the grid. Right-drag to pan; scroll to zoom.'}
      </p>
    </div>
  )
}
