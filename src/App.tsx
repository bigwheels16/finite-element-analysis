import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_ELEMENTS, tetVolumeForEdge } from './analysis/pipeline'
import type { Action, AnalysisResult, MeshSummary, Restraint } from './analysis/types'
import type { Material } from './fem/types'
import type { Feature, Solid } from './geometry/types'
import FeaturePanel, { ShapeProperties } from './ui/FeaturePanel'
import { MATERIALS } from './ui/materials'
import { DEFAULT_FEATURES, boundingBox, defaultSetup, remapSetup } from './ui/model'
import NumberField from './ui/NumberField'
import ResultsPanel from './ui/ResultsPanel'
import { fieldRange, fieldValues, type Field } from './ui/results'
import SetupPanel from './ui/SetupPanel'
import SketchEditor from './ui/SketchEditor'
import Viewer3D, { type FaceTint, type ViewMode } from './ui/Viewer3D'
import { AnalysisClient } from './worker/client'

const SOURCE_URL = import.meta.env.VITE_SOURCE_URL as string | undefined

const AXES: Record<Feature['plane'], [string, string]> = { XY: ['X', 'Y'], XZ: ['X', 'Z'], YZ: ['Y', 'Z'] }

type Busy = null | 'building' | 'meshing' | 'solving'

export default function App() {
  const client = useMemo(() => new AnalysisClient(), [])

  const [features, setFeatures] = useState<Feature[]>(DEFAULT_FEATURES)
  const [activeFeature, setActiveFeature] = useState(DEFAULT_FEATURES[0].id)
  const [selectedShape, setSelectedShape] = useState<number | null>(null)
  const [elementSize, setElementSize] = useState(5)
  const [material, setMaterial] = useState<Material>(MATERIALS[0])
  const [restraints, setRestraints] = useState<Restraint[]>([])
  const [actions, setActions] = useState<Action[]>([])

  const [solid, setSolid] = useState<Solid | null>(null)
  const [mesh, setMesh] = useState<MeshSummary | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [mode, setMode] = useState<ViewMode>('geometry')
  const [selectedFaces, setSelectedFaces] = useState<Set<number>>(new Set())
  const [pickingPointFor, setPickingPointFor] = useState<string | null>(null)
  const [field, setField] = useState<Field>('vonMises')
  const [deformScale, setDeformScale] = useState(0)
  const [probe, setProbe] = useState<number | null>(null)

  const solidRef = useRef<Solid | null>(null)
  const setupRef = useRef({ restraints, actions })
  setupRef.current = { restraints, actions }

  // Rebuild the solid shortly after the features or faceting change
  const maxEdge = Math.max(0.25, elementSize * 0.75)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setBusy('building')
      client
        .build(features, maxEdge)
        .then((next) => {
          if (cancelled) return
          const previous = solidRef.current
          solidRef.current = next
          setSolid(next)
          setMesh(null)
          setResult(null)
          setMode('geometry')
          setError(null)
          if (previous === null) {
            const d = defaultSetup(next)
            setRestraints(d.restraints)
            setActions(d.actions)
          } else {
            const { restraints: r, actions: a } = setupRef.current
            const remapped = remapSetup(previous.faces, next, r, a)
            setRestraints(remapped.restraints)
            setActions(remapped.actions)
            setNotice(remapped.lost > 0 ? `${remapped.lost} support or load face(s) no longer exist after the edit; check the supports and loads.` : null)
          }
          setSelectedFaces(new Set())
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setBusy(null))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, features, maxEdge])

  // Supports, loads and material changes invalidate results but not the mesh
  useEffect(() => {
    setResult(null)
    setMode((m) => (m === 'results' ? 'geometry' : m))
  }, [restraints, actions, material])

  const runMesh = useCallback(async (): Promise<MeshSummary | null> => {
    setBusy('meshing')
    setError(null)
    try {
      const summary = await client.mesh(elementSize)
      setMesh(summary)
      return summary
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(null)
    }
  }, [client, elementSize])

  const onMesh = async () => {
    if (await runMesh()) setMode('mesh')
  }

  const onSolve = async () => {
    if (!mesh && !(await runMesh())) return
    setBusy('solving')
    setError(null)
    try {
      const r = await client.solve({ material, restraints, actions })
      setResult(r)
      setMode('results')
      setDeformScale(autoScaleFor(r))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const autoScaleFor = (r: AnalysisResult) => {
    const size = solidRef.current ? boundingBox(solidRef.current.vertices).size : 1
    return r.maxDisplacement > 0 ? +((0.05 * size) / r.maxDisplacement).toPrecision(2) : 0
  }

  const values = useMemo(() => (result ? fieldValues(result, field, material.yieldStrength / 1e6) : null), [result, field, material])
  const range = useMemo<[number, number]>(() => (values && mesh ? fieldRange(values, mesh.triangles) : [0, 1]), [values, mesh])

  const tints = useMemo<FaceTint[]>(() => [
    { faces: new Set(actions.flatMap((a) => (a.kind === 'point' ? [] : a.faces))), color: '#e08a2b' },
    { faces: new Set(restraints.flatMap((r) => r.faces)), color: '#3aa17e' },
  ], [restraints, actions])

  const onPickFace = useCallback((face: number, additive: boolean) => {
    setSelectedFaces((prev) => {
      const next = new Set(additive ? prev : [])
      if (additive && prev.has(face)) next.delete(face)
      else next.add(face)
      return next
    })
  }, [])

  const onPickPoint = useCallback((point: [number, number, number]) => {
    setPickingPointFor((id) => {
      if (id) setActions((as) => as.map((a) => (a.id === id && a.kind === 'point' ? { ...a, position: point } : a)))
      return null
    })
  }, [])

  const feature = features.find((f) => f.id === activeFeature) ?? features[0]
  const setShapes = (shapes: Feature['shapes']) => setFeatures(features.map((f) => (f.id === feature.id ? { ...f, shapes } : f)))
  const shape = selectedShape !== null ? feature.shapes[selectedShape] : undefined

  const estimate = solid ? Math.round((solid.volume * 2) / tetVolumeForEdge(elementSize)) : null

  return (
    <div className="app">
      <div className="disclaimer" role="note">
        Demonstration only. Results are not verified for design use; check any load-bearing design independently.
      </div>
      <header className="top">
        <h1>Finite Element Analysis</h1>
        <p>Linear static analysis of solid parts. Units: mm, N, MPa.</p>
      </header>
      <main className="layout">
        <div className="col left">
          <FeaturePanel features={features} activeId={feature.id} onActivate={(id) => { setActiveFeature(id); setSelectedShape(null) }} onChange={setFeatures} />
          <section className="panel" aria-labelledby="sketch-h">
            <h2 id="sketch-h">Sketch: {feature.name}</h2>
            <SketchEditor
              key={feature.id}
              shapes={feature.shapes}
              onChange={setShapes}
              selected={selectedShape}
              onSelect={setSelectedShape}
              axisLabels={AXES[feature.plane]}
            />
            {shape && (
              <ShapeProperties
                shape={shape}
                onChange={(s) => setShapes(feature.shapes.map((x, i) => (i === selectedShape ? s : x)))}
                onDelete={() => { setShapes(feature.shapes.filter((_, i) => i !== selectedShape)); setSelectedShape(null) }}
              />
            )}
          </section>
        </div>

        <div className="col center">
          <div className="view-tabs" role="tablist" aria-label="View">
            {(['geometry', 'mesh', 'results'] as ViewMode[]).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m}
                disabled={(m === 'mesh' && !mesh) || (m === 'results' && !result)}
                onClick={() => setMode(m)}>
                {{ geometry: 'Geometry', mesh: 'Mesh', results: 'Results' }[m]}
              </button>
            ))}
            <span className="status" aria-live="polite">
              {busy ? `${busy[0].toUpperCase()}${busy.slice(1)}…` : solid ? `Volume ${(solid.volume / 1000).toFixed(1)} cm³` : ''}
            </span>
          </div>
          <Viewer3D
            mode={mode}
            solid={solid}
            mesh={mesh}
            values={mode === 'results' ? values : null}
            range={range}
            reverse={field === 'fos'}
            displacement={result?.displacement ?? null}
            deformScale={deformScale}
            selected={selectedFaces}
            tints={tints}
            pickPoint={pickingPointFor !== null}
            onPickFace={onPickFace}
            onPickPoint={onPickPoint}
            onProbe={setProbe}
          />
          {error && <div className="error" role="alert">{error}</div>}
          {notice && <div className="notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}
          <div className="legend-key">
            <span className="swatch support" /> Supports <span className="swatch load" /> Loads <span className="swatch selected" /> Selected
          </div>
        </div>

        <div className="col right">
          <section className="panel" aria-labelledby="run-h">
            <h2 id="run-h">Mesh and solve</h2>
            <NumberField label="Element size" unit="mm" min={0.1} value={elementSize} onChange={setElementSize} />
            <p className="hint">
              {estimate !== null && `About ${estimate.toLocaleString()} elements expected (limit ${MAX_ELEMENTS.toLocaleString()}). `}
              Smaller elements give more accurate peak stresses but take longer to solve.
            </p>
            <div className="row">
              <button type="button" onClick={onMesh} disabled={!solid || busy !== null}>Mesh</button>
              <button type="button" className="primary" onClick={onSolve} disabled={!solid || busy !== null}>Solve</button>
            </div>
          </section>
          {result && mesh && mode === 'results' ? (
            <ResultsPanel
              result={result}
              mesh={mesh}
              field={field}
              onField={setField}
              range={range}
              deformScale={deformScale}
              onDeformScale={setDeformScale}
              autoScale={autoScaleFor(result)}
              probe={probe !== null && values ? { node: probe, value: values[probe] } : null}
              yieldMpa={material.yieldStrength / 1e6}
            />
          ) : (
            <SetupPanel
              material={material}
              onMaterial={setMaterial}
              restraints={restraints}
              onRestraints={setRestraints}
              actions={actions}
              onActions={setActions}
              selected={selectedFaces}
              onSelectFaces={(faces) => { setMode('geometry'); setSelectedFaces(new Set(faces)) }}
              pickingPointFor={pickingPointFor}
              onPickPointFor={(id) => { setMode('geometry'); setPickingPointFor(id) }}
            />
          )}
          {result && mode === 'results' && (
            <button type="button" className="link" onClick={() => setMode('geometry')}>Edit supports and loads</button>
          )}
        </div>
      </main>
      <footer>
        Licensed under the GNU AGPL v3.0 or later.{' '}
        {SOURCE_URL ? <a href={SOURCE_URL}>Source code</a> : 'Source code link not configured.'}{' '}
        Uses TetGen (AGPL-3.0), Manifold (Apache-2.0) and three.js (MIT).
      </footer>
    </div>
  )
}
