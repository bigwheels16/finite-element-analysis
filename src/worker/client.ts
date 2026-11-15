import type { AnalysisResult, AnalysisSetup, MeshSummary } from '../analysis/types'
import type { Feature, Solid } from '../geometry/types'
import type { Envelope, Request, Response } from './protocol'

// Promise interface to the analysis worker; requests run one at a time in order
export class AnalysisClient {
  private readonly worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>()

  constructor() {
    this.worker.onmessage = (event: MessageEvent<Envelope<Response>>) => {
      const reply = event.data
      const waiter = this.pending.get(reply.id)
      if (!waiter) throw new Error(`Analysis worker replied to unknown request ${reply.id}`)
      this.pending.delete(reply.id)
      if (reply.ok) waiter.resolve(reply.value)
      else waiter.reject(new Error(reply.error))
    }
    this.worker.onerror = (event) => {
      const error = new Error(`Analysis worker failed: ${event.message}`)
      for (const w of this.pending.values()) w.reject(error)
      this.pending.clear()
    }
  }

  private send(request: Request): Promise<Response> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, request })
    })
  }

  async build(features: Feature[], maxEdge: number): Promise<Solid> {
    const r = await this.send({ type: 'build', features, maxEdge })
    if (r.type !== 'build') throw new Error('Unexpected worker reply')
    return r.solid
  }

  async mesh(elementSize: number): Promise<MeshSummary> {
    const r = await this.send({ type: 'mesh', elementSize })
    if (r.type !== 'mesh') throw new Error('Unexpected worker reply')
    return r.summary
  }

  async solve(setup: AnalysisSetup): Promise<AnalysisResult> {
    const r = await this.send({ type: 'solve', setup })
    if (r.type !== 'solve') throw new Error('Unexpected worker reply')
    return r.result
  }
}
