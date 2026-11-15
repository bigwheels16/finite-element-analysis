import type { Feature, Shape, SketchPlane } from '../geometry/types'
import NumberField from './NumberField'
import { newId } from './model'

interface Props {
  features: Feature[]
  activeId: string
  onActivate: (id: string) => void
  onChange: (features: Feature[]) => void
}

const PLANE_HINT: Record<SketchPlane, string> = {
  XY: 'sketch X, Y; extrudes +Z',
  XZ: 'sketch X, Z; extrudes −Y',
  YZ: 'sketch Y, Z; extrudes +X',
}

export default function FeaturePanel({ features, activeId, onActivate, onChange }: Props) {
  const active = features.find((f) => f.id === activeId)
  const update = (patch: Partial<Feature>) => onChange(features.map((f) => (f.id === activeId ? { ...f, ...patch } : f)))

  const add = () => {
    const f: Feature = {
      id: newId('f'),
      name: `Feature ${features.length + 1}`,
      plane: 'XY',
      offset: 0,
      depth: 10,
      operation: 'subtract',
      shapes: [],
    }
    onChange([...features, f])
    onActivate(f.id)
  }

  const remove = () => {
    const rest = features.filter((f) => f.id !== activeId)
    if (rest.length === 0) return
    onChange(rest)
    onActivate(rest[rest.length - 1].id)
  }

  return (
    <section className="panel" aria-labelledby="features-h">
      <h2 id="features-h">Features</h2>
      <ol className="feature-list">
        {features.map((f, i) => (
          <li key={f.id}>
            <button type="button" aria-pressed={f.id === activeId} onClick={() => onActivate(f.id)}>
              {i + 1}. {f.name} <span className="tag">{f.operation === 'add' ? 'add' : 'cut'}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" onClick={add}>Add feature</button>
        <button type="button" onClick={remove} disabled={features.length <= 1}>Delete feature</button>
      </div>
      {active && (
        <div className="grid2">
          <label className="field wide">
            <span>Name</span>
            <input value={active.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Operation</span>
            <select value={active.operation} onChange={(e) => update({ operation: e.target.value as Feature['operation'] })}>
              <option value="add">Add material</option>
              <option value="subtract">Cut material</option>
            </select>
          </label>
          <label className="field">
            <span>Sketch plane</span>
            <select value={active.plane} onChange={(e) => update({ plane: e.target.value as SketchPlane })}>
              {(['XY', 'XZ', 'YZ'] as SketchPlane[]).map((p) => (
                <option key={p} value={p}>{p} ({PLANE_HINT[p]})</option>
              ))}
            </select>
          </label>
          <NumberField label="Plane offset" unit="mm" value={active.offset} onChange={(offset) => update({ offset })} />
          <NumberField label="Extrude depth" unit="mm" min={0.001} value={active.depth} onChange={(depth) => update({ depth })} />
        </div>
      )}
    </section>
  )
}

interface ShapeProps {
  shape: Shape
  onChange: (shape: Shape) => void
  onDelete: () => void
}

export function ShapeProperties({ shape, onChange, onDelete }: ShapeProps) {
  return (
    <div className="shape-props">
      <div className="grid2">
        {shape.kind === 'rect' && (
          <>
            <NumberField label="Corner u" unit="mm" value={shape.x} onChange={(x) => onChange({ ...shape, x })} />
            <NumberField label="Corner v" unit="mm" value={shape.y} onChange={(y) => onChange({ ...shape, y })} />
            <NumberField label="Width" unit="mm" min={0.001} value={shape.w} onChange={(w) => onChange({ ...shape, w })} />
            <NumberField label="Height" unit="mm" min={0.001} value={shape.h} onChange={(h) => onChange({ ...shape, h })} />
          </>
        )}
        {shape.kind === 'circle' && (
          <>
            <NumberField label="Centre u" unit="mm" value={shape.cx} onChange={(cx) => onChange({ ...shape, cx })} />
            <NumberField label="Centre v" unit="mm" value={shape.cy} onChange={(cy) => onChange({ ...shape, cy })} />
            <NumberField label="Radius" unit="mm" min={0.001} value={shape.r} onChange={(r) => onChange({ ...shape, r })} />
          </>
        )}
        {shape.kind === 'polygon' &&
          shape.points.map(([u, v], i) => (
            <div className="pair wide" key={i}>
              <NumberField label={`Corner ${i + 1} u`} unit="mm" value={u} onChange={(nu) => onChange({ ...shape, points: shape.points.map((p, j) => (j === i ? [nu, p[1]] : p)) })} />
              <NumberField label="v" unit="mm" value={v} onChange={(nv) => onChange({ ...shape, points: shape.points.map((p, j) => (j === i ? [p[0], nv] : p)) })} />
            </div>
          ))}
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={shape.hole} onChange={(e) => onChange({ ...shape, hole: e.target.checked })} /> Hole
        </label>
        <button type="button" onClick={onDelete}>Delete shape</button>
      </div>
    </div>
  )
}
