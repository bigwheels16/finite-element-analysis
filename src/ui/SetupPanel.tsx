import type { Action, Restraint } from '../analysis/types'
import type { Material } from '../fem/types'
import NumberField from './NumberField'
import { MATERIALS } from './materials'
import { newId } from './model'

interface Props {
  material: Material
  onMaterial: (m: Material) => void
  restraints: Restraint[]
  onRestraints: (r: Restraint[]) => void
  actions: Action[]
  onActions: (a: Action[]) => void
  selected: Set<number>
  onSelectFaces: (faces: number[]) => void
  pickingPointFor: string | null
  onPickPointFor: (id: string | null) => void
}

const CUSTOM = 'Custom'

export default function SetupPanel(p: Props) {
  const selectedFaces = [...p.selected].sort((a, b) => a - b)
  const presetName = MATERIALS.some((m) => m.name === p.material.name) ? p.material.name : CUSTOM
  const needFaces = selectedFaces.length === 0

  const updateAction = (id: string, patch: Partial<Action>) =>
    p.onActions(p.actions.map((a) => (a.id === id ? ({ ...a, ...patch } as Action) : a)))

  return (
    <section className="panel" aria-labelledby="setup-h">
      <h2 id="setup-h">Material</h2>
      <label className="field wide">
        <span>Material</span>
        <select
          value={presetName}
          onChange={(e) => {
            const preset = MATERIALS.find((m) => m.name === e.target.value)
            p.onMaterial(preset ?? { ...p.material, name: CUSTOM })
          }}
        >
          {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
          <option>{CUSTOM}</option>
        </select>
      </label>
      <div className="grid3">
        <NumberField label="Young's modulus" unit="GPa" min={0.001} value={+(p.material.youngsModulus / 1e9).toPrecision(6)}
          onChange={(v) => p.onMaterial({ ...p.material, name: CUSTOM, youngsModulus: v * 1e9 })} />
        <NumberField label="Poisson's ratio" min={0} value={p.material.poissonsRatio}
          onChange={(v) => p.onMaterial({ ...p.material, name: CUSTOM, poissonsRatio: v })} />
        <NumberField label="Yield strength" unit="MPa" min={0.001} value={+(p.material.yieldStrength / 1e6).toPrecision(6)}
          onChange={(v) => p.onMaterial({ ...p.material, name: CUSTOM, yieldStrength: v * 1e6 })} />
      </div>

      <h2>Supports</h2>
      <p className="hint">{needFaces ? 'Click faces in the 3D view (Shift-click for several), then add a support.' : `${selectedFaces.length} face(s) selected.`}</p>
      <div className="row">
        <button type="button" disabled={needFaces} onClick={() => p.onRestraints([...p.restraints, { id: newId('r'), kind: 'fixed', faces: selectedFaces }])}>Add fixed support</button>
        <button type="button" disabled={needFaces} onClick={() => p.onRestraints([...p.restraints, { id: newId('r'), kind: 'roller', faces: selectedFaces }])}>Add roller</button>
      </div>
      <ul className="items">
        {p.restraints.map((r, i) => (
          <li key={r.id} className="item support">
            <div className="item-head">
              <strong>Support {i + 1}</strong>
              <select value={r.kind} onChange={(e) => p.onRestraints(p.restraints.map((x) => (x.id === r.id ? { ...x, kind: e.target.value as Restraint['kind'] } : x)))}>
                <option value="fixed">Fixed</option>
                <option value="roller">Roller (normal only)</option>
              </select>
            </div>
            <div className="row">
              <button type="button" onClick={() => p.onSelectFaces(r.faces)}>Show {r.faces.length} face(s)</button>
              <button type="button" disabled={needFaces} onClick={() => p.onRestraints(p.restraints.map((x) => (x.id === r.id ? { ...x, faces: selectedFaces } : x)))}>Use selection</button>
              <button type="button" onClick={() => p.onRestraints(p.restraints.filter((x) => x.id !== r.id))}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Loads</h2>
      <div className="row">
        <button type="button" disabled={needFaces} onClick={() => p.onActions([...p.actions, { id: newId('a'), kind: 'force', faces: selectedFaces, force: [0, 0, -1000] }])}>Add force</button>
        <button type="button" disabled={needFaces} onClick={() => p.onActions([...p.actions, { id: newId('a'), kind: 'pressure', faces: selectedFaces, pressure: 1 }])}>Add pressure</button>
        <button type="button" onClick={() => {
          const id = newId('a')
          p.onActions([...p.actions, { id, kind: 'point', position: [0, 0, 0], force: [0, 0, -1000] }])
          p.onPickPointFor(id)
        }}>Add point load</button>
      </div>
      <ul className="items">
        {p.actions.map((a, i) => (
          <li key={a.id} className="item load">
            <div className="item-head">
              <strong>Load {i + 1}</strong>
              <span>{a.kind === 'force' ? 'Total force over faces' : a.kind === 'pressure' ? 'Pressure' : 'Point load'}</span>
            </div>
            {a.kind === 'pressure' && (
              <NumberField label="Pressure (positive pushes in)" unit="MPa" value={a.pressure} onChange={(pressure) => updateAction(a.id, { pressure })} />
            )}
            {a.kind !== 'pressure' && (
              <div className="grid3">
                {(['Fx', 'Fy', 'Fz'] as const).map((label, c) => (
                  <NumberField key={label} label={label} unit="N" value={a.force[c]}
                    onChange={(v) => updateAction(a.id, { force: a.force.map((f, k) => (k === c ? v : f)) as [number, number, number] })} />
                ))}
              </div>
            )}
            {a.kind === 'point' && (
              <p className="hint">
                {p.pickingPointFor === a.id
                  ? 'Click the part in the 3D view to place this load.'
                  : `At (${a.position.map((c) => c.toFixed(1)).join(', ')}) mm. Point loads give unrealistic local stress peaks.`}
              </p>
            )}
            <div className="row">
              {a.kind === 'point' ? (
                <button type="button" onClick={() => p.onPickPointFor(p.pickingPointFor === a.id ? null : a.id)}>
                  {p.pickingPointFor === a.id ? 'Cancel placing' : 'Place on part'}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => p.onSelectFaces(a.faces)}>Show {a.faces.length} face(s)</button>
                  <button type="button" disabled={needFaces} onClick={() => updateAction(a.id, { faces: selectedFaces })}>Use selection</button>
                </>
              )}
              <button type="button" onClick={() => p.onActions(p.actions.filter((x) => x.id !== a.id))}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
