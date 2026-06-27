'use client'
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { TABLES, TableMeta, PIPELINE_RUNS, genSampleData, getColumnLintIssues, LINT_RULES } from '@/lib/dataops/mock-data'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Search, Filter, Play, RefreshCw, GitBranch, FileText, ListChecks, Database, Table2, History, AlertTriangle, CheckCircle2, XCircle, SkipForward, Copy, Share2, Network, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { formatRows, freshnessClass, healthColorClass, typeBadgeClass, runStatusClass, triggerClass, formatDuration } from '@/lib/dataops/styles'
import { toast } from 'sonner'

// ─── Dependency Mini Graph ───
function DependencyMiniGraph({ table }: { table: TableMeta }) {
  const upstream = table.dependsOn
  const current = table.table
  const downstream = table.downstream

  const maxNodes = Math.max(upstream.length, downstream.length, 1)
  const nodeH = 32
  const nodeGap = 6
  const colW = 120
  const arrowGap = 40
  const padX = 16
  const padY = 12
  const svgW = Math.min(400, padX * 2 + colW * 3 + arrowGap * 2)
  const svgH = padY * 2 + maxNodes * (nodeH + nodeGap) - nodeGap

  const midY = svgH / 2

  // Column x centers
  const upstreamX = padX + colW / 2
  const currentX = padX + colW + arrowGap + colW / 2
  const downstreamX = padX + colW * 2 + arrowGap * 2 + colW / 2

  // Calculate y positions for each node list
  const getNodeY = (index: number, total: number) => {
    const totalHeight = total * (nodeH + nodeGap) - nodeGap
    const startY = midY - totalHeight / 2
    return startY + index * (nodeH + nodeGap)
  }

  return (
    <div className="flex items-center justify-center py-2">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="animate-fade-in"
      >
        {/* Arrow definitions */}
        <defs>
          <marker id="arrowUpstream" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#0ea5e9" />
          </marker>
          <marker id="arrowDownstream" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#10b981" />
          </marker>
        </defs>

        {/* Upstream nodes (sky) */}
        {upstream.map((name, i) => {
          const y = getNodeY(i, upstream.length)
          return (
            <g key={`up-${name}`}>
              <rect
                x={upstreamX - colW / 2 + 4}
                y={y}
                width={colW - 8}
                height={nodeH}
                rx={6}
                fill="#e0f2fe"
                stroke="#0ea5e9"
                strokeWidth={1}
                className="dark:fill-sky-950/40 dark:stroke-sky-700"
              />
              <text
                x={upstreamX}
                y={y + nodeH / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fontFamily="monospace"
                className="fill-sky-700 dark:fill-sky-300"
              >
                {name.length > 14 ? name.slice(0, 13) + '…' : name}
              </text>
              {/* Arrow from upstream to current */}
              <line
                x1={upstreamX + colW / 2 - 4}
                y1={y + nodeH / 2}
                x2={currentX - colW / 2 + 4}
                y2={midY}
                stroke="#0ea5e9"
                strokeWidth={1.5}
                strokeDasharray="4,2"
                markerEnd="url(#arrowUpstream)"
                className="dark:stroke-sky-600"
              />
            </g>
          )
        })}

        {/* Current node (fuchsia) */}
        <rect
          x={currentX - colW / 2 + 2}
          y={midY - nodeH / 2}
          width={colW - 4}
          height={nodeH}
          rx={8}
          fill="#fdf4ff"
          stroke="#d946ef"
          strokeWidth={2}
          className="dark:fill-fuchsia-950/40 dark:stroke-fuchsia-500"
        />
        <text
          x={currentX}
          y={midY + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fontFamily="monospace"
          fontWeight="bold"
          className="fill-fuchsia-700 dark:fill-fuchsia-300"
        >
          {current.length > 14 ? current.slice(0, 13) + '…' : current}
        </text>

        {/* Downstream nodes (emerald) */}
        {downstream.map((name, i) => {
          const y = getNodeY(i, downstream.length)
          return (
            <g key={`down-${name}`}>
              <rect
                x={downstreamX - colW / 2 + 4}
                y={y}
                width={colW - 8}
                height={nodeH}
                rx={6}
                fill="#ecfdf5"
                stroke="#10b981"
                strokeWidth={1}
                className="dark:fill-emerald-950/40 dark:stroke-emerald-700"
              />
              <text
                x={downstreamX}
                y={y + nodeH / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fontFamily="monospace"
                className="fill-emerald-700 dark:fill-emerald-300"
              >
                {name.length > 14 ? name.slice(0, 13) + '…' : name}
              </text>
              {/* Arrow from current to downstream */}
              <line
                x1={currentX + colW / 2 - 2}
                y1={midY}
                x2={downstreamX - colW / 2 + 4}
                y2={y + nodeH / 2}
                stroke="#10b981"
                strokeWidth={1.5}
                strokeDasharray="4,2"
                markerEnd="url(#arrowDownstream)"
                className="dark:stroke-emerald-600"
              />
            </g>
          )
        })}

        {/* Empty state labels */}
        {upstream.length === 0 && (
          <text
            x={upstreamX}
            y={midY + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            className="fill-zinc-300 dark:fill-zinc-600"
          >
            无上游
          </text>
        )}
        {downstream.length === 0 && (
          <text
            x={downstreamX}
            y={midY + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            className="fill-zinc-300 dark:fill-zinc-600"
          >
            无下游
          </text>
        )}

        {/* Column labels */}
        <text x={upstreamX} y={8} textAnchor="middle" fontSize={8} className="fill-zinc-400">上游</text>
        <text x={currentX} y={8} textAnchor="middle" fontSize={8} className="fill-zinc-400">当前</text>
        <text x={downstreamX} y={8} textAnchor="middle" fontSize={8} className="fill-zinc-400">下游</text>
      </svg>
    </div>
  )
}

// ─── Full Dependency Graph View ───
interface GraphNode {
  table: string
  cn: string
  dir: string
  rows: number
  health: string
  dependsOn: string[]
  x: number
  y: number
  width: number
  height: number
}

interface GraphEdge {
  from: string
  to: string
}

function DependencyGraphView() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const svgContainerRef = useRef<HTMLDivElement>(null)

  // Compute hierarchical layout
  const { nodes, edges, orphanNodes } = useMemo(() => {
    const nodeW = 140
    const nodeH = 48
    const hGap = 60
    const vGap = 80

    // Build graph
    const tableMap = new Map(TABLES.map(t => [t.table, t]))
    const allEdges: GraphEdge[] = []

    // Generate edges from dependsOn
    TABLES.forEach(t => {
      t.dependsOn.forEach(dep => {
        if (tableMap.has(dep)) {
          allEdges.push({ from: dep, to: t.table })
        }
      })
    })

    // Compute depth for each node (topological sort)
    const depthMap = new Map<string, number>()
    const visited = new Set<string>()

    function computeDepth(name: string): number {
      if (depthMap.has(name)) return depthMap.get(name)!
      if (visited.has(name)) return 0 // cycle protection
      visited.add(name)

      const table = tableMap.get(name)
      if (!table || table.dependsOn.length === 0) {
        depthMap.set(name, 0)
        return 0
      }

      let maxDepth = 0
      for (const dep of table.dependsOn) {
        if (tableMap.has(dep)) {
          maxDepth = Math.max(maxDepth, computeDepth(dep) + 1)
        }
      }
      depthMap.set(name, maxDepth)
      return maxDepth
    }

    TABLES.forEach(t => computeDepth(t.table))

    // Group by depth
    const layers = new Map<number, string[]>()
    let maxDepthVal = 0
    depthMap.forEach((depth, name) => {
      if (!layers.has(depth)) layers.set(depth, [])
      layers.get(depth)!.push(name)
      maxDepthVal = Math.max(maxDepthVal, depth)
    })

    // Identify orphans (no dependsOn AND no downstream)
    const orphanList: string[] = []
    TABLES.forEach(t => {
      const hasUpstream = t.dependsOn.length > 0 && t.dependsOn.some(d => tableMap.has(d))
      const hasDownstream = t.downstream.length > 0 && t.downstream.some(d => tableMap.has(d))
      if (!hasUpstream && !hasDownstream) {
        orphanList.push(t.table)
      }
    })

    // Position nodes
    const positionedNodes: GraphNode[] = []
    const svgW = 1200
    const layerWidth = svgW / (maxDepthVal + 2)

    layers.forEach((names, depth) => {
      // Sort names within each layer for consistent layout
      const sorted = [...names].sort((a, b) => {
        const ta = tableMap.get(a)
        const tb = tableMap.get(b)
        return (ta?.sort || '').localeCompare(tb?.sort || '')
      })

      const totalH = sorted.length * (nodeH + hGap / 2) - hGap / 2
      const startY = Math.max(40, (600 - totalH) / 2)

      sorted.forEach((name, i) => {
        const table = tableMap.get(name)!
        positionedNodes.push({
          table: name,
          cn: table.cn,
          dir: table.dir,
          rows: table.rows,
          health: table.health,
          dependsOn: table.dependsOn,
          x: depth * layerWidth + layerWidth / 2 - nodeW / 2 + 40,
          y: startY + i * (nodeH + hGap / 2),
          width: nodeW,
          height: nodeH,
        })
      })
    })

    // Add orphan nodes in a separate area (right side)
    const orphanStartX = (maxDepthVal + 1) * layerWidth + 40
    orphanList.forEach((name, i) => {
      const table = tableMap.get(name)!
      positionedNodes.push({
        table: name,
        cn: table.cn,
        dir: table.dir,
        rows: table.rows,
        health: table.health,
        dependsOn: table.dependsOn,
        x: orphanStartX,
        y: 40 + i * (nodeH + hGap / 2),
        width: nodeW,
        height: nodeH,
      })
    })

    return { nodes: positionedNodes, edges: allEdges, orphanNodes: orphanList }
  }, [])

  // Get dependency chain for selected node
  const highlightedNodes = useMemo(() => {
    if (!selectedNode) return new Set<string>()
    const chain = new Set<string>()
    const tableMap = new Map(TABLES.map(t => [t.table, t]))

    // Walk upstream
    function walkUp(name: string) {
      if (chain.has(name)) return
      chain.add(name)
      const table = tableMap.get(name)
      if (table) {
        table.dependsOn.forEach(d => {
          if (tableMap.has(d)) walkUp(d)
        })
      }
    }

    // Walk downstream
    function walkDown(name: string) {
      if (chain.has(name)) return
      chain.add(name)
      const table = tableMap.get(name)
      if (table) {
        table.downstream.forEach(d => {
          if (tableMap.has(d)) walkDown(d)
        })
      }
    }

    walkUp(selectedNode)
    walkDown(selectedNode)
    return chain
  }, [selectedNode])

  const getNodeColor = (node: GraphNode) => {
    if (node.dir === '1_入库') return { fill: '#dbeafe', stroke: '#3b82f6', text: '#1d4ed8', darkFill: '#1e3a5f', darkStroke: '#3b82f6', darkText: '#93c5fd' }
    if (node.dir === '2_计算') return { fill: '#dcfce7', stroke: '#22c55e', text: '#15803d', darkFill: '#14532d', darkStroke: '#22c55e', darkText: '#86efac' }
    if (node.dir === '3_策略') return { fill: '#fef3c7', stroke: '#f59e0b', text: '#92400e', darkFill: '#451a03', darkStroke: '#f59e0b', darkText: '#fcd34d' }
    return { fill: '#f3f4f6', stroke: '#6b7280', text: '#374151', darkFill: '#1f2937', darkStroke: '#6b7280', darkText: '#9ca3af' }
  }

  // Node size based on row count (log scale)
  const getNodeScale = (rows: number) => {
    const logRows = Math.log10(Math.max(rows, 1))
    // Range from 1 (10^0=1 row) to ~1.3 (10^8 rows)
    return Math.min(1 + (logRows / 8) * 0.4, 1.4)
  }

  const svgW = 1400
  const svgH = 700

  // Pan handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    setIsPanning(true)
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [pan])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return
    setPan({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    })
  }, [isPanning, panStart])

  const handlePointerUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(prev => Math.max(0.3, Math.min(3, prev + delta)))
  }, [])

  // Tooltip for hovered node
  const [tooltipData, setTooltipData] = useState<{ node: GraphNode; x: number; y: number } | null>(null)

  return (
    <Card>
      <CardContent className="p-4">
        {/* Controls */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Network className="h-4 w-4 text-fuchsia-500" />
            <span className="font-medium">表依赖关系图</span>
            <Badge variant="secondary" className="text-[10px]">{nodes.length} 节点 · {edges.length} 边</Badge>
            {orphanNodes.length > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">{orphanNodes.length} 孤立表</Badge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.min(3, z + 0.2))}>
              <ZoomIn className="h-3 w-3" />
            </Button>
            <span className="text-[10px] text-zinc-500 w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.max(0.3, z - 0.2))}>
              <ZoomOut className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>
              <Maximize2 className="h-3 w-3 mr-1" /> 重置
            </Button>
          </div>
        </div>

        {/* SVG Graph */}
        <div
          ref={svgContainerRef}
          className="border rounded-lg overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/50"
          style={{ height: svgH }}
          onWheel={handleWheel}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${svgW} ${svgH}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={isPanning ? 'cursor-grabbing' : 'cursor-grab'}
            style={{ userSelect: 'none' }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Arrow marker definition */}
              <defs>
                <marker id="depArrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#a78bfa" />
                </marker>
                <marker id="depArrowHighlight" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#d946ef" />
                </marker>
              </defs>

              {/* Orphan group label */}
              {orphanNodes.length > 0 && (
                <g>
                  <rect
                    x={nodes.find(n => orphanNodes.includes(n.table))?.x ?? 0 - 10}
                    y={10}
                    width={170}
                    height={orphanNodes.length * 80 + 30}
                    rx={8}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1}
                    strokeDasharray="6,3"
                    opacity={0.5}
                  />
                  <text
                    x={(nodes.find(n => orphanNodes.includes(n.table))?.x ?? 0) + 75}
                    y={26}
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-amber-500"
                  >
                    孤立表
                  </text>
                </g>
              )}

              {/* Edges */}
              {edges.map(edge => {
                const fromNode = nodes.find(n => n.table === edge.from)
                const toNode = nodes.find(n => n.table === edge.to)
                if (!fromNode || !toNode) return null

                const isHighlighted = selectedNode && highlightedNodes.has(edge.from) && highlightedNodes.has(edge.to)
                const fromCx = fromNode.x + fromNode.width / 2
                const fromCy = fromNode.y + fromNode.height / 2
                const toCx = toNode.x + toNode.width / 2
                const toCy = toNode.y + toNode.height / 2

                // Compute edge start/end on node borders
                const dx = toCx - fromCx
                const dy = toCy - fromCy
                const dist = Math.sqrt(dx * dx + dy * dy) || 1

                // Simplified: start from right side of fromNode, end at left side of toNode
                const startX = fromNode.x + fromNode.width
                const startY = fromCy
                const endX = toNode.x
                const endY = toCy

                // Bezier control point
                const midX = (startX + endX) / 2

                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke={isHighlighted ? '#d946ef' : '#a78bfa'}
                    strokeWidth={isHighlighted ? 2 : 1}
                    opacity={isHighlighted ? 0.9 : selectedNode ? 0.15 : 0.4}
                    markerEnd={isHighlighted ? 'url(#depArrowHighlight)' : 'url(#depArrow)'}
                    style={{ transition: 'stroke 0.2s, opacity 0.2s, stroke-width 0.2s' }}
                  />
                )
              })}

              {/* Nodes */}
              {nodes.map(node => {
                const colors = getNodeColor(node)
                const scale = getNodeScale(node.rows)
                const isSelected = selectedNode === node.table
                const isInChain = highlightedNodes.has(node.table)
                const isDimmed = selectedNode && !isInChain
                const isHovered = hoveredNode === node.table

                const w = node.width * scale
                const h = node.height * scale
                const x = node.x + (node.width - w) / 2
                const y = node.y + (node.height - h) / 2

                return (
                  <g
                    key={node.table}
                    onClick={() => setSelectedNode(prev => prev === node.table ? null : node.table)}
                    onPointerEnter={(e) => {
                      setHoveredNode(node.table)
                      const rect = svgContainerRef.current?.getBoundingClientRect()
                      if (rect) {
                        setTooltipData({
                          node,
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                        })
                      }
                    }}
                    onPointerLeave={() => {
                      setHoveredNode(null)
                      setTooltipData(null)
                    }}
                    className="cursor-pointer"
                  >
                    {/* Node rectangle */}
                    <rect
                      x={x} y={y}
                      width={w} height={h}
                      rx={6}
                      fill={colors.fill}
                      stroke={isSelected ? '#d946ef' : colors.stroke}
                      strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1}
                      opacity={isDimmed ? 0.25 : 1}
                      style={{
                        filter: isSelected ? 'brightness(1.1)' : isHovered ? 'brightness(1.05)' : undefined,
                        transition: 'filter 0.15s, opacity 0.15s, stroke-width 0.15s',
                      }}
                    />

                    {/* Selected ring */}
                    {isSelected && (
                      <rect
                        x={x - 3} y={y - 3}
                        width={w + 6} height={h + 6}
                        rx={8}
                        fill="none"
                        stroke="#d946ef"
                        strokeWidth={1.5}
                        strokeDasharray="4,2"
                        opacity={0.6}
                      />
                    )}

                    {/* Table name */}
                    <text
                      x={x + w / 2}
                      y={y + h / 2 - 5}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={9}
                      fontFamily="monospace"
                      fontWeight="bold"
                      className="fill-zinc-700 dark:fill-zinc-200"
                      opacity={isDimmed ? 0.4 : 1}
                    >
                      {node.table.length > 14 ? node.table.slice(0, 13) + '…' : node.table}
                    </text>

                    {/* Chinese name */}
                    <text
                      x={x + w / 2}
                      y={y + h / 2 + 8}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={8}
                      className="fill-zinc-500 dark:fill-zinc-400"
                      opacity={isDimmed ? 0.4 : 1}
                    >
                      {node.cn.length > 10 ? node.cn.slice(0, 9) + '…' : node.cn}
                    </text>

                    {/* Health indicator dot */}
                    <circle
                      cx={x + w - 8}
                      cy={y + 8}
                      r={3}
                      fill={
                        node.health === 'green' ? '#22c55e' :
                        node.health === 'red' ? '#ef4444' :
                        node.health === 'yellow' ? '#eab308' : '#9ca3af'
                      }
                      opacity={isDimmed ? 0.3 : 0.9}
                    />
                  </g>
                )
              })}
            </g>
          </svg>

          {/* Hover tooltip */}
          {tooltipData && (
            <div
              className="absolute z-50 pointer-events-none rounded-lg border bg-card p-3 shadow-lg text-xs max-w-[240px]"
              style={{ left: Math.min(tooltipData.x + 12, svgW - 250), top: tooltipData.y - 120 }}
            >
              <div className="font-medium font-mono text-sm mb-1">{tooltipData.node.table}</div>
              <div className="text-zinc-500 mb-1.5">{tooltipData.node.cn}</div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-zinc-400">目录</span><span>{tooltipData.node.dir}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">行数</span><span className="font-mono">{formatRows(tooltipData.node.rows)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">健康度</span>
                  <span className={
                    tooltipData.node.health === 'green' ? 'text-emerald-600' :
                    tooltipData.node.health === 'red' ? 'text-rose-600' :
                    'text-amber-600'
                  }>
                    {tooltipData.node.health}
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-zinc-400">上游依赖</span><span>{tooltipData.node.dependsOn.length}</span></div>
              </div>
              <div className="mt-1.5 pt-1 border-t text-[10px] text-zinc-400">点击节点高亮依赖链</div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500 flex-wrap">
          <span className="font-medium text-xs flex items-center gap-1"><GitBranch className="h-3.5 w-3.5 text-fuchsia-500" /> 图例</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded border-2 border-blue-400 bg-blue-100 dark:bg-blue-950/40" /> 1_入库
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded border-2 border-green-400 bg-green-100 dark:bg-green-950/40" /> 2_计算
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded border-2 border-amber-400 bg-amber-100 dark:bg-amber-950/40" /> 3_策略
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded border-2 border-zinc-400 bg-zinc-100 dark:bg-zinc-800/40" /> 4_工具
          </span>
          <span className="flex items-center gap-1.5 ml-2">
            <span className="inline-block w-3 h-3 rounded-full bg-green-500" /> green
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-amber-500" /> yellow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> red
          </span>
          <span className="ml-auto text-zinc-400">滚轮缩放 · 拖拽平移 · 点击高亮</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function CatalogView({ onNavigate, onRunTable }: { onNavigate: (v: string) => void; onRunTable?: (t: string) => void }) {
  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [healthFilter, setHealthFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'dir' | 'rows' | 'freshness' | 'table'>('dir')
  const [selected, setSelected] = useState<TableMeta | null>(null)
  const [expandedDepGraph, setExpandedDepGraph] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')

  const filtered = useMemo(() => {
    const result = TABLES.filter(t => {
      if (search && !t.table.includes(search.toLowerCase()) && !t.cn.includes(search)) return false
      if (dirFilter !== 'all' && t.dir !== dirFilter) return false
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (healthFilter !== 'all' && t.health !== healthFilter) return false
      return true
    })
    result.sort((a, b) => {
      if (sortBy === 'rows') return b.rows - a.rows
      if (sortBy === 'table') return a.table.localeCompare(b.table)
      if (sortBy === 'freshness') {
        const order = { '最新': 0, '滞后': 1, '无日期列': 2, '空表': 3, '—': 4 }
        return (order[a.freshness as keyof typeof order] ?? 5) - (order[b.freshness as keyof typeof order] ?? 5)
      }
      // default: dir
      if (a.dir !== b.dir) return a.dir.localeCompare(b.dir)
      return a.sort.localeCompare(b.sort)
    })
    return result
  }, [search, dirFilter, typeFilter, healthFilter, sortBy])

  const toggleDepGraph = (tableName: string) => {
    setExpandedDepGraph(prev => prev === tableName ? null : tableName)
  }

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="搜索表名 / 中文名..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <FilterGroup label="目录" value={dirFilter} onChange={setDirFilter} options={[
              { v: 'all', l: '全部' }, { v: '1_入库', l: '1_入库' }, { v: '2_计算', l: '2_计算' },
            ]} />
            <FilterGroup label="类型" value={typeFilter} onChange={setTypeFilter} options={[
              { v: 'all', l: '全部' }, { v: '事实', l: '事实' }, { v: '维度', l: '维度' },
              { v: '多表', l: '多表' }, { v: '孤儿', l: '孤儿' },
            ]} />
            <FilterGroup label="健康度" value={healthFilter} onChange={setHealthFilter} options={[
              { v: 'all', l: '全部' }, { v: 'green', l: '正常' }, { v: 'yellow', l: '待查' }, { v: 'red', l: '异常' }, { v: 'white', l: 'once' },
            ]} />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400 flex items-center gap-1"><Filter className="h-3 w-3" />排序</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {([['dir', '目录'], ['rows', '行数'], ['freshness', '新鲜度'], ['table', '表名']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setSortBy(k)} className={`px-2 py-0.5 text-xs rounded transition-colors ${sortBy === k ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{l}</button>
                ))}
              </div>
            </div>
            <Badge variant="secondary" className="ml-auto">{filtered.length} / {TABLES.length}</Badge>

            {/* View mode toggle */}
            <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${viewMode === 'list' ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
              >
                <FileText className="h-3 w-3" /> 列表
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${viewMode === 'graph' ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
              >
                <Network className="h-3 w-3" /> 依赖图
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View mode content */}
      {viewMode === 'graph' ? (
        <DependencyGraphView />
      ) : (
        /* 表格 */
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh_-_280px)]">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[44px_1fr_120px_80px_90px_70px_90px_100px_110px_110px] gap-2 px-3 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                  <div>类型</div>
                  <div>表名 / 中文名</div>
                  <div>脚本</div>
                  <div>sort</div>
                  <div>目录</div>
                  <div>schedule</div>
                  <div>mode</div>
                  <div className="text-right">行数</div>
                  <div>最新日期</div>
                  <div className="text-center">操作</div>
                </div>
                {filtered.map(t => (
                  <div key={t.table}>
                    <button
                      onClick={() => setSelected(t)}
                      className="w-full grid grid-cols-[44px_1fr_120px_80px_90px_70px_90px_100px_110px_110px] gap-2 px-3 py-2 text-xs items-center border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 text-left transition-colors"
                    >
                      <div><span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadgeClass(t.type)}`}>{t.type}</span></div>
                      <div className="min-w-0">
                        <div className="font-mono font-medium truncate flex items-center gap-1.5">
                          {t.table}
                          {t.hasLintIssue && <span title="有 lint 违规" className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">{t.cn}</div>
                      </div>
                      <div className="font-mono text-[10px] text-zinc-500 truncate" title={t.script}>{t.script}</div>
                      <div className="font-mono text-zinc-500">{t.sort}</div>
                      <div className="text-zinc-500">{t.dir}</div>
                      <div className="text-zinc-600 dark:text-zinc-400">{t.schedule}</div>
                      <div><Badge variant="outline" className="text-[10px] py-0 px-1.5">{t.mode}</Badge></div>
                      <div className="text-right font-mono text-zinc-600 dark:text-zinc-400">{formatRows(t.rows)}</div>
                      <div className={`font-mono text-[11px] ${freshnessClass(t.freshness)}`}>{t.maxDate || '—'}</div>
                      <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                        <span className={`h-2.5 w-2.5 rounded-full ${healthColorClass(t.health).split(' ')[0]}`} title={t.freshness} />
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleDepGraph(t.table) }}
                          className={`p-1 rounded hover:bg-sky-100 dark:hover:bg-sky-900/30 transition-colors ${expandedDepGraph === t.table ? 'text-sky-600 bg-sky-50 dark:bg-sky-950/40' : 'text-zinc-400 hover:text-sky-500'}`}
                          title="依赖图"
                          aria-label="查看依赖图"
                        >
                          <Share2 className="h-3 w-3" />
                        </button>
                      </div>
                    </button>
                    {/* Expanded dependency mini-graph */}
                    {expandedDepGraph === t.table && (
                      <div className="border-b bg-zinc-50/50 dark:bg-zinc-900/30 px-4 py-2 animate-fade-in">
                        <div className="flex items-center gap-2 mb-1">
                          <Share2 className="h-3 w-3 text-fuchsia-500" />
                          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">依赖关系图</span>
                          <span className="text-[10px] text-zinc-400">上游 {t.dependsOn.length} · 下游 {t.downstream.length}</span>
                          <div className="ml-auto flex items-center gap-3 text-[10px] text-zinc-400">
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-200 dark:bg-sky-800 border border-sky-400" />上游</span>
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-fuchsia-200 dark:bg-fuchsia-800 border border-fuchsia-400" />当前</span>
                            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-200 dark:bg-emerald-800 border border-emerald-400" />下游</span>
                          </div>
                        </div>
                        <DependencyMiniGraph table={t} />
                      </div>
                    )}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="py-16 text-center text-zinc-400 text-sm">无匹配表</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* 详情抽屉 */}
      <Sheet open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
          {selected && <TableDetail table={selected} onNavigate={onNavigate} onRunTable={onRunTable} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function FilterGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-400 flex items-center gap-1"><Filter className="h-3 w-3" />{label}</span>
      <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${value === o.v ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}

function TableDetail({ table, onNavigate, onRunTable }: { table: TableMeta; onNavigate: (v: string) => void; onRunTable?: (t: string) => void }) {
  const [activeTab, setActiveTab] = useState<'schema' | 'sample' | 'history' | 'lint'>('schema')
  const sampleData = useMemo(() => genSampleData(table), [table])
  const columnIssues = useMemo(() => getColumnLintIssues(table), [table])
  const tableRuns = useMemo(() => PIPELINE_RUNS.filter(r => r.table === table.table), [table])
  const tableLintRules = useMemo(() => LINT_RULES.filter(r => r.violations.some(v => v.table === table.table)), [table])

  const copyTableName = () => {
    navigator.clipboard?.writeText(table.table)
    toast.success(`已复制表名：${table.table}`)
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${typeBadgeClass(table.type)}`}>{table.type}</span>
          <span className="font-mono">{table.table}</span>
          <button onClick={copyTableName} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400" title="复制表名">
            <Copy className="h-3 w-3" />
          </button>
          {table.hasLintIssue && <Badge variant="outline" className="text-rose-600 border-rose-300 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />lint</Badge>}
        </SheetTitle>
        <p className="text-sm text-zinc-500 -mt-2">{table.cn}</p>
      </SheetHeader>

      <div className="space-y-4 px-4 pb-8">
        {/* 元数据 */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Meta label="脚本" value={table.script} mono />
          <Meta label="sort" value={table.sort} mono />
          <Meta label="目录" value={table.dir} />
          <Meta label="数据源" value={table.source} />
          <Meta label="schedule" value={table.schedule} />
          <Meta label="mode" value={table.mode} />
          <Meta label="去重键" value={table.dedupKey.join(', ') || '—'} mono />
          <Meta label="重试" value={`${table.retryConfig.max}次 / ${table.retryConfig.backoff}s`} />
        </div>

        {/* 健康度 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] text-zinc-500">行数</div>
                <div className="text-lg font-mono font-semibold">{formatRows(table.rows)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">最新日期</div>
                <div className={`text-sm font-mono ${freshnessClass(table.freshness)}`}>{table.maxDate || '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">新鲜度</div>
                <div className={`text-sm font-medium ${freshnessClass(table.freshness)}`}>{table.freshness}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">健康度</div>
                <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${healthColorClass(table.health)}`}>{table.health === 'green' ? '正常' : table.health === 'red' ? '异常' : '—'}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 操作 */}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => onRunTable?.(table.table)}><Play className="h-3.5 w-3.5 mr-1" />立即执行</Button>
          <Button size="sm" variant="outline" onClick={() => onRunTable?.(table.table)}><RefreshCw className="h-3.5 w-3.5 mr-1" />强制重跑</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate('lineage')}><GitBranch className="h-3.5 w-3.5 mr-1" />查血缘</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate('logs')}><FileText className="h-3.5 w-3.5 mr-1" />查日志</Button>
        </div>

        {/* Tabs: Schema / Sample Data / Run History / Lint */}
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'schema' | 'sample' | 'history' | 'lint')}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="schema" className="text-xs gap-1">
              <Database className="h-3 w-3" /> Schema
              <span className="text-[10px] text-zinc-400">{table.columns.length}</span>
            </TabsTrigger>
            <TabsTrigger value="sample" className="text-xs gap-1">
              <Table2 className="h-3 w-3" /> 样例
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1">
              <History className="h-3 w-3" /> 历史
              <span className="text-[10px] text-zinc-400">{tableRuns.length}</span>
            </TabsTrigger>
            <TabsTrigger value="lint" className="text-xs gap-1">
              <ListChecks className="h-3 w-3" /> Lint
              {tableLintRules.length > 0 && <span className="text-[10px] text-rose-500">{tableLintRules.length}</span>}
            </TabsTrigger>
          </TabsList>

          {/* Schema Tab */}
          <TabsContent value="schema" className="mt-3">
            <div className="rounded-md border overflow-hidden">
              <div className="grid grid-cols-[1fr_90px_1fr_50px] gap-2 px-2 py-1.5 text-[10px] font-medium text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50">
                <div>列名</div><div>类型</div><div>中文</div><div className="text-center">可空</div>
              </div>
              {table.columns.map(c => {
                const hasIssue = columnIssues.some(i => i.column === c.name)
                return (
                  <div key={c.name} className={`grid grid-cols-[1fr_90px_1fr_50px] gap-2 px-2 py-1.5 text-xs border-t font-mono ${hasIssue ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''}`}>
                    <div className="truncate flex items-center gap-1" title={c.name}>
                      <span className={hasIssue ? 'text-rose-600 dark:text-rose-400' : ''}>{c.name}</span>
                      {hasIssue && <AlertTriangle className="h-3 w-3 text-rose-500 flex-shrink-0" />}
                    </div>
                    <div className="text-sky-600 dark:text-sky-400">{c.type}</div>
                    <div className="text-zinc-500 font-sans truncate">{c.cn}</div>
                    <div className="text-center text-zinc-400">{c.nullable ? '✓' : '—'}</div>
                  </div>
                )
              })}
            </div>
          </TabsContent>

          {/* Sample Data Tab */}
          <TabsContent value="sample" className="mt-3">
            <div className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
              <Table2 className="h-3 w-3" /> 前 {sampleData.rows.length} 行样例数据（mock）
            </div>
            <div className="rounded-md border overflow-x-auto">
              <div className="min-w-full">
                <div className="grid auto-cols-min grid-flow-col gap-0 bg-zinc-50 dark:bg-zinc-900/50 border-b">
                  {sampleData.columns.map(c => (
                    <div key={c} className="px-2 py-1.5 text-[10px] font-medium text-zinc-500 font-mono whitespace-nowrap border-r">{c}</div>
                  ))}
                </div>
                {sampleData.rows.map((row, i) => (
                  <div key={i} className="grid auto-cols-min grid-flow-col gap-0 text-xs border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 font-mono">
                    {row.map((cell, j) => (
                      <div key={j} className={`px-2 py-1 whitespace-nowrap border-r ${typeof cell === 'number' ? 'text-sky-600 dark:text-sky-400 text-right' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        {String(cell)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 text-[10px] text-zinc-400 flex items-center gap-2">
              <Database className="h-3 w-3" />
              <span>共 {formatRows(table.rows)} 行 · 显示前 {sampleData.rows.length} 行样例</span>
            </div>
          </TabsContent>

          {/* Run History Tab */}
          <TabsContent value="history" className="mt-3">
            {tableRuns.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">该表暂无执行记录</div>
            ) : (
              <div className="space-y-1.5">
                {tableRuns.map(r => (
                  <div key={r.id} className="p-2 rounded border border-zinc-200 dark:border-zinc-700 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] text-zinc-400">#{r.id}</span>
                      <Badge variant="outline" className={`text-[9px] py-0 px-1.5 ${triggerClass(r.trigger)}`}>{r.trigger}</Badge>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${runStatusClass(r.status)}`}>
                        {r.status === 'success' && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                        {r.status === 'failed' && <XCircle className="h-3 w-3 mr-0.5" />}
                        {r.status === 'skipped' && <SkipForward className="h-3 w-3 mr-0.5" />}
                        {r.status}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-400">{r.startedAt.slice(5)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                      <span>耗时 {formatDuration(r.durationSec)}</span>
                      <span>·</span>
                      <span>入库 {r.rowsIn ? formatRows(r.rowsIn) : '—'} 行</span>
                      {r.force && <Badge variant="outline" className="text-[9px] py-0 px-1 text-amber-600 border-amber-300">force</Badge>}
                    </div>
                    {r.error && (
                      <div className="mt-1 p-1.5 rounded bg-rose-50 dark:bg-rose-950/30 text-[10px] text-rose-700 dark:text-rose-300 font-mono">
                        {r.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Lint Tab */}
          <TabsContent value="lint" className="mt-3">
            {tableLintRules.length === 0 && columnIssues.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <span>该表无 lint 违规</span>
              </div>
            ) : (
              <div className="space-y-2">
                {/* 表级 lint 违规 */}
                {tableLintRules.map(rule => {
                  const violations = rule.violations.filter(v => v.table === table.table)
                  return violations.map((v, i) => (
                    <div key={`${rule.id}-${i}`} className="p-2.5 rounded border border-zinc-200 dark:border-zinc-700 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={`text-[9px] py-0 px-1.5 font-mono ${rule.level === 'RED' ? 'text-rose-600 border-rose-300' : rule.level === 'YELLOW' ? 'text-amber-600 border-amber-300' : 'text-sky-600 border-sky-300'}`}>
                          {rule.level}
                        </Badge>
                        <span className="font-mono font-medium">{rule.id}</span>
                        <span className="text-zinc-600 dark:text-zinc-400">{rule.name}</span>
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400 mb-1.5">{v.detail}</div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-start gap-1">
                        <RefreshCw className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{v.fix}</span>
                      </div>
                    </div>
                  ))
                })}
                {/* 列级 lint 违规 */}
                {columnIssues.length > 0 && (
                  <div className="p-2.5 rounded border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-xs">
                    <div className="font-medium text-rose-700 dark:text-rose-300 mb-1.5 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> R004: 中文列名 ({columnIssues.length})
                    </div>
                    <div className="space-y-1">
                      {columnIssues.map((issue, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-rose-600 dark:text-rose-400">{issue.column}</span>
                          <span className="text-zinc-400">→</span>
                          <span className="text-emerald-600 dark:text-emerald-400">{issue.fix}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button size="sm" variant="link" className="h-auto p-0 text-xs text-sky-600" onClick={() => onNavigate('lint')}>查看全部 lint 规则 →</Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* 依赖关系（始终展示） */}
        <div>
          <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />依赖关系</div>
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">上游（依赖的库内表）</div>
              <div className="flex flex-wrap gap-1">
                {table.dependsOn.length === 0 ? <span className="text-xs text-zinc-400">无</span> :
                  table.dependsOn.map(d => <Badge key={d} variant="secondary" className="font-mono text-[10px]">{d}</Badge>)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">外部数据源</div>
              <div className="flex flex-wrap gap-1">
                {table.sourceDeps.length === 0 ? <span className="text-xs text-zinc-400">无</span> :
                  table.sourceDeps.map(d => <Badge key={d} variant="outline" className="font-mono text-[10px]">{d}</Badge>)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">下游（被依赖的表）</div>
              <div className="flex flex-wrap gap-1">
                {table.downstream.length === 0 ? <span className="text-xs text-zinc-400">无</span> :
                  table.downstream.map(d => <Badge key={d} variant="secondary" className="font-mono text-[10px]">{d}</Badge>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className={`text-xs ${mono ? 'font-mono' : ''} text-zinc-700 dark:text-zinc-300 truncate`} title={value}>{value}</div>
    </div>
  )
}
