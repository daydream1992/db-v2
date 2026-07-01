'use client'
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TABLES, TableMeta, REAL_TABLE_CONFIGS } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { GitBranch, ArrowDown, ArrowUp, Box, Search, Maximize2, ZoomIn, ZoomOut, Layers, Activity, Database, Map as MapIcon, X, LayoutGrid, Compass, Filter, Target, Circle, RotateCcw, CircleDot, Share2, Table2 } from 'lucide-react'
import { formatRows, healthColorClass, typeBadgeClass, healthTextColorClass } from '@/lib/dataops/styles'

// ─── Types ──────────────────────────────────────────────────────────
type NodeType = 'external' | 'table' | 'script'

interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  type: NodeType
  health: string
  dir?: string
  meta?: TableMeta
}

interface GraphEdge {
  from: string
  to: string
  // writes: script produces table (solid)
  // reads:  script consumes table (dashed)
  // internal: mock-derived dependency (solid)
  // external: external data source (dashed)
  type: 'internal' | 'external' | 'writes' | 'reads'
  label: string
}

interface RealLineageNode { id: string; label: string; group: 'table' | 'script' }
interface RealLineageEdge { from: string; to: string; type: 'writes' | 'reads' }
interface RealLineagePayload {
  nodes: RealLineageNode[]
  edges: RealLineageEdge[]
  note?: string
}

interface LineageViewProps {
  onNavigate?: (view: string, tableId?: string) => void
}

type LayoutMode = 'dag' | 'force' | 'circular'

// ─── Edge label helper: derive relationship type from source field ──
function getEdgeLabel(fromId: string, toId: string, edgeType: 'internal' | 'external'): string {
  if (edgeType === 'external') return '数据源'
  const toConfig = REAL_TABLE_CONFIGS[toId]
  if (toConfig) {
    const src = toConfig.source
    if (src.includes('SQL聚合')) return 'SQL聚合'
    if (src.includes('SQL派生')) return 'SQL派生'
    if (src.includes('视图')) return '视图派生'
    if (src.includes('pianpao_engine')) return '引擎计算'
  }
  const toMeta = TABLES.find(t => t.table === toId)
  if (toMeta) {
    if (toMeta.type === '视图') return '视图派生'
    if (toMeta.dir === '2_计算') return 'SQL派生'
  }
  return 'SQL依赖'
}

// ─── Mock-derived graph builder (fallback when backend fetch fails) ──
function buildMockGraph(): { nodes: GraphNode[]; edges: GraphEdge[]; externalNodes: string[] } {
  const ns: GraphNode[] = []
  const es: GraphEdge[] = []
  const extIds: string[] = []

  const extSet = new Set<string>()
  TABLES.forEach(t => t.sourceDeps.forEach(d => extSet.add(d)))
  const extList = Array.from(extSet)
  extList.forEach(id => extIds.push(id))

  extList.forEach((id, i) => {
    ns.push({
      id, label: id.length > 18 ? id.slice(0, 17) + '…' : id,
      x: 60 + i * 150, y: 60, type: 'external', health: 'external',
    })
  })

  TABLES.forEach(t => {
    ns.push({
      id: t.table, label: t.table,
      x: 0, y: 0, type: 'table', health: t.health,
      dir: t.dir, meta: t,
    })
  })

  TABLES.forEach(t => {
    t.sourceDeps.forEach(src => {
      es.push({ from: src, to: t.table, type: 'external', label: '数据源' })
    })
  })

  TABLES.forEach(t => {
    t.dependsOn.forEach(dep => {
      const label = getEdgeLabel(dep, t.table, 'internal')
      es.push({ from: dep, to: t.table, type: 'internal', label })
    })
  })

  return { nodes: ns, edges: es, externalNodes: extIds }
}

// ─── Real backend graph builder ─────────────────────────────────────
// Maps backend {nodes:[{id,label,group}], edges:[{from,to,type}]} into
// the renderer's GraphNode/GraphEdge shape. Table nodes are enriched with
// mock TableMeta (health/rows/dir/cn) when a matching mock table exists,
// so tooltips and health borders keep working. Script nodes get a distinct
// style. Edge type 'writes' (solid) vs 'reads' (dashed).
function buildRealGraph(payload: RealLineagePayload): { nodes: GraphNode[]; edges: GraphEdge[]; externalNodes: string[]; isReal: true } {
  const ns: GraphNode[] = []
  const es: GraphEdge[] = []
  const metaByTable = new Map<string, TableMeta>()
  TABLES.forEach(t => metaByTable.set(t.table, t))

  payload.nodes.forEach(n => {
    if (n.group === 'table') {
      const meta = metaByTable.get(n.id)
      ns.push({
        id: n.id,
        label: n.label || n.id,
        x: 0, y: 0,
        type: 'table',
        health: meta?.health ?? 'gray',
        dir: meta?.dir,
        meta,
      })
    } else {
      // script node — strip the "script:" prefix for display
      const raw = n.id.startsWith('script:') ? n.id.slice('script:'.length) : n.id
      ns.push({
        id: n.id,
        label: n.label || raw,
        x: 0, y: 0,
        type: 'script',
        health: 'script',
      })
    }
  })

  payload.edges.forEach(e => {
    es.push({
      from: e.from,
      to: e.to,
      type: e.type === 'writes' ? 'writes' : 'reads',
      label: e.type === 'writes' ? '写入' : '读取',
    })
  })

  return { nodes: ns, edges: es, externalNodes: [], isReal: true }
}

// ─── Topological Sort (DAG) Layout ──────────────────────────────────
function computeDagLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  viewW: number,
  viewH: number
): Record<string, { x: number; y: number }> {
  const nodeIds = new Set(nodes.map(n => n.id))
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  nodeIds.forEach(id => { inDegree.set(id, 0); adj.set(id, []) })
  edges.forEach(e => {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      adj.get(e.from)!.push(e.to)
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1)
    }
  })

  const layer = new Map<string, number>()
  const queue: string[] = []

  nodes.filter(n => n.type === 'external').forEach(n => {
    layer.set(n.id, 0)
  })

  nodeIds.forEach(id => {
    if ((inDegree.get(id) || 0) === 0 && !layer.has(id)) {
      const node = nodes.find(n => n.id === id)
      layer.set(id, node?.type === 'external' ? 0 : 1)
      queue.push(id)
    }
  })

  const tempInDegree = new Map(inDegree)
  while (queue.length > 0) {
    const curr = queue.shift()!
    const currLayer = layer.get(curr) || 0
    for (const next of (adj.get(curr) || [])) {
      const newLayer = currLayer + 1
      if (!layer.has(next) || (layer.get(next) || 0) < newLayer) {
        layer.set(next, newLayer)
      }
      const deg = (tempInDegree.get(next) || 1) - 1
      tempInDegree.set(next, deg)
      if (deg <= 0 && !queue.includes(next)) {
        queue.push(next)
      }
    }
  }

  nodes.forEach(n => {
    if (!layer.has(n.id)) layer.set(n.id, n.type === 'external' ? 0 : 1)
  })

  const layerGroups = new Map<number, string[]>()
  layer.forEach((l, id) => {
    if (!layerGroups.has(l)) layerGroups.set(l, [])
    layerGroups.get(l)!.push(id)
  })

  const maxLayer = Math.max(...Array.from(layerGroups.keys()), 0)
  const layerHeight = Math.min(160, (viewH - 120) / Math.max(maxLayer, 1))
  const gap = 150
  const overrides: Record<string, { x: number; y: number }> = {}

  layerGroups.forEach((ids, l) => {
    const y = 60 + l * layerHeight
    const sorted = ids.sort((a, b) => {
      const na = nodes.find(n => n.id === a)
      const nb = nodes.find(n => n.id === b)
      const dirA = na?.dir || na?.type === 'external' ? '0' : '1'
      const dirB = nb?.dir || nb?.type === 'external' ? '0' : '1'
      return dirA.localeCompare(dirB) || a.localeCompare(b)
    })
    const totalWidth = sorted.length * 120 + (sorted.length - 1) * (gap - 120)
    const startX = Math.max(60, (viewW - totalWidth) / 2)
    sorted.forEach((id, i) => {
      overrides[id] = { x: startX + i * gap, y }
    })
  })

  return overrides
}

// ─── Force-directed layout (simple simulation) ──────────────────────
function computeForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  viewW: number,
  viewH: number
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number; vx: number; vy: number }> = {}
  const cx = viewW / 2
  const cy = viewH / 2

  // Initialize in a circle
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length
    const r = Math.min(viewW, viewH) * 0.35
    positions[n.id] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      vx: 0,
      vy: 0,
    }
  })

  const adjacency = new Map<string, Set<string>>()
  nodes.forEach(n => adjacency.set(n.id, new Set()))
  edges.forEach(e => {
    adjacency.get(e.from)?.add(e.to)
    adjacency.get(e.to)?.add(e.from)
  })

  // Simple force simulation iterations
  for (let iter = 0; iter < 80; iter++) {
    const alpha = 1 - iter / 80
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions[nodes[i].id]
        const b = positions[nodes[j].id]
        let dx = a.x - b.x
        let dy = a.y - b.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (800 * alpha) / (dist * dist)
        dx = (dx / dist) * force
        dy = (dy / dist) * force
        a.vx += dx; a.vy += dy
        b.vx -= dx; b.vy -= dy
      }
    }
    // Attraction (edges)
    edges.forEach(e => {
      const a = positions[e.from]
      const b = positions[e.to]
      if (!a || !b) return
      let dx = b.x - a.x
      let dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = dist * 0.01 * alpha
      dx = (dx / dist) * force
      dy = (dy / dist) * force
      a.vx += dx; a.vy += dy
      b.vx -= dx; b.vy -= dy
    })
    // Center gravity
    nodes.forEach(n => {
      const p = positions[n.id]
      p.vx += (cx - p.x) * 0.001 * alpha
      p.vy += (cy - p.y) * 0.001 * alpha
    })
    // Apply velocity
    nodes.forEach(n => {
      const p = positions[n.id]
      p.vx *= 0.6
      p.vy *= 0.6
      p.x += p.vx
      p.y += p.vy
      p.x = Math.max(60, Math.min(viewW - 180, p.x))
      p.y = Math.max(40, Math.min(viewH - 60, p.y))
    })
  }

  const result: Record<string, { x: number; y: number }> = {}
  nodes.forEach(n => {
    const p = positions[n.id]
    result[n.id] = { x: p.x, y: p.y }
  })
  return result
}

// ─── Circular layout ────────────────────────────────────────────────
function computeCircularLayout(
  nodes: GraphNode[],
  _edges: GraphEdge[],
  viewW: number,
  viewH: number
): Record<string, { x: number; y: number }> {
  const cx = viewW / 2 - 60
  const cy = viewH / 2
  const r = Math.min(viewW, viewH) * 0.38
  const overrides: Record<string, { x: number; y: number }> = {}

  // Sort: external first, then by dir
  const sorted = [...nodes].sort((a, b) => {
    if (a.type === 'external' && b.type !== 'external') return -1
    if (a.type !== 'external' && b.type === 'external') return 1
    return (a.dir || '').localeCompare(b.dir || '')
  })

  sorted.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / sorted.length - Math.PI / 2
    overrides[n.id] = {
      x: cx + r * Math.cos(angle) - 60,
      y: cy + r * Math.sin(angle) - 20,
    }
  })
  return overrides
}

// ─── Depth filter: get nodes within N hops ──────────────────────────
function getNodesWithinHops(centerId: string, hops: number, allNodes: GraphNode[], allEdges: GraphEdge[]): Set<string> {
  const result = new Set<string>([centerId])
  const adjacency = new Map<string, string[]>()
  const reverseAdj = new Map<string, string[]>()

  allNodes.forEach(n => { adjacency.set(n.id, []); reverseAdj.set(n.id, []) })
  allEdges.forEach(e => {
    adjacency.get(e.from)?.push(e.to)
    reverseAdj.get(e.to)?.push(e.from)
  })

  const upQueue: [string, number][] = [[centerId, 0]]
  const upVisited = new Set<string>([centerId])
  while (upQueue.length > 0) {
    const [curr, d] = upQueue.shift()!
    if (d >= hops) continue
    for (const prev of (reverseAdj.get(curr) || [])) {
      if (!upVisited.has(prev)) {
        upVisited.add(prev)
        result.add(prev)
        upQueue.push([prev, d + 1])
      }
    }
  }

  const downQueue: [string, number][] = [[centerId, 0]]
  const downVisited = new Set<string>([centerId])
  while (downQueue.length > 0) {
    const [curr, d] = downQueue.shift()!
    if (d >= hops) continue
    for (const next of (adjacency.get(curr) || [])) {
      if (!downVisited.has(next)) {
        downVisited.add(next)
        result.add(next)
        downQueue.push([next, d + 1])
      }
    }
  }

  return result
}

// ─── Health border color for SVG ────────────────────────────────────
function healthBorderSVG(health: string): string {
  switch (health) {
    case 'green': return '#10b981'
    case 'red': return '#f43f5e'
    case 'yellow': return '#f59e0b'
    default: return '#d4d4d8'
  }
}

// ─── Main Component ─────────────────────────────────────────────────
export default function LineageView({ onNavigate }: LineageViewProps) {
  const [focus, setFocus] = useState<string>('stock_daily_kline')
  const [depth, setDepth] = useState(3)
  const [searchQuery, setSearchQuery] = useState('')
  const [zoom, setZoom] = useState(0.6)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState<string | null>(null)
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [showMinimap, setShowMinimap] = useState(true)
  const [useDepthFilter, setUseDepthFilter] = useState(false)
  const [depthFilterHops, setDepthFilterHops] = useState(2)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('dag')
  const [dirFilter, setDirFilter] = useState<string>('all')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ nodeId: string; startMouse: { x: number; y: number }; startNode: { x: number; y: number } } | null>(null)
  const isPanning = useRef(false)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // SVG dimensions
  const viewW = 2400
  const viewH = 1200

  // ─── Fetch real lineage from backend (fallback to mock-derived graph) ──
  const [realLineage, setRealLineage] = useState<RealLineagePayload | null>(null)
  const [lineageLoading, setLineageLoading] = useState(true)
  const [lineageError, setLineageError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLineageLoading(true)
    setLineageError(null)
    fetch('/api/dataops?op=lineage', { cache: 'no-store' })
      .then(async resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json() as Promise<RealLineagePayload>
      })
      .then(data => {
        if (cancelled) return
        if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error('lineage payload missing nodes/edges')
        }
        setRealLineage(data)
      })
      .catch(e => {
        if (cancelled) return
        setLineageError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelled) setLineageLoading(false) })
    return () => { cancelled = true }
  }, [])

  const lineageNote = realLineage?.note ?? null

  // ─── Build nodes & edges ─────────────────────────────────────────────
  // Real backend graph when available; otherwise fall back to the mock-derived graph.
  const { nodes, edges, externalNodes, isReal } = useMemo(() => {
    if (realLineage) {
      return buildRealGraph(realLineage)
    }
    return { ...buildMockGraph(), isReal: false }
  }, [realLineage])

  // ─── Layout computation ─────────────────────────────────────────────
  const layouts = useMemo(() => ({
    dag: computeDagLayout(nodes, edges, viewW, viewH),
    force: computeForceLayout(nodes, edges, viewW, viewH),
    circular: computeCircularLayout(nodes, edges, viewW, viewH),
  }), [nodes, edges])

  // Apply layout on mode change (use queueMicrotask to avoid set-state-in-effect)
  useEffect(() => {
    queueMicrotask(() => {
      setNodeOverrides(layouts[layoutMode])
      setPan({ x: 0, y: 0 })
    })
    // Auto-fit to view after layout change
    const timer = setTimeout(() => {
      const container = containerRef.current
      if (!container) return
      const cW = container.clientWidth
      const cH = container.clientHeight
      const scaleX = cW / viewW
      const scaleY = cH / viewH
      const newZoom = Math.min(scaleX, scaleY) * 0.92
      setZoom(Math.max(0.2, Math.min(2, newZoom)))
    }, 50)
    return () => clearTimeout(timer)
  }, [layoutMode, layouts])

  // Auto-fit on initial mount
  const [hasAutoFitted, setHasAutoFitted] = useState(false)
  useEffect(() => {
    if (hasAutoFitted) return
    const timer = setTimeout(() => {
      const container = containerRef.current
      if (!container) return
      const cW = container.clientWidth
      const cH = container.clientHeight
      const scaleX = cW / viewW
      const scaleY = cH / viewH
      const newZoom = Math.min(scaleX, scaleY) * 0.92
      setZoom(Math.max(0.2, Math.min(2, newZoom)))
      setHasAutoFitted(true)
    }, 150)
    return () => clearTimeout(timer)
  }, [hasAutoFitted])

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    nodes.forEach(n => m.set(n.id, n))
    return m
  }, [nodes])

  const getNodePos = useCallback((node: GraphNode) => {
    return nodeOverrides[node.id] || { x: node.x, y: node.y }
  }, [nodeOverrides])

  const focused = TABLES.find(t => t.table === focus)

  // ─── Directory filter ───────────────────────────────────────────────
  const dirFilteredNodeIds = useMemo(() => {
    if (dirFilter === 'all') return null
    const result = new Set<string>()
    nodes.forEach(n => {
      if (n.type === 'external') {
        if (dirFilter === '1_入库') result.add(n.id)
        return
      }
      if (dirFilter === '1_入库' && n.dir === '1_入库') result.add(n.id)
      else if (dirFilter === '2_计算' && n.dir === '2_计算') result.add(n.id)
      else if (dirFilter === '3_策略' && (n.dir === '3_策略' || n.dir === '4_工具')) result.add(n.id)
    })
    // Also add edges that connect to included nodes
    const edgeConnected = new Set<string>()
    edges.forEach(e => {
      if (result.has(e.from) || result.has(e.to)) {
        edgeConnected.add(e.from)
        edgeConnected.add(e.to)
      }
    })
    edgeConnected.forEach(id => result.add(id))
    return result
  }, [dirFilter, nodes, edges])

  // ─── Search highlight ───────────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const q = searchQuery.toLowerCase()
    const results = new Set<string>()
    nodes.forEach(n => {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        results.add(n.id)
        edges.forEach(e => {
          if (e.from === n.id) results.add(e.to)
          if (e.to === n.id) results.add(e.from)
        })
      }
    })
    return results
  }, [searchQuery, nodes, edges])

  // ─── Depth filter ───────────────────────────────────────────────────
  const depthFilteredNodes = useMemo(() => {
    if (!useDepthFilter) return null
    return getNodesWithinHops(focus, depthFilterHops, nodes, edges)
  }, [useDepthFilter, focus, depthFilterHops, nodes, edges])

  // ─── Highlight logic ────────────────────────────────────────────────
  const upstream = useMemo(() => {
    const set = new Set<string>()
    // Build reverse adjacency from the actual edges (works for real + mock graphs).
    const reverse = new Map<string, string[]>()
    edges.forEach(e => {
      if (!reverse.has(e.to)) reverse.set(e.to, [])
      reverse.get(e.to)!.push(e.from)
    })
    const collect = (id: string, d: number) => {
      if (d <= 0) return
      for (const prev of (reverse.get(id) || [])) {
        if (set.has(prev)) continue
        set.add(prev)
        collect(prev, d - 1)
      }
    }
    collect(focus, depth)
    return set
  }, [focus, depth, edges])

  const downstream = useMemo(() => {
    const set = new Set<string>()
    const forward = new Map<string, string[]>()
    edges.forEach(e => {
      if (!forward.has(e.from)) forward.set(e.from, [])
      forward.get(e.from)!.push(e.to)
    })
    const collect = (id: string, d: number) => {
      if (d <= 0) return
      for (const next of (forward.get(id) || [])) {
        if (set.has(next)) continue
        set.add(next)
        collect(next, d - 1)
      }
    }
    collect(focus, depth)
    return set
  }, [focus, depth, edges])

  const highlightSet = useMemo(() => {
    const s = new Set<string>([focus])
    upstream.forEach(t => s.add(t))
    downstream.forEach(t => s.add(t))
    if (selectedNode) {
      s.add(selectedNode)
      // Add direct neighbors of selected node
      edges.forEach(e => {
        if (e.from === selectedNode) s.add(e.to)
        if (e.to === selectedNode) s.add(e.from)
      })
    }
    return s
  }, [focus, upstream, downstream, selectedNode, edges])

  const isHighlighted = useCallback((id: string) => {
    if (searchQuery.trim() && searchResults.has(id)) return true
    return highlightSet.has(id) || hovered === id
  }, [highlightSet, hovered, searchQuery, searchResults])

  const isDimmed = useCallback((id: string) => {
    if (depthFilteredNodes && !depthFilteredNodes.has(id)) return true
    if (dirFilteredNodeIds && !dirFilteredNodeIds.has(id)) return true
    if (searchQuery.trim()) return !searchResults.has(id)
    return (highlightSet.size > 1 || hovered !== null || selectedNode !== null) && !isHighlighted(id)
  }, [highlightSet, hovered, searchQuery, searchResults, depthFilteredNodes, dirFilteredNodeIds, isHighlighted, selectedNode])

  // ─── Check if edge is connected to selected/hovered node ────────────
  const isEdgeConnected = useCallback((edge: GraphEdge) => {
    const activeId = selectedNode || hovered
    if (!activeId) return false
    return edge.from === activeId || edge.to === activeId
  }, [selectedNode, hovered])

  // ─── Node click: navigate to catalog or set focus ──────────────────
  const onNodeClick = useCallback((id: string) => {
    const node = nodeById.get(id)
    if (!node) return
    // Select/toggle any real-graph node (table or script).
    setSelectedNode(prev => prev === id ? null : id)
    // Focus + catalog navigation only for table nodes (script nodes have no catalog entry).
    if (node.type === 'table') {
      setFocus(id)
      if (onNavigate) onNavigate('catalog', id)
    }
  }, [nodeById, onNavigate])

  // ─── Drag handling ──────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    const node = nodeById.get(nodeId)
    if (!node) return
    const svg = svgRef.current
    if (!svg) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const svgP = pt.matrixTransform(ctm.inverse())
    const pos = getNodePos(node)
    dragStartRef.current = {
      nodeId,
      startMouse: { x: svgP.x, y: svgP.y },
      startNode: { x: pos.x, y: pos.y },
    }
    setDragging(nodeId)
  }, [nodeById, getNodePos])

  const onSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStartRef.current) {
      const svg = svgRef.current
      if (!svg) return
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const svgP = pt.matrixTransform(ctm.inverse())
      const ds = dragStartRef.current
      const dx = svgP.x - ds.startMouse.x
      const dy = svgP.y - ds.startMouse.y
      setNodeOverrides(prev => ({
        ...prev,
        [ds.nodeId]: {
          x: Math.max(0, Math.min(viewW - 160, ds.startNode.x + dx)),
          y: Math.max(40, Math.min(viewH - 60, ds.startNode.y + dy)),
        },
      }))
      return
    }
    if (isPanning.current && panStart.current) {
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      setPan({
        x: panStart.current.panX + dx / zoom,
        y: panStart.current.panY + dy / zoom,
      })
    }
  }, [zoom])

  const onSvgMouseUp = useCallback(() => {
    dragStartRef.current = null
    setDragging(null)
    isPanning.current = false
    panStart.current = null
  }, [])

  const onSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName === 'svg' || (e.target as SVGElement).closest('g[data-layer]')) {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    }
  }, [pan])

  // ─── Fit to view ───────────────────────────────────────────────────
  const fitToView = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cW = container.clientWidth
    const cH = container.clientHeight
    const scaleX = cW / viewW
    const scaleY = cH / viewH
    const newZoom = Math.min(scaleX, scaleY) * 0.95
    setZoom(Math.max(0.3, Math.min(2, newZoom)))
    setPan({ x: 0, y: 0 })
  }, [])

  // ─── Reset view ────────────────────────────────────────────────────
  const resetView = useCallback(() => {
    setNodeOverrides(layouts[layoutMode])
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setFocus('stock_daily_kline')
    setSearchQuery('')
    setUseDepthFilter(false)
    setDirFilter('all')
    setSelectedNode(null)
  }, [layoutMode, layouts])

  // ─── Minimap click-to-jump ─────────────────────────────────────────
  const onMinimapClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const minimapSvg = e.currentTarget
    const rect = minimapSvg.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const scaleX = viewW / rect.width
    const scaleY = viewH / rect.height
    const svgX = clickX * scaleX
    const svgY = clickY * scaleY
    const container = containerRef.current
    if (!container) return
    const targetScrollLeft = svgX * zoom - container.clientWidth / 2
    const targetScrollTop = svgY * zoom - container.clientHeight / 2
    container.scrollTo({ left: Math.max(0, targetScrollLeft), top: Math.max(0, targetScrollTop), behavior: 'smooth' })
  }, [zoom])

  // ─── Apply layout ──────────────────────────────────────────────────
  const applyLayout = useCallback((mode: LayoutMode) => {
    setLayoutMode(mode)
  }, [])

  // ─── Compute viewport rect for minimap ─────────────────────────────
  const [viewportRect, setViewportRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    const updateViewport = () => {
      const container = containerRef.current
      if (!container) return
      setViewportRect({
        x: container.scrollLeft / zoom,
        y: container.scrollTop / zoom,
        w: container.clientWidth / zoom,
        h: container.clientHeight / zoom,
      })
    }
    updateViewport()
    const container = containerRef.current
    if (container) {
      container.addEventListener('scroll', updateViewport)
      window.addEventListener('resize', updateViewport)
    }
    return () => {
      if (container) container.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [zoom, nodeOverrides, focus, depthFilteredNodes])

  // ─── Node grouping by dir/type ─────────────────────────────────────
  const dirGroups = useMemo(() => {
    const groups: { dir: string; color: string; bgColor: string; nodes: string[] }[] = [
      { dir: '外部数据源', color: '#7dd3fc', bgColor: 'rgba(125,211,252,0.06)', nodes: [] },
      { dir: '脚本', color: '#a78bfa', bgColor: 'rgba(167,139,250,0.06)', nodes: [] },
      { dir: '1_入库', color: '#34d399', bgColor: 'rgba(52,211,153,0.06)', nodes: [] },
      { dir: '2_计算', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.06)', nodes: [] },
    ]
    nodes.forEach(n => {
      if (n.type === 'external') {
        groups[0].nodes.push(n.id)
      } else if (n.type === 'script') {
        groups[1].nodes.push(n.id)
      } else if (n.dir === '1_入库') {
        groups[2].nodes.push(n.id)
      } else if (n.dir === '2_计算' || n.dir === '3_策略' || n.dir === '4_工具') {
        groups[3].nodes.push(n.id)
      }
    })
    return groups
  }, [nodes])

  const dirGroupBounds = useMemo(() => {
    return dirGroups.map(g => {
      if (g.nodes.length === 0) return { ...g, bounds: null }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      g.nodes.forEach(id => {
        const node = nodeById.get(id)
        if (!node) return
        const pos = getNodePos(node)
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + 150)
        maxY = Math.max(maxY, pos.y + 50)
      })
      return { ...g, bounds: { x: minX - 15, y: minY - 25, w: maxX - minX + 30, h: maxY - minY + 40 } }
    }).filter(g => g.bounds !== null)
  }, [dirGroups, nodeById, getNodePos])

  // ─── Wheel zoom ────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom(z => Math.max(0.3, Math.min(2.5, z + (e.deltaY > 0 ? -0.1 : 0.1))))
    }
  }, [])

  // ─── Node width (wider to fit icons) ───────────────────────────────
  const NW = 180
  const NH = 56

  // ─── Tooltip data for hovered node ─────────────────────────────────
  const hoveredNode = hovered ? nodeById.get(hovered) : null
  const hoveredMeta = hoveredNode?.meta

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ─── Control bar ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="搜索表名高亮..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Directory filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 flex items-center gap-1"><Database className="h-3 w-3" />目录</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {[
                  { key: 'all', label: '全部' },
                  { key: '1_入库', label: '入库' },
                  { key: '2_计算', label: '计算' },
                  { key: '3_策略', label: '策略' },
                ].map(d => (
                  <button key={d.key} onClick={() => setDirFilter(d.key)} className={`px-2 py-0.5 text-xs rounded ${dirFilter === d.key ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{d.label}</button>
                ))}
              </div>
            </div>

            {/* Depth selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 flex items-center gap-1"><Layers className="h-3 w-3" />展开</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {[1, 2, 3, 4].map(d => (
                  <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-0.5 text-xs rounded ${depth === d ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{d}</button>
                ))}
              </div>
            </div>

            {/* Depth filter toggle with slider */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={useDepthFilter ? 'default' : 'outline'}
                className="h-7 text-xs gap-1"
                onClick={() => setUseDepthFilter(!useDepthFilter)}
              >
                <Filter className="h-3 w-3" />
                深度过滤
              </Button>
              {useDepthFilter && (
                <div className="flex items-center gap-2 min-w-[120px]">
                  <Slider
                    value={[depthFilterHops]}
                    min={1}
                    max={6}
                    step={1}
                    onValueChange={v => setDepthFilterHops(v[0])}
                    className="w-20"
                  />
                  <span className="text-[10px] text-zinc-500 font-mono w-4">{depthFilterHops}</span>
                </div>
              )}
            </div>

            {/* Layout mode buttons */}
            <div className="flex items-center gap-1 border-l pl-3">
              <span className="text-xs text-zinc-400 mr-1">布局</span>
              {[
                { mode: 'dag' as LayoutMode, label: '层次', icon: LayoutGrid },
                { mode: 'force' as LayoutMode, label: '力导向', icon: Share2 },
                { mode: 'circular' as LayoutMode, label: '环形', icon: CircleDot },
              ].map(l => (
                <Tooltip key={l.mode}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={layoutMode === l.mode ? 'default' : 'ghost'}
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => applyLayout(l.mode)}
                    >
                      <l.icon className="h-3 w-3" />
                      <span className="hidden sm:inline">{l.label}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{l.label}布局</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 border-l pl-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setZoom(z => Math.max(0.3, z - 0.2))}>
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>缩小</TooltipContent>
              </Tooltip>
              <span className="text-xs text-zinc-500 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setZoom(z => Math.min(2.5, z + 0.2))}>
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>放大</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={fitToView} title="适应视口">
                    <Compass className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>适应视口</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={resetView} title="重置视图">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>重置视图</TooltipContent>
              </Tooltip>
            </div>

            <Badge variant="secondary" className="text-xs">
              <Target className="h-3 w-3 mr-1" />
              焦点：{focus}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* ─── SVG Graph ─────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-fuchsia-500" />
              血缘关系图谱
              <Badge variant="outline" className="ml-2 text-[10px]">
                {depthFilteredNodes ? depthFilteredNodes.size : nodes.length} 节点 · {edges.length} 边
              </Badge>
              {isReal ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 cursor-help">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> 实时源码扫描
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{lineageNote ?? '静态扫描源码字符串/FROM/JOIN，尽力而为，可能漏报动态表名'}</TooltipContent>
                </Tooltip>
              ) : lineageError ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="ml-1 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 cursor-help">
                      离线 Mock 图谱
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">后端血缘加载失败，已回退示例图：{lineageError}</TooltipContent>
                </Tooltip>
              ) : null}
              {useDepthFilter && (
                <Badge className="ml-1 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <Filter className="h-2.5 w-2.5 mr-1" />
                  {depthFilterHops} 跳
                </Badge>
              )}
              {dirFilter !== 'all' && (
                <Badge className="ml-1 text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  {dirFilter}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div
              ref={containerRef}
              className="relative overflow-auto"
              style={{ height: 'calc(100vh - 280px)', minHeight: 400 }}
              onWheel={onWheel}
            >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${viewW} ${viewH}`}
                width={viewW * zoom}
                height={viewH * zoom}
                className="block"
                style={{ minWidth: viewW * 0.3 }}
                onMouseMove={onSvgMouseMove}
                onMouseUp={onSvgMouseUp}
                onMouseLeave={onSvgMouseUp}
                onMouseDown={onSvgMouseDown}
              >
                <defs>
                  {/* Grid background pattern */}
                  <pattern id="grid-small" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0,0,0,0.04)" strokeWidth={0.5} />
                  </pattern>
                  <pattern id="grid-large" width="100" height="100" patternUnits="userSpaceOnUse">
                    <rect width="100" height="100" fill="url(#grid-small)" />
                    <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={0.5} />
                  </pattern>
                  {/* Arrow markers for different edge states */}
                  <marker id="arrow-internal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                  </marker>
                  <marker id="arrow-external" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                  </marker>
                  <marker id="arrow-highlight" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#d946ef" />
                  </marker>
                  <marker id="arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                  </marker>
                </defs>

                {/* Grid background */}
                <rect width={viewW} height={viewH} fill="#fafafa" className="dark:fill-zinc-950/80" />
                <rect width={viewW} height={viewH} fill="url(#grid-large)" />

                {/* Dir group background regions */}
                {dirGroupBounds.map(g => g.bounds && (
                  <g key={g.dir} data-layer="true">
                    <rect
                      x={g.bounds.x}
                      y={g.bounds.y}
                      width={g.bounds.w}
                      height={g.bounds.h}
                      rx={12}
                      fill={g.bgColor}
                      stroke={g.color}
                      strokeWidth={1}
                      strokeDasharray="6 3"
                      opacity={0.7}
                    />
                    <text
                      x={g.bounds.x + 8}
                      y={g.bounds.y + 12}
                      className="font-mono"
                      style={{ fontSize: 10, fill: g.color, opacity: 0.8 }}
                    >
                      {g.dir}
                    </text>
                  </g>
                ))}

                {/* ─── Edges ─────────────────────────────────────── */}
                {edges.map((edge, i) => {
                  const from = nodeById.get(edge.from)
                  const to = nodeById.get(edge.to)
                  if (!from || !to) return null

                  if (depthFilteredNodes) {
                    if (!depthFilteredNodes.has(edge.from) && !depthFilteredNodes.has(edge.to)) return null
                  }
                  if (dirFilteredNodeIds) {
                    if (!dirFilteredNodeIds.has(edge.from) && !dirFilteredNodeIds.has(edge.to)) return null
                  }

                  const fromPos = getNodePos(from)
                  const toPos = getNodePos(to)
                  const isHL = (isHighlighted(edge.from) && isHighlighted(edge.to)) || hovered === edge.from || hovered === edge.to
                  const isConnectedToSelected = isEdgeConnected(edge)
                  const isEdgeDim = isDimmed(edge.from) || isDimmed(edge.to)

                  // Bezier curve
                  const x1 = fromPos.x + NW / 2
                  const y1 = fromPos.y + NH
                  const x2 = toPos.x + NW / 2
                  const y2 = toPos.y - 2
                  const midY = (y1 + y2) / 2
                  const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`

                  const labelX = (x1 + x2) / 2
                  const labelY = midY

                  // Edge color logic
                  // reads = dashed (consumer), writes/external = solid variants
                  const isDashed = edge.type === 'reads' || edge.type === 'external'
                  let edgeColor = edge.type === 'external' ? '#7dd3fc' : edge.type === 'reads' ? '#a78bfa' : '#94a3b8'
                  let edgeWidth = 1.5
                  let arrowId = edge.type === 'external' ? 'arrow-external' : 'arrow-internal'

                  if (isConnectedToSelected && !isEdgeDim) {
                    edgeColor = '#f59e0b'
                    edgeWidth = 2.5
                    arrowId = 'arrow-selected'
                  } else if (isHL && !isEdgeDim) {
                    edgeColor = '#d946ef'
                    edgeWidth = 2
                    arrowId = 'arrow-highlight'
                  }

                  return (
                    <g key={`edge-${i}`}>
                      <path
                        d={path}
                        fill="none"
                        stroke={edgeColor}
                        strokeWidth={edgeWidth}
                        strokeDasharray={isDashed ? '4 3' : 'none'}
                        opacity={isEdgeDim ? 0.1 : 1}
                        markerEnd={`url(#${arrowId})`}
                        style={{ transition: 'opacity 0.2s, stroke 0.2s, stroke-width 0.2s' }}
                      />
                      {/* Edge label */}
                      {edge.label && !isEdgeDim && (isHL || isConnectedToSelected || zoom >= 0.8) && (
                        <g>
                          {/* Label background pill */}
                          <rect
                            x={labelX - (edge.label.length * 4.5) / 2 - 3}
                            y={labelY - 10}
                            width={edge.label.length * 4.5 + 6}
                            height={14}
                            rx={4}
                            fill={isConnectedToSelected ? 'rgba(245,158,11,0.12)' : isHL ? 'rgba(217,70,239,0.08)' : 'rgba(255,255,255,0.85)'}
                            stroke={isConnectedToSelected ? '#f59e0b' : isHL ? '#d946ef' : 'none'}
                            strokeWidth={0.5}
                          />
                          <text
                            x={labelX}
                            y={labelY - 1}
                            textAnchor="middle"
                            style={{
                              fontSize: isHL || isConnectedToSelected ? 9 : 7,
                              fill: isConnectedToSelected ? '#f59e0b' : isHL ? '#d946ef' : '#94a3b8',
                              fontWeight: isHL || isConnectedToSelected ? 600 : 400,
                              transition: 'all 0.2s',
                            }}
                            className="font-mono"
                          >
                            {edge.label}
                          </text>
                        </g>
                      )}
                    </g>
                  )
                })}

                {/* ─── Nodes ─────────────────────────────────────── */}
                {nodes.map(node => {
                  if (depthFilteredNodes && !depthFilteredNodes.has(node.id)) return null
                  if (dirFilteredNodeIds && !dirFilteredNodeIds.has(node.id)) return null

                  const isHL = isHighlighted(node.id)
                  const isNodeDim = isDimmed(node.id)
                  const isFocus = focus === node.id
                  const isExt = node.type === 'external'
                  const isScript = node.type === 'script'
                  const isDrag = dragging === node.id
                  const isSelected = selectedNode === node.id
                  const isSearchMatch = searchQuery.trim() !== '' && (node.label.toLowerCase().includes(searchQuery.toLowerCase()) || node.id.toLowerCase().includes(searchQuery.toLowerCase()))
                  const pos = getNodePos(node)

                  // Node fill colors (script nodes styled distinctly from tables/external)
                  const fill = isExt ? '#f0f9ff' : isScript ? '#faf5ff' : node.health === 'green' ? '#f0fdf4' : node.health === 'red' ? '#fef2f2' : node.health === 'yellow' ? '#fffbeb' : '#f4f4f5'
                  const stroke = isExt ? '#7dd3fc' : isScript ? '#a78bfa' : healthBorderSVG(node.health)
                  const labelColor = isExt ? '#0369a1' : isScript ? '#6b21a8' : node.health === 'green' ? '#166534' : node.health === 'red' ? '#991b1b' : node.health === 'yellow' ? '#854d0e' : '#52525b'

                  // Border width based on health
                  const healthBorderWidth = isExt || isScript ? 1 : node.health === 'green' ? 2 : node.health === 'red' ? 2.5 : node.health === 'yellow' ? 2 : 1

                  return (
                    <motion.g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => onNodeClick(node.id)}
                      onMouseDown={e => onNodeMouseDown(e, node.id)}
                      onMouseEnter={() => setHovered(node.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={isDrag ? 'cursor-grabbing' : 'cursor-pointer'}
                      initial={false}
                      animate={{
                        opacity: isNodeDim ? 0.2 : 1,
                        scale: isSearchMatch ? 1.05 : isSelected ? 1.04 : isHL ? 1.02 : 1,
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      {/* Focus ring (dashed pulsing) */}
                      {isFocus && (
                        <rect x={-4} y={-4} width={NW + 8} height={NH + 8} rx={10} fill="none" stroke="#d946ef" strokeWidth={2} strokeDasharray="3 3" className="animate-pulse" />
                      )}
                      {/* Selected ring (solid amber) */}
                      {isSelected && !isFocus && (
                        <rect x={-3} y={-3} width={NW + 6} height={NH + 6} rx={9} fill="none" stroke="#f59e0b" strokeWidth={2.5} />
                      )}
                      {/* Search match ring */}
                      {isSearchMatch && !isFocus && !isSelected && (
                        <rect x={-3} y={-3} width={NW + 6} height={NH + 6} rx={9} fill="none" stroke="#0ea5e9" strokeWidth={2} className="animate-pulse" />
                      )}

                      {/* Node rect with health border */}
                      <rect
                        x={0}
                        y={0}
                        width={NW}
                        height={NH}
                        rx={8}
                        fill={fill}
                        stroke={isSelected ? '#f59e0b' : isHL ? '#d946ef' : stroke}
                        strokeWidth={isSelected ? 2.5 : isHL ? 2 : healthBorderWidth}
                        strokeDasharray={isExt ? '4 3' : 'none'}
                        style={{ filter: isDrag ? 'drop-shadow(0 4px 8px rgba(0,0,0,0.18))' : isSelected ? 'drop-shadow(0 2px 6px rgba(245,158,11,0.3))' : isHL ? 'drop-shadow(0 2px 4px rgba(217,70,239,0.2))' : 'none', transition: 'stroke 0.2s, stroke-width 0.2s, filter 0.2s' }}
                      />

                      {/* Table/script/external icon (left side) - SVG path */}
                      {isExt ? (
                        <g transform="translate(8, 14) scale(0.55)" opacity={0.6}>
                          <path d="M3 3h18v18H3z" fill="none" stroke="#7dd3fc" strokeWidth={2} />
                          <path d="M3 9h18M3 15h18M9 3v18" fill="none" stroke="#7dd3fc" strokeWidth={1.5} />
                          <path d="M17 1l4 4M17 5l4-4" stroke="#38bdf8" strokeWidth={2} strokeLinecap="round" />
                        </g>
                      ) : isScript ? (
                        <g transform="translate(8, 16) scale(0.5)" opacity={0.6}>
                          <path d="M8 6L2 12l6 6" fill="none" stroke="#a78bfa" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M16 6l6 6-6 6" fill="none" stroke="#a78bfa" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                        </g>
                      ) : (
                        <g transform="translate(8, 14) scale(0.55)" opacity={0.5}>
                          <rect x={2} y={2} width={20} height={20} rx={3} fill="none" stroke={stroke} strokeWidth={2} />
                          <path d="M2 8h20M2 14h20M8 2v20" fill="none" stroke={stroke} strokeWidth={1.5} />
                        </g>
                      )}

                      {/* Label */}
                      <text x={NW / 2 + 6} y={22} textAnchor="middle" className="font-mono" style={{ fontSize: 11, fill: labelColor, fontWeight: isHL || isSelected ? 600 : 500 }}>
                        {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
                      </text>

                      {/* Sub-label: dir or type */}
                      <text x={NW / 2 + 6} y={38} textAnchor="middle" style={{ fontSize: 9, fill: '#9ca3af' }}>
                        {isExt ? '外部数据源' : isScript ? '脚本' : node.dir || ''}
                      </text>

                      {/* Row count badge (right side) — tables only */}
                      {!isExt && !isScript && node.meta && (
                        <>
                          <rect
                            x={NW - 48}
                            y={40}
                            width={42}
                            height={14}
                            rx={4}
                            fill="rgba(0,0,0,0.06)"
                            stroke="rgba(0,0,0,0.1)"
                            strokeWidth={0.5}
                          />
                          <text
                            x={NW - 27}
                            y={50.5}
                            textAnchor="middle"
                            style={{ fontSize: 8, fill: '#6b7280', fontWeight: 500 }}
                            className="font-mono"
                          >
                            {formatRows(node.meta.rows)}
                          </text>
                        </>
                      )}

                      {/* Health dot (top-right) — tables only */}
                      {!isExt && !isScript && (
                        <circle
                          cx={NW - 10}
                          cy={10}
                          r={4}
                          fill={node.health === 'green' ? '#10b981' : node.health === 'red' ? '#f43f5e' : node.health === 'yellow' ? '#f59e0b' : '#d4d4d8'}
                          style={{ filter: node.health === 'red' ? 'drop-shadow(0 0 3px #f43f5e)' : node.health === 'yellow' ? 'drop-shadow(0 0 2px #f59e0b)' : 'none' }}
                        />
                      )}

                      {/* Navigate indicator — tables only */}
                      {!isExt && !isScript && isHL && (
                        <text x={NW - 10} y={NH - 6} textAnchor="middle" style={{ fontSize: 8, fill: '#d946ef' }}>
                          →
                        </text>
                      )}
                    </motion.g>
                  )
                })}
              </svg>

              {/* ─── Hover Tooltip (HTML overlay) ──────────────────── */}
              <AnimatePresence>
                {hoveredNode && (hoveredMeta ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-3 left-3 w-64 bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 backdrop-blur-sm pointer-events-none z-20"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Table2 className="h-4 w-4 text-fuchsia-500 shrink-0" />
                      <span className="font-mono text-sm font-semibold truncate">{hoveredNode.id}</span>
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">{hoveredMeta.cn}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">类型</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{hoveredMeta.type}</Badge>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">目录</span>
                        <span className="font-mono">{hoveredMeta.dir}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">行数</span>
                        <span className="font-mono">{formatRows(hoveredMeta.rows)}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">新鲜度</span>
                        <span className={hoveredMeta.freshness === '最新' ? 'text-emerald-600' : hoveredMeta.freshness === '滞后' ? 'text-rose-600' : 'text-zinc-500'}>{hoveredMeta.freshness}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">健康</span>
                        <span className={healthTextColorClass(hoveredMeta.health)}>{hoveredMeta.health}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">调度</span>
                        <span>{hoveredMeta.schedule}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">上游</span>
                        <span className="font-mono">{hoveredMeta.dependsOn.length}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">下游</span>
                        <span className="font-mono">{hoveredMeta.downstream.length}</span>
                      </div>
                    </div>
                  </motion.div>
                ) : hoveredNode.type === 'script' ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-3 left-3 w-64 bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 backdrop-blur-sm pointer-events-none z-20"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Box className="h-4 w-4 text-violet-500 shrink-0" />
                      <span className="font-mono text-xs font-semibold truncate">{hoveredNode.id}</span>
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">入库 / 计算脚本</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">类型</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-violet-600">script</Badge>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">写入表</span>
                        <span className="font-mono">{edges.filter(e => e.type === 'writes' && e.from === hoveredNode.id).length}</span>
                      </div>
                      <div className="flex justify-between col-span-1">
                        <span className="text-zinc-400">读取表</span>
                        <span className="font-mono">{edges.filter(e => e.type === 'reads' && e.from === hoveredNode.id).length}</span>
                      </div>
                    </div>
                  </motion.div>
                ) : null)}
              </AnimatePresence>

              {/* ─── Minimap overlay ──────────────────────────────── */}
              <AnimatePresence>
                {showMinimap && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-3 right-3 w-52 h-28 bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg overflow-hidden backdrop-blur-sm"
                  >
                    <div className="px-2 py-1 text-[9px] text-zinc-500 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
                      <span className="flex items-center gap-1"><MapIcon className="h-2.5 w-2.5" /> Minimap</span>
                      <button onClick={() => setShowMinimap(false)} className="hover:text-zinc-700 dark:hover:text-zinc-300" title="隐藏">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full cursor-pointer" style={{ height: 'calc(100% - 20px)' }} preserveAspectRatio="xMidYMid meet" onClick={onMinimapClick}>
                      {/* Mini edges */}
                      {edges.map((edge, i) => {
                        const from = nodeById.get(edge.from)
                        const to = nodeById.get(edge.to)
                        if (!from || !to) return null
                        if (depthFilteredNodes && !depthFilteredNodes.has(edge.from) && !depthFilteredNodes.has(edge.to)) return null
                        if (dirFilteredNodeIds && !dirFilteredNodeIds.has(edge.from) && !dirFilteredNodeIds.has(edge.to)) return null
                        const fp = getNodePos(from)
                        const tp = getNodePos(to)
                        const isConn = isEdgeConnected(edge)
                        return <line key={i} x1={fp.x + NW / 2} y1={fp.y + NH / 2} x2={tp.x + NW / 2} y2={tp.y + NH / 2} stroke={isConn ? '#f59e0b' : edge.type === 'external' ? '#7dd3fc' : '#cbd5e1'} strokeWidth={isConn ? 3 : 2} opacity={isConn ? 0.8 : 0.4} />
                      })}
                      {/* Mini nodes */}
                      {nodes.map(n => {
                        if (depthFilteredNodes && !depthFilteredNodes.has(n.id)) return null
                        if (dirFilteredNodeIds && !dirFilteredNodeIds.has(n.id)) return null
                        const p = getNodePos(n)
                        const isF = focus === n.id
                        const isSel = selectedNode === n.id
                        const isExt = n.type === 'external'
                        const color = isExt ? '#7dd3fc' : n.health === 'green' ? '#10b981' : n.health === 'red' ? '#f43f5e' : n.health === 'yellow' ? '#f59e0b' : '#d4d4d8'
                        return (
                          <rect
                            key={n.id}
                            x={p.x}
                            y={p.y}
                            width={NW}
                            height={NH}
                            rx={4}
                            fill={color}
                            opacity={isF || isSel ? 1 : 0.5}
                            stroke={isSel ? '#f59e0b' : isF ? '#d946ef' : 'none'}
                            strokeWidth={isSel || isF ? 4 : 0}
                          />
                        )
                      })}
                      {/* Viewport indicator */}
                      {viewportRect && (
                        <rect
                          x={viewportRect.x}
                          y={viewportRect.y}
                          width={viewportRect.w}
                          height={viewportRect.h}
                          fill="rgba(217,70,239,0.08)"
                          stroke="#d946ef"
                          strokeWidth={3}
                          rx={4}
                          strokeDasharray="8 4"
                        />
                      )}
                    </svg>
                  </motion.div>
                )}
              </AnimatePresence>
              {!showMinimap && (
                <button
                  onClick={() => setShowMinimap(true)}
                  className="absolute bottom-3 right-3 p-1.5 rounded-md bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  title="显示 Minimap"
                >
                  <MapIcon className="h-3.5 w-3.5 text-zinc-500" />
                </button>
              )}

              {/* ─── Floating Legend Card (bottom-right, above minimap) ── */}
              <div className="absolute bottom-36 right-3 w-56 bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg backdrop-blur-sm z-10">
                <div className="px-3 py-2 text-[10px] font-medium text-zinc-500 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1">
                  <Circle className="h-2.5 w-2.5" /> 图例
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  {/* Node types */}
                  <div className="text-[9px] text-zinc-400 font-medium uppercase tracking-wider mb-0.5">节点类型</div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-3.5 w-6 rounded border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">表 (健康)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-3.5 w-6 rounded border-2 border-rose-500 bg-rose-50 dark:bg-rose-950 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">表 (异常)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-3.5 w-6 rounded border-2 border-dashed border-sky-300 bg-sky-50 dark:bg-sky-950 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">外部数据源</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-3.5 w-6 rounded border-2 border-violet-400 bg-violet-50 dark:bg-violet-950 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">脚本 (script)</span>
                  </div>

                  {/* Edge types */}
                  <div className="text-[9px] text-zinc-400 font-medium uppercase tracking-wider mt-1.5 mb-0.5">边类型</div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-0.5 w-6 bg-zinc-400 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">写入 (writes)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="w-6 shrink-0" style={{ borderTop: '2px dashed #a78bfa', height: 0 }} />
                    <span className="text-zinc-600 dark:text-zinc-400">读取 (reads)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-0.5 w-6 bg-fuchsia-500 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">高亮路径</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="h-0.5 w-6 bg-amber-500 shrink-0" />
                    <span className="text-zinc-600 dark:text-zinc-400">选中关联</span>
                  </div>
                </div>
                {/* Help text */}
                <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[9px] text-zinc-400 text-center">
                  {lineageNote ?? '拖拽平移 · 滚轮缩放 · 点击选中'}
                </div>
              </div>

              {/* ─── Bottom tips ─────────────────────────────────────── */}
              <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 shadow-sm backdrop-blur-sm flex items-center gap-2">
                <span>拖拽节点重新布局</span>
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <span>点击节点选中/跳转</span>
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <span>Ctrl+滚轮缩放</span>
                {Object.keys(nodeOverrides).length > 0 && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <span className="text-amber-600">{Object.keys(nodeOverrides).length} 个已移动</span>
                  </>
                )}
              </div>
            </div>

            {/* ─── Inline Legend bar (compact) ──────────────────────── */}
            <div className="px-4 py-3 border-t flex items-center gap-4 text-[11px] text-zinc-500 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border-2 border-emerald-500 bg-emerald-50" /> 健康
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border-2 border-rose-500 bg-rose-50" /> 异常
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border-2 border-amber-400 bg-amber-50" /> 待查
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border-2 border-zinc-300 bg-zinc-50" /> once
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border-2 border-dashed border-sky-300 bg-sky-50" /> 外部源
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">|</span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-6 bg-fuchsia-500" /> 高亮路径
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-6 bg-amber-500" /> 选中关联
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-6 bg-sky-400" /> 外部依赖
              </span>
              <span className="text-zinc-400 ml-auto">点击节点 → 选中高亮关联 · 边标签显示关系类型</span>
            </div>
          </CardContent>
        </Card>

        {/* ─── Right sidebar: Focus details ──────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Box className="h-4 w-4 text-fuchsia-500" />
                焦点表
              </CardTitle>
            </CardHeader>
            <CardContent>
              {focused && (
                <div className="p-3 rounded-md border-2 border-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-950/30">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadgeClass(focused.type)}`}>{focused.type}</span>
                    <div className="font-mono text-sm font-semibold truncate">{focused.table}</div>
                  </div>
                  <div className="text-xs text-zinc-500 mb-2">{focused.cn}</div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between"><span className="text-zinc-400">目录</span><span className="font-mono">{focused.dir}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">schedule</span><span>{focused.schedule}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">mode</span><span>{focused.mode}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">行数</span><span className="font-mono">{formatRows(focused.rows)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">新鲜度</span><span className={focused.freshness === '最新' ? 'text-emerald-600' : focused.freshness === '滞后' ? 'text-rose-600' : 'text-zinc-500'}>{focused.freshness}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">上游数</span><span className="font-mono">{focused.dependsOn.length}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">下游数</span><span className="font-mono">{focused.downstream.length}</span></div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-fuchsia-200 dark:border-fuchsia-800">
                    <div className="text-[10px] text-zinc-400 mb-1 flex items-center gap-1"><Database className="h-3 w-3" />外部数据源</div>
                    <div className="flex flex-wrap gap-1">
                      {focused.sourceDeps.length === 0 ? <span className="text-[10px] text-zinc-400">无</span> :
                        focused.sourceDeps.map(d => <Badge key={d} variant="outline" className="text-[10px] py-0 px-1 font-mono">{d}</Badge>)}
                    </div>
                  </div>
                  {onNavigate && (
                    <button
                      onClick={() => onNavigate('catalog', focused.table)}
                      className="mt-2 w-full text-xs px-3 py-1.5 rounded-md bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <Database className="h-3 w-3" />
                      查看目录详情
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upstream / downstream list */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-sky-500" />
                影响范围 ({depth} 层)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-[11px] font-medium text-zinc-500 mb-1.5 flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" /> 上游 ({upstream.size})
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {upstream.size === 0 && <div className="text-[11px] text-zinc-400 py-2 text-center">无库内上游</div>}
                  {[...upstream].map(t => {
                    const meta = TABLES.find(x => x.table === t)
                    return (
                      <button key={t} onClick={() => setFocus(t)} className="w-full text-left p-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors">
                        <div className="font-mono text-[11px] font-medium truncate">{t}</div>
                        {meta && <div className="text-[10px] text-zinc-400 truncate">{meta.cn}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-zinc-500 mb-1.5 flex items-center gap-1">
                  <ArrowDown className="h-3 w-3" /> 下游 ({downstream.size})
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {downstream.size === 0 && <div className="text-[11px] text-zinc-400 py-2 text-center">无下游</div>}
                  {[...downstream].map(t => {
                    const meta = TABLES.find(x => x.table === t)
                    return (
                      <button key={t} onClick={() => setFocus(t)} className="w-full text-left p-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors">
                        <div className="font-mono text-[11px] font-medium truncate">{t}</div>
                        {meta && <div className="text-[10px] text-zinc-400 truncate">{meta.cn}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3 text-xs text-zinc-500">
              <strong className="text-zinc-700 dark:text-zinc-300">用途：</strong>
              上游坏了 → 查哪些下游受影响；改某表 schema → 查哪些脚本要同步改；调度排序 → 按拓扑序自动排。
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// Also keep named export for backward compatibility
export { LineageView }
