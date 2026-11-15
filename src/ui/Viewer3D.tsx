import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { MeshSummary } from '../analysis/types'
import type { Solid } from '../geometry/types'
import { turbo } from './colormap'
import { boundingBox } from './model'

export type ViewMode = 'geometry' | 'mesh' | 'results'

export interface FaceTint {
  faces: Set<number>
  color: string
}

interface Props {
  mode: ViewMode
  solid: Solid | null
  mesh: MeshSummary | null
  // Results view: per-node values, their range, and the displacement field (mm) with its scale
  values: Float32Array | null
  range: [number, number]
  reverse: boolean
  displacement: Float32Array | null
  deformScale: number
  selected: Set<number>
  tints: FaceTint[]
  pickPoint: boolean
  onPickFace: (face: number, additive: boolean) => void
  onPickPoint: (point: [number, number, number]) => void
  onProbe: (node: number | null) => void
}

const BASE = new THREE.Color('#b9bec6')
const SELECTED = new THREE.Color('#2f7bf5')

interface Scene {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  group: THREE.Group
  render: () => void
}

export default function Viewer3D(props: Props) {
  const { mode, solid, mesh, values, range, reverse, displacement, deformScale, selected, tints } = props
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const pickables = useRef<THREE.Mesh | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const fittedFor = useRef<Solid | null>(null)

  // Renderer, camera and controls, created once
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(new THREE.Color(getComputedStyle(el).getPropertyValue('--viewer-bg').trim() || '#20232a'))
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6)
    camera.up.set(0, 0, 1)
    camera.position.set(200, -250, 200)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    camera.add(sun)
    sun.position.set(1, 2, 3)
    scene.add(camera)
    const group = new THREE.Group()
    scene.add(group)
    const controls = new OrbitControls(camera, renderer.domElement)
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    // Click (without dragging) picks; hover probes results
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null
    const hit = (e: PointerEvent) => {
      const target = pickables.current
      if (!target) return null
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.intersectObject(target)[0] ?? null
    }
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      down = null
      const p = propsRef.current
      const h = hit(e)
      if (!h || h.faceIndex == null) return
      if (p.mode === 'geometry' && p.solid) {
        if (p.pickPoint) p.onPickPoint([h.point.x, h.point.y, h.point.z])
        else p.onPickFace(p.solid.faceIds[h.faceIndex], e.shiftKey || e.ctrlKey || e.metaKey)
      }
    }
    const onMove = (e: PointerEvent) => {
      const p = propsRef.current
      if (p.mode !== 'results' || !p.mesh) return
      const h = hit(e)
      if (!h || h.faceIndex == null) {
        p.onProbe(null)
        return
      }
      // Nearest of the hit triangle's three nodes, in undeformed positions is close enough for display
      const tri = p.mesh.triangles.subarray(3 * h.faceIndex, 3 * h.faceIndex + 3)
      const pos = (h.object as THREE.Mesh).geometry.getAttribute('position')
      let best = tri[0], bestD = Infinity
      for (const n of tri) {
        const d = h.point.distanceTo(new THREE.Vector3(pos.getX(n), pos.getY(n), pos.getZ(n)))
        if (d < bestD) {
          bestD = d
          best = n
        }
      }
      p.onProbe(best)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)
    sceneRef.current = { renderer, scene, camera, controls, group, render }
    return () => {
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  // Rebuilds the drawn model when its inputs change
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    for (const child of [...s.group.children]) {
      s.group.remove(child)
      child.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose()
          ;(o.material as THREE.Material).dispose()
        }
      })
    }
    pickables.current = null
    if (mode === 'geometry' && solid) {
      const geometry = solidGeometry(solid, selected, tints)
      const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness: 0.7, metalness: 0.1 }))
      s.group.add(m)
      s.group.add(featureEdges(solid))
      pickables.current = m
    } else if ((mode === 'mesh' || mode === 'results') && mesh) {
      const geometry = meshGeometry(mesh, mode === 'results' ? displacement : null, deformScale)
      if (mode === 'results' && values) {
        const colors = new Float32Array(mesh.positions.length)
        const [lo, hi] = range
        const span = hi - lo || 1
        for (let n = 0; n < mesh.nodes; n++) {
          const t = (values[n] - lo) / span
          colors.set(turbo(reverse ? 1 - t : t), 3 * n)
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      }
      const m = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          vertexColors: mode === 'results',
          color: mode === 'results' ? 0xffffff : 0xb9bec6,
          roughness: 0.8,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      )
      s.group.add(m)
      if (mode === 'mesh') {
        s.group.add(new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x1c2733, transparent: true, opacity: 0.6 })))
      } else if (solid) {
        // Undeformed outline for reference
        const edges = featureEdges(solid)
        ;(edges.material as THREE.LineBasicMaterial).opacity = 0.35
        s.group.add(edges)
      }
      pickables.current = m
    }
    if (solid && fittedFor.current === null) {
      fit(s, solid)
      fittedFor.current = solid
    }
    s.render()
  }, [mode, solid, mesh, values, range, reverse, displacement, deformScale, selected, tints])

  const fitView = () => {
    const s = sceneRef.current
    if (s && solid) fit(s, solid)
  }

  return (
    <div className="viewer">
      <div ref={host} className="viewer-canvas" />
      <button type="button" className="viewer-fit" onClick={fitView}>Fit view</button>
      <div className="axes-key" aria-hidden="true">
        <span className="ax-x">X</span> <span className="ax-y">Y</span> <span className="ax-z">Z ↑</span>
      </div>
    </div>
  )
}

function fit(s: Scene, solid: Solid): void {
  const { min, max, size } = boundingBox(solid.vertices)
  const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
  const dir = new THREE.Vector3(0.9, -1.3, 1).normalize()
  // Distance that fits the bounding sphere in the narrower of the two view angles
  const halfFov = THREE.MathUtils.degToRad(s.camera.fov / 2)
  const halfAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * s.camera.aspect))
  s.camera.position.copy(center).addScaledVector(dir, (0.55 * size) / Math.sin(halfAngle))
  s.camera.near = size / 100
  s.camera.far = size * 100
  s.camera.updateProjectionMatrix()
  s.controls.target.copy(center)
  s.controls.update()
  s.render()
}

// Non-indexed so each triangle takes its face's colour
function solidGeometry(solid: Solid, selected: Set<number>, tints: FaceTint[]): THREE.BufferGeometry {
  const triCount = solid.triangles.length / 3
  const positions = new Float32Array(9 * triCount)
  const colors = new Float32Array(9 * triCount)
  const tintColors = tints.map((t) => ({ faces: t.faces, color: new THREE.Color(t.color) }))
  for (let t = 0; t < triCount; t++) {
    const face = solid.faceIds[t]
    let color = BASE
    for (const tint of tintColors) if (tint.faces.has(face)) color = tint.color
    if (selected.has(face)) color = SELECTED
    for (let k = 0; k < 3; k++) {
      const v = solid.triangles[3 * t + k]
      positions.set(solid.vertices.subarray(3 * v, 3 * v + 3), 9 * t + 3 * k)
      colors.set([color.r, color.g, color.b], 9 * t + 3 * k)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

// Edges between different faces
function featureEdges(solid: Solid): THREE.LineSegments {
  const edgeFaces = new Map<string, [number, number, number]>()
  const pts: number[] = []
  for (let t = 0; t < solid.triangles.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = solid.triangles[3 * t + k], b = solid.triangles[3 * t + ((k + 1) % 3)]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const seen = edgeFaces.get(key)
      if (!seen) edgeFaces.set(key, [a, b, solid.faceIds[t]])
      else if (seen[2] !== solid.faceIds[t]) {
        pts.push(...solid.vertices.subarray(3 * a, 3 * a + 3), ...solid.vertices.subarray(3 * b, 3 * b + 3))
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x11161c, transparent: true, opacity: 0.8 }))
}

function meshGeometry(mesh: MeshSummary, displacement: Float32Array | null, scale: number): THREE.BufferGeometry {
  const positions = Float32Array.from(mesh.positions)
  if (displacement) for (let i = 0; i < positions.length; i++) positions[i] += scale * displacement[i]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(mesh.triangles, 1))
  g.computeVertexNormals()
  return g
}
