'use client'
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TABLES, TableMeta, REAL_TABLE_CONFIGS } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { GitBranch, ArrowDown, ArrowUp, Box, Search, Maximize2, ZoomIn, ZoomOut, Layers, Activity, Database, Network, Map as MapIcon, X, LayoutGrid, Compass, Filter, Target } from 'lucide-react'
import { formatRows, healthColorClass, typeBadgeClass } from '@/lib/dataops/styles'

// ─── Types ──────────────────────────────────────────────────────────
interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  type: 'external' | 'table'
  health: string
  dir?: string
  meta?: TableMeta
}

interface GraphEdge {
  from: string
  to: string
  type: 'internal' | 'external'
  label: string
}

interface LineageViewProps {
  onNavigate?: (view: string, tableId?: string) => void
}

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
  // Check from meta
  const toMeta = TABLES.find(t => t.table === toId)
  if (toMeta) {
    if (toMeta.type === '视图') return '视图派生'
    if (toMeta.dir === '2_计算') return 'SQL派生'
  }
  return 'SQL依赖'
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

  // Assign layers via topological sort (longest path)
  const layer = new Map<string, number>()
  const queue: string[] = []

  // External nodes start at layer 0
  nodes.filter(n => n.type === 'external').forEach(n => {
    layer.set(n.id, 0)
    // Push their children
  })

  // Source nodes (inDegree === 0) start at layer 0 or 1
  nodeIds.forEach(id => {
    if ((inDegree.get(id) || 0) === 0 && !layer.has(id)) {
      const node = nodes.find(n => n.id === id)
      layer.set(id, node?.type === 'external' ? 0 : 1)
      queue.push(id)
    }
  })

  // BFS with longest path
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

  // Ensure all nodes have a layer
  nodes.forEach(n => {
    if (!layer.has(n.id)) layer.set(n.id, n.type === 'external' ? 0 : 1)
  })

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>()
  layer.forEach((l, id) => {
    if (!layerGroups.has(l)) layerGroups.set(l, [])
    layerGroups.get(l)!.push(id)
  })

  const maxLayer = Math.max(...Array.from(layerGroups.keys()), 0)
  const layerHeight = Math.min(160, (viewH - 120) / Math.max(maxLayer, 1))
  const nodeWidth = 120
  const gap = 150
  const overrides: Record<string, { x: number; y: number }> = {}

  layerGroups.forEach((ids, l) => {
    const y = 60 + l * layerHeight
    // Sort by dir to group visually
    const sorted = ids.sort((a, b) => {
      const na = nodes.find(n => n.id === a)
      const nb = nodes.find(n => n.id === b)
      const dirA = na?.dir || na?.type === 'external' ? '0' : '1'
      const dirB = nb?.dir || nb?.type === 'external' ? '0' : '1'
      return dirA.localeCompare(dirB) || a.localeCompare(b)
    })
    const totalWidth = sorted.length * nodeWidth + (sorted.length - 1) * (gap - nodeWidth)
    const startX = Math.max(60, (viewW - totalWidth) / 2)
    sorted.forEach((id, i) => {
      overrides[id] = { x: startX + i * gap, y }
    })
  })

  return overrides
}

// ─── Depth filter: get nodes within N hops ──────────────────────────
function getNodesWithinHops(centerId: string, hops: number, allNodes: GraphNode[], allEdges: GraphEdge[]): Set<string> {
  const result = new Set<string>([centerId])
  const adjacency = new Map<string, string[]>()   // forward edges
  const reverseAdj = new Map<string, string[]>()   // backward edges

  allNodes.forEach(n => { adjacency.set(n.id, []); reverseAdj.set(n.id, []) })
  allEdges.forEach(e => {
    adjacency.get(e.from)?.push(e.to)
    reverseAdj.get(e.to)?.push(e.from)
  })

  // BFS upstream
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

  // BFS downstream
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

// ─── Main Component ─────────────────────────────────────────────────
export function LineageView({ onNavigate }: LineageViewProps) {
  const [focus, setFocus] = useState<string>('stock_daily_kline')
  const [depth, setDepth] = useState(3)
  const [searchQuery, setSearchQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState<string | null>(null)
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [showMinimap, setShowMinimap] = useState(true)
  const [useDepthFilter, setUseDepthFilter] = useState(false)
  const [depthFilterHops, setDepthFilterHops] = useState(2)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ nodeId: string; startMouse: { x: number; y: number }; startNode: { x: number; y: number } } | null>(null)
  const isPanning = useRef(false)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // SVG dimensions
  const viewW = 2000
  const viewH = 900

  // ─── Build nodes & edges from TABLES ────────────────────────────────
  const { nodes, edges, externalNodes } = useMemo(() => {
    const ns: GraphNode[] = []
    const es: GraphEdge[] = []
    const extIds: string[] = []

    // Collect unique external sources from sourceDeps
    const extSet = new Set<string>()
    TABLES.forEach(t => t.sourceDeps.forEach(d => extSet.add(d)))
    const extList = Array.from(extSet)
    extList.forEach(id => extIds.push(id))

    // External source nodes
    extList.forEach((id, i) => {
      ns.push({
        id, label: id.length > 18 ? id.slice(0, 17) + '…' : id,
        x: 60 + i * 150, y: 60, type: 'external', health: 'external',
      })
    })

    // Table nodes
    TABLES.forEach(t => {
      ns.push({
        id: t.table, label: t.table,
        x: 0, y: 0, type: 'table', health: t.health,
        dir: t.dir, meta: t,
      })
    })

    // Edges: external source → table
    TABLES.forEach(t => {
      t.sourceDeps.forEach(src => {
        es.push({ from: src, to: t.table, type: 'external', label: '数据源' })
      })
    })

    // Edges: table → table (internal dependencies)
    TABLES.forEach(t => {
      t.dependsOn.forEach(dep => {
        const label = getEdgeLabel(dep, t.table, 'internal')
        es.push({ from: dep, to: t.table, type: 'internal', label })
      })
    })

    return { nodes: ns, edges: es, externalNodes: extIds }
  }, [])

  // ─── Auto-layout (topological DAG) applied by default ───────────────
  const dagLayout = useMemo(() => {
    return computeDagLayout(nodes, edges, viewW, viewH)
  }, [nodes, edges])

  // Apply DAG layout on first render
  useEffect(() => {
    setNodeOverrides(dagLayout)
  }, [dagLayout])

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    nodes.forEach(n => m.set(n.id, n))
    return m
  }, [nodes])

  const getNodePos = useCallback((node: GraphNode) => {
    return nodeOverrides[node.id] || { x: node.x, y: node.y }
  }, [nodeOverrides])

  const focused = TABLES.find(t => t.table === focus)

  // ─── Search highlight ───────────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const q = searchQuery.toLowerCase()
    const results = new Set<string>()
    nodes.forEach(n => {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        results.add(n.id)
        // Also add connected nodes
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
    const collect = (table: string, d: number) => {
      if (d <= 0) return
      const t = TABLES.find(x => x.table === table)
      if (!t) return
      for (const dep of t.dependsOn) {
        set.add(dep)
        collect(dep, d - 1)
      }
    }
    collect(focus, depth)
    return set
  }, [focus, depth])

  const downstream = useMemo(() => {
    const set = new Set<string>()
    const collect = (table: string, d: number) => {
      if (d <= 0) return
      for (const t of TABLES) {
        if (t.dependsOn.includes(table)) {
          set.add(t.table)
          collect(t.table, d - 1)
        }
      }
    }
    collect(focus, depth)
    return set
  }, [focus, depth])

  const highlightSet = useMemo(() => {
    const s = new Set<string>([focus])
    upstream.forEach(t => s.add(t))
    downstream.forEach(t => s.add(t))
    return s
  }, [focus, upstream, downstream])

  const isHighlighted = useCallback((id: string) => {
    if (searchQuery.trim() && searchResults.has(id)) return true
    return highlightSet.has(id) || hovered === id
  }, [highlightSet, hovered, searchQuery, searchResults])

  const isDimmed = useCallback((id: string) => {
    if (depthFilteredNodes && !depthFilteredNodes.has(id)) return true
    if (searchQuery.trim()) return !searchResults.has(id)
    return (highlightSet.size > 1 || hovered !== null) && !isHighlighted(id)
  }, [highlightSet, hovered, searchQuery, searchResults, depthFilteredNodes, isHighlighted])

  // ─── Node click: navigate to catalog or set focus ──────────────────
  const onNodeClick = useCallback((id: string) => {
    const node = nodeById.get(id)
    if (node?.type === 'table' && onNavigate) {
      onNavigate('catalog', id)
    }
    if (node?.type === 'table') {
      setFocus(id)
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
          x: Math.max(0, Math.min(viewW - 120, ds.startNode.x + dx)),
          y: Math.max(40, Math.min(viewH - 40, ds.startNode.y + dy)),
        },
      }))
      return
    }
    // Panning
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
    // Start panning on SVG background
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
    setNodeOverrides(dagLayout)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setFocus('stock_daily_kline')
    setSearchQuery('')
    setUseDepthFilter(false)
  }, [dagLayout])

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

  // ─── Auto layout ───────────────────────────────────────────────────
  const autoLayout = useCallback(() => {
    setNodeOverrides(dagLayout)
    setPan({ x: 0, y: 0 })
  }, [dagLayout])

  // ─── Compute viewport rect for minimap (state-based to avoid ref-in-render) ─
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

  // ─── Node grouping by dir ──────────────────────────────────────────
  const dirGroups = useMemo(() => {
    const groups: { dir: string; color: string; bgColor: string; nodes: string[] }[] = [
      { dir: '外部数据源', color: '#7dd3fc', bgColor: 'rgba(125,211,252,0.06)', nodes: [] },
      { dir: '1_入库', color: '#34d399', bgColor: 'rgba(52,211,153,0.06)', nodes: [] },
      { dir: '2_计算', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.06)', nodes: [] },
    ]
    nodes.forEach(n => {
      if (n.type === 'external') {
        groups[0].nodes.push(n.id)
      } else if (n.dir === '1_入库') {
        groups[1].nodes.push(n.id)
      } else if (n.dir === '2_计算' || n.dir === '3_策略' || n.dir === '4_工具') {
        groups[2].nodes.push(n.id)
      }
    })
    return groups
  }, [nodes])

  // Compute bounding boxes for dir groups
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
        maxX = Math.max(maxX, pos.x + 120)
        maxY = Math.max(maxY, pos.y + 40)
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

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Control bar */}
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

            {/* Depth selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 flex items-center gap-1"><Layers className="h-3 w-3" />展开层数</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {[1, 2, 3, 4].map(d => (
                  <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-0.5 text-xs rounded ${depth === d ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{d}</button>
                ))}
              </div>
            </div>

            {/* Depth filter toggle */}
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
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-400">N=</span>
                  <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                    {[1, 2, 3, 4].map(n => (
                      <button key={n} onClick={() => setDepthFilterHops(n)} className={`px-2 py-0.5 text-xs rounded ${depthFilterHops === n ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 border-l pl-3">
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setZoom(z => Math.max(0.3, z - 0.2))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-zinc-500 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setZoom(z => Math.min(2.5, z + 0.2))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={fitToView} title="适应视口">
                <Compass className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={resetView} title="重置">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={autoLayout} title="自动布局 (DAG)">
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Badge variant="secondary" className="text-xs">
              <Target className="h-3 w-3 mr-1" />
              焦点：{focus}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* SVG Graph */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-fuchsia-500" />
              血缘关系图谱
              <Badge variant="outline" className="ml-2 text-[10px]">
                {depthFilteredNodes ? depthFilteredNodes.size : nodes.length} 节点 · {edges.length} 边
              </Badge>
              {useDepthFilter && (
                <Badge className="ml-1 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <Filter className="h-2.5 w-2.5 mr-1" />
                  {depthFilterHops} 跳
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div
              ref={containerRef}
              className="relative overflow-auto bg-zinc-50/50 dark:bg-zinc-950/30"
              style={{ maxHeight: 'calc(100vh - 280px)' }}
              onWheel={onWheel}
            >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${viewW} ${viewH}`}
                width={viewW * zoom}
                height={viewH * zoom}
                className="mx-auto"
                style={{ minWidth: viewW * 0.4 }}
                onMouseMove={onSvgMouseMove}
                onMouseUp={onSvgMouseUp}
                onMouseLeave={onSvgMouseUp}
                onMouseDown={onSvgMouseDown}
              >
                <defs>
                  <marker id="arrow-internal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                  </marker>
                  <marker id="arrow-external" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                  </marker>
                  <marker id="arrow-highlight" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#d946ef" />
                  </marker>
                </defs>

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

                {/* Edges */}
                {edges.map((edge, i) => {
                  const from = nodeById.get(edge.from)
                  const to = nodeById.get(edge.to)
                  if (!from || !to) return null

                  // Skip edges to/from dimmed nodes when depth filter is on
                  if (depthFilteredNodes) {
                    if (!depthFilteredNodes.has(edge.from) && !depthFilteredNodes.has(edge.to)) return null
                  }

                  const fromPos = getNodePos(from)
                  const toPos = getNodePos(to)
                  const isHL = (isHighlighted(edge.from) && isHighlighted(edge.to)) || hovered === edge.from || hovered === edge.to
                  const isEdgeDim = isDimmed(edge.from) || isDimmed(edge.to)

                  // Bezier curve
                  const x1 = fromPos.x + 60
                  const y1 = fromPos.y + 20
                  const x2 = toPos.x + 60
                  const y2 = toPos.y - 2
                  const midY = (y1 + y2) / 2
                  const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`

                  // Edge label position (midpoint)
                  const labelX = (x1 + x2) / 2
                  const labelY = midY

                  return (
                    <g key={`edge-${i}`}>
                      <path
                        d={path}
                        fill="none"
                        stroke={isHL ? '#d946ef' : edge.type === 'external' ? '#7dd3fc' : '#cbd5e1'}
                        strokeWidth={isHL ? 2 : 1}
                        strokeDasharray={edge.type === 'external' ? '4 3' : 'none'}
                        opacity={isEdgeDim ? 0.1 : 1}
                        markerEnd={`url(#${isHL ? 'arrow-highlight' : edge.type === 'external' ? 'arrow-external' : 'arrow-internal'})`}
                        style={{ transition: 'opacity 0.2s, stroke 0.2s' }}
                      />
                      {/* Edge label */}
                      {edge.label && !isEdgeDim && (isHL || zoom >= 0.8) && (
                        <text
                          x={labelX}
                          y={labelY - 4}
                          textAnchor="middle"
                          style={{
                            fontSize: isHL ? 9 : 7,
                            fill: isHL ? '#d946ef' : '#94a3b8',
                            fontWeight: isHL ? 600 : 400,
                            transition: 'all 0.2s',
                          }}
                          className="font-mono"
                        >
                          {edge.label}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Nodes */}
                {nodes.map(node => {
                  // Skip nodes not in depth filter
                  if (depthFilteredNodes && !depthFilteredNodes.has(node.id)) return null

                  const isHL = isHighlighted(node.id)
                  const isNodeDim = isDimmed(node.id)
                  const isFocus = focus === node.id
                  const isExt = node.type === 'external'
                  const isDrag = dragging === node.id
                  const isSearchMatch = searchQuery.trim() !== '' && node.label.toLowerCase().includes(searchQuery.toLowerCase()) || node.id.toLowerCase().includes(searchQuery.toLowerCase())
                  const pos = getNodePos(node)

                  const fill = isExt ? '#f0f9ff' : node.health === 'green' ? '#f0fdf4' : node.health === 'red' ? '#fef2f2' : node.health === 'yellow' ? '#fffbeb' : '#f4f4f5'
                  const stroke = isExt ? '#7dd3fc' : node.health === 'green' ? '#86efac' : node.health === 'red' ? '#fca5a5' : node.health === 'yellow' ? '#fcd34d' : '#d4d4d8'
                  const labelColor = isExt ? '#0369a1' : node.health === 'green' ? '#166534' : node.health === 'red' ? '#991b1b' : node.health === 'yellow' ? '#854d0e' : '#52525b'

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
                        opacity: isNodeDim ? 0.25 : 1,
                        scale: isSearchMatch ? 1.05 : isHL ? 1.02 : 1,
                      }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      {/* Focus ring */}
                      {isFocus && (
                        <rect x={-4} y={-4} width={128} height={48} rx={8} fill="none" stroke="#d946ef" strokeWidth={2} strokeDasharray="3 3" className="animate-pulse" />
                      )}
                      {/* Search match ring */}
                      {isSearchMatch && !isFocus && (
                        <rect x={-4} y={-4} width={128} height={48} rx={8} fill="none" stroke="#0ea5e9" strokeWidth={2} className="animate-pulse" />
                      )}
                      {/* Node rect */}
                      <rect
                        x={0}
                        y={0}
                        width={120}
                        height={40}
                        rx={6}
                        fill={fill}
                        stroke={isHL ? '#d946ef' : stroke}
                        strokeWidth={isHL ? 2 : 1}
                        strokeDasharray={isExt ? '4 3' : 'none'}
                        style={{ filter: isDrag ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))' : isHL ? 'drop-shadow(0 2px 4px rgba(217,70,239,0.2))' : 'none', transition: 'stroke 0.2s, stroke-width 0.2s' }}
                      />
                      {/* Label */}
                      <text x={60} y={16} textAnchor="middle" className="font-mono" style={{ fontSize: 10, fill: labelColor, fontWeight: isHL ? 600 : 500 }}>
                        {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
                      </text>
                      {/* Sub-label: dir or type */}
                      <text x={60} y={30} textAnchor="middle" style={{ fontSize: 8, fill: '#9ca3af' }}>
                        {isExt ? '外部数据源' : node.dir || ''}
                      </text>
                      {/* Health dot */}
                      {!isExt && (
                        <circle
                          cx={112}
                          cy={8}
                          r={3}
                          fill={node.health === 'green' ? '#10b981' : node.health === 'red' ? '#f43f5e' : node.health === 'yellow' ? '#f59e0b' : '#d4d4d8'}
                        />
                      )}
                      {/* Navigate indicator */}
                      {!isExt && isHL && (
                        <text x={112} y={32} textAnchor="middle" style={{ fontSize: 7, fill: '#d946ef' }}>
                          →
                        </text>
                      )}
                    </motion.g>
                  )
                })}
              </svg>

              {/* ─── Minimap overlay ─────────────────────────────────── */}
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
                    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full" style={{ height: 'calc(100% - 20px)' }} preserveAspectRatio="xMidYMid meet" onClick={onMinimapClick}>
                      {/* Mini edges */}
                      {edges.map((edge, i) => {
                        const from = nodeById.get(edge.from)
                        const to = nodeById.get(edge.to)
                        if (!from || !to) return null
                        if (depthFilteredNodes && !depthFilteredNodes.has(edge.from) && !depthFilteredNodes.has(edge.to)) return null
                        const fp = getNodePos(from)
                        const tp = getNodePos(to)
                        return <line key={i} x1={fp.x + 60} y1={fp.y + 20} x2={tp.x + 60} y2={tp.y} stroke={edge.type === 'external' ? '#7dd3fc' : '#cbd5e1'} strokeWidth={2} opacity={0.4} />
                      })}
                      {/* Mini nodes */}
                      {nodes.map(n => {
                        if (depthFilteredNodes && !depthFilteredNodes.has(n.id)) return null
                        const p = getNodePos(n)
                        const isF = focus === n.id
                        const isExt = n.type === 'external'
                        const color = isExt ? '#7dd3fc' : n.health === 'green' ? '#10b981' : n.health === 'red' ? '#f43f5e' : n.health === 'yellow' ? '#f59e0b' : '#d4d4d8'
                        return (
                          <rect
                            key={n.id}
                            x={p.x}
                            y={p.y}
                            width={120}
                            height={40}
                            rx={4}
                            fill={color}
                            opacity={isF ? 1 : 0.5}
                            stroke={isF ? '#d946ef' : 'none'}
                            strokeWidth={isF ? 4 : 0}
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

              {/* Bottom tips */}
              <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 shadow-sm backdrop-blur-sm flex items-center gap-2">
                <span>拖拽节点重新布局</span>
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <span>点击节点跳转目录</span>
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

            {/* Legend */}
            <div className="px-4 py-3 border-t flex items-center gap-4 text-[11px] text-zinc-500 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border border-emerald-400 bg-emerald-50" /> 健康
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border border-rose-400 bg-rose-50" /> 异常
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border border-amber-400 bg-amber-50" /> 待查
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border border-zinc-300 bg-zinc-50" /> once
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded border border-dashed border-sky-300 bg-sky-50" /> 外部源
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-6 bg-fuchsia-500" /> 高亮路径
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-6 bg-sky-400" /> 搜索匹配
              </span>
              <span className="text-zinc-400 ml-auto">点击节点 → 跳转目录 · 边标签显示关系类型</span>
            </div>
          </CardContent>
        </Card>

        {/* Right sidebar: Focus details */}
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
                  {/* Navigate button */}
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
