import type { AnalysisResult, MeshSummary } from '../analysis/types'
import { turboCss } from './colormap'
import NumberField from './NumberField'
import { FIELDS, FOS_CAP, formatNumber, type Field } from './results'

interface Props {
  result: AnalysisResult
  mesh: MeshSummary
  field: Field
  onField: (f: Field) => void
  range: [number, number]
  deformScale: number
  onDeformScale: (s: number) => void
  autoScale: number
  probe: { node: number; value: number } | null
  yieldMpa: number
}

export default function ResultsPanel(p: Props) {
  const { result } = p
  const info = FIELDS.find((f) => f.id === p.field)!
  const reverse = p.field === 'fos'
  const stops = Array.from({ length: 11 }, (_, i) => i / 10)
  // Forces below a millionth of the largest are round-off
  const forceScale = Math.max(...result.appliedForce.map(Math.abs), ...result.reactions.flatMap((r) => r.force.map(Math.abs)))
  const force = (f: number) => formatNumber(f, 1e-6 * forceScale)
  return (
    <section className="panel" aria-labelledby="results-h">
      <h2 id="results-h">Results</h2>
      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <dl className="summary">
        <dt>Min factor of safety</dt>
        <dd className={result.minFactorOfSafety < 1 ? 'bad' : result.minFactorOfSafety < 2 ? 'warn' : ''}>{formatNumber(result.minFactorOfSafety)}</dd>
        <dt>Max von Mises stress</dt>
        <dd>{formatNumber(result.maxVonMises)} MPa <span className="muted">(yield {formatNumber(p.yieldMpa)})</span></dd>
        <dt>Max displacement</dt>
        <dd>{formatNumber(result.maxDisplacement)} mm</dd>
        <dt>Mesh</dt>
        <dd>{p.mesh.elements} elements, {p.mesh.nodes} nodes</dd>
        <dt>Solve</dt>
        <dd>{(result.solveMs / 1000).toFixed(1)} s, {result.solverIterations} iterations</dd>
      </dl>

      <label className="field wide">
        <span>Show</span>
        <select value={p.field} onChange={(e) => p.onField(e.target.value as Field)}>
          {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <div className="legend" role="img" aria-label={`${info.label} from ${formatNumber(p.range[0])} to ${formatNumber(p.range[1])} ${info.unit}`}>
        <div className="legend-bar" style={{ background: `linear-gradient(to right, ${stops.map((t) => turboCss(reverse ? 1 - t : t)).join(', ')})` }} />
        <div className="legend-labels">
          <span>{formatNumber(p.range[0])}</span>
          <span>{info.unit}</span>
          <span>{p.field === 'fos' && p.range[1] >= FOS_CAP ? `≥ ${FOS_CAP}` : formatNumber(p.range[1])}</span>
        </div>
      </div>
      <p className="probe" aria-live="polite">
        {p.probe ? `Node ${p.probe.node}: ${formatNumber(p.probe.value)} ${info.unit}` : 'Hover the part to read values.'}
      </p>
      <div className="row">
        <NumberField label="Deformation scale" unit="×" min={0} value={+p.deformScale.toPrecision(3)} onChange={p.onDeformScale} />
        <button type="button" onClick={() => p.onDeformScale(p.autoScale)}>Auto</button>
        <button type="button" onClick={() => p.onDeformScale(1)}>True scale</button>
        <button type="button" onClick={() => p.onDeformScale(0)}>Undeformed</button>
      </div>

      <h3>Reactions</h3>
      <table className="reactions">
        <thead><tr><th></th><th>Fx (N)</th><th>Fy (N)</th><th>Fz (N)</th></tr></thead>
        <tbody>
          {result.reactions.map((r, i) => (
            <tr key={r.id}><th>Support {i + 1}</th>{r.force.map((f, c) => <td key={c}>{force(f)}</td>)}</tr>
          ))}
          <tr className="total"><th>Applied loads</th>{result.appliedForce.map((f, c) => <td key={c}>{force(f)}</td>)}</tr>
        </tbody>
      </table>
    </section>
  )
}
