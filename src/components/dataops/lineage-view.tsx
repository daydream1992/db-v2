'use client'
import { useState, useMemo, useRef } from 'react'
import { TABLES, TableMeta } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { GitBranch, ArrowDown, ArrowUp, Box, Search, Maximize2, ZoomIn, ZoomOut, Layers, Activity, Database, Network, Map as MapIcon, X } from 'lucide-react'
import { formatRows, healthColorClass, typeBadgeClass } from '@/lib/dataops/styles'

interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  type: 'external' | 'table'
  health: string
  meta?: TableMeta
}

interface GraphEdge {
  from: string
  to: string
  type: 'internal' | 'external'
}

// 预分层布局（4 层：外部源 / L1入库 / L2计算 / L3聚合）
const LAYERS = [
  { name: '外部数据源', y: 80, tables: ['TQ API', 'TDX .day', 'TDX .lc5', 'TDX .lc1', 'TDX gpsz', 'TDX signals'] },
  { name: 'L1 基础入库', y: 240, tables: ['trading_calendar', 'stock_daily_kline', 'stock_kline_5m', 'stock_kline_1m', 'capital_info', 'stock_financial_data', 'stock_block_relation', 'market_sc1_42', 'stock_gp1_46_indicators', 'stock_signals_20001_20011', 'stock_industry_3level'] },
  { name: 'L2 派生计算', y: 460, tables: ['stock_kline_15m', 'stock_kline_30m', 'stock_kline_60m', 'stock_kline_weekly', 'stock_kline_monthly', 'dim_security_type', 'dim_industry_code', 'pianpao_daily'] },
  { name: 'L3 聚合视图', y: 620, tables: ['pianpao_daily_summary', 'dim_gp_indicator'] },
]

export function LineageView() {
  const [focus, setFocus] = useState<string>('stock_daily_kline')
  const [depth, setDepth] = useState(2)
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<Set<string>>(new Set())
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [showMinimap, setShowMinimap] = useState(true)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragStartRef = useRef<{ nodeId: string; startMouse: { x: number; y: number }; startNode: { x: number; y: number } } | null>(null)

  // 计算上下游 N 层
  const graph = useMemo(() => {
    const upstream = new Set<string>()
    const downstream = new Set<string>()

    const collectUp = (table: string, d: number) => {
      if (d <= 0) return
      const t = TABLES.find(x => x.table === table)
      if (!t) return
      for (const dep of t.dependsOn) {
        upstream.add(dep)
        collectUp(dep, d - 1)
      }
    }
    const collectDown = (table: string, d: number) => {
      if (d <= 0) return
      for (const t of TABLES) {
        if (t.dependsOn.includes(table)) {
          downstream.add(t.table)
          collectDown(t.table, d - 1)
        }
      }
    }
    collectUp(focus, depth)
    collectDown(focus, depth)
    return { upstream, downstream }
  }, [focus, depth])

  // 计算选中节点的路径（从 focus 出发的上下游链路）
  const highlightSet = useMemo(() => {
    const s = new Set<string>([focus])
    graph.upstream.forEach(t => s.add(t))
    graph.downstream.forEach(t => s.add(t))
    return s
  }, [focus, graph])

  // 构建节点 + 边
  const { nodes, edges } = useMemo(() => {
    const ns: GraphNode[] = []
    const es: GraphEdge[] = []

    // 外部源节点
    LAYERS[0].tables.forEach((id, i) => {
      ns.push({ id, label: id, x: 80 + i * 130, y: LAYERS[0].y, type: 'external', health: 'external' })
    })

    // 表节点
    LAYERS.slice(1).forEach(layer => {
      layer.tables.forEach((id, i) => {
        const meta = TABLES.find(t => t.table === id)
        if (meta) {
          ns.push({ id, label: id, x: 80 + i * 130, y: layer.y, type: 'table', health: meta.health, meta })
        }
      })
    })

    // 边：外部源 → L1 表
    TABLES.forEach(t => {
      t.sourceDeps.forEach(src => {
        // 简化匹配：根据 sourceDeps 里的字符串匹配外部节点
        const matched = LAYERS[0].tables.find(ext => src.includes(ext.split(' ')[1]) || ext.includes(src))
        if (matched) {
          es.push({ from: matched, to: t.table, type: 'external' })
        }
      })
    })

    // 边：表 → 表
    TABLES.forEach(t => {
      t.dependsOn.forEach(dep => {
        es.push({ from: dep, to: t.table, type: 'internal' })
      })
    })

    return { nodes: ns, edges: es }
  }, [])

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    nodes.forEach(n => m.set(n.id, n))
    return m
  }, [nodes])

  const focused = TABLES.find(t => t.table === focus)

  const isHighlighted = (id: string) => highlightSet.has(id) || hovered === id
  const isDimmed = (id: string) => (highlightSet.size > 1 || hovered) && !isHighlighted(id)

  const onNodeClick = (id: string) => {
    if (nodeById.get(id)?.type === 'table') {
      setFocus(id)
      setSelectedPath(new Set())
    }
  }

  // SVG 视图尺寸
  const viewW = 1700
  const viewH = 720

  // 获取节点的实际位置（含 override）
  const getNodePos = (node: GraphNode) => nodeOverrides[node.id] || { x: node.x, y: node.y }

  // 拖拽处理
  const onNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
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
  }

  const onSvgMouseMove = (e: React.MouseEvent) => {
    if (!dragStartRef.current) return
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
        x: Math.max(0, Math.min(viewW - 100, ds.startNode.x + dx)),
        y: Math.max(40, Math.min(viewH - 40, ds.startNode.y + dy)),
      },
    }))
  }

  const onSvgMouseUp = () => {
    dragStartRef.current = null
    setDragging(null)
  }

  const resetView = () => {
    setZoom(1)
    setFocus('stock_daily_kline')
    setSelectedPath(new Set())
    setNodeOverrides({})
  }

  return (
    <div className="space-y-4">
      {/* 控制栏 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="输入表名作为焦点..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
                onKeyDown={e => { if (e.key === 'Enter' && TABLES.find(t => t.table === search)) setFocus(search) }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 flex items-center gap-1"><Layers className="h-3 w-3" />展开层数</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {[1, 2, 3].map(d => (
                  <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-0.5 text-xs rounded ${depth === d ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{d}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 border-l pl-3">
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setZoom(z => Math.max(0.5, z - 0.2))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-zinc-500 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setZoom(z => Math.min(2, z + 0.2))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={resetView} title="重置">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Badge variant="secondary" className="text-xs">
              <Network className="h-3 w-3 mr-1" />
              焦点：{focus}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* SVG 图谱 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-fuchsia-500" />
              血缘关系图谱
              <Badge variant="outline" className="ml-2 text-[10px]">{nodes.length} 节点 · {edges.length} 边</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative overflow-auto bg-zinc-50/50 dark:bg-zinc-950/30" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${viewW} ${viewH}`}
                width={viewW * zoom}
                height={viewH * zoom}
                className="mx-auto"
                style={{ minWidth: viewW * 0.5 }}
                onMouseMove={onSvgMouseMove}
                onMouseUp={onSvgMouseUp}
                onMouseLeave={onSvgMouseUp}
              >
                <defs>
                  {/* 箭头标记 */}
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

                {/* 层分隔线 + 标签 */}
                {LAYERS.map((layer, i) => (
                  <g key={layer.name}>
                    <line x1={0} y1={layer.y - 60} x2={viewW} y2={layer.y - 60} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="4 4" strokeWidth={1} />
                    <text x={8} y={layer.y - 65} className="fill-zinc-400 text-[11px] font-mono">{layer.name}</text>
                  </g>
                ))}

                {/* 边 */}
                {edges.map((edge, i) => {
                  const from = nodeById.get(edge.from)
                  const to = nodeById.get(edge.to)
                  if (!from || !to) return null
                  const fromPos = getNodePos(from)
                  const toPos = getNodePos(to)
                  const isHL = (isHighlighted(edge.from) && isHighlighted(edge.to)) || hovered === edge.from || hovered === edge.to
                  const isDim = (highlightSet.size > 1 || hovered) && !isHL
                  // 贝塞尔曲线：从 from 底部到 to 顶部
                  const x1 = fromPos.x + 50
                  const y1 = fromPos.y + 18
                  const x2 = toPos.x + 50
                  const y2 = toPos.y - 18
                  const midY = (y1 + y2) / 2
                  const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
                  return (
                    <path
                      key={i}
                      d={path}
                      fill="none"
                      stroke={isHL ? '#d946ef' : edge.type === 'external' ? '#7dd3fc' : '#cbd5e1'}
                      strokeWidth={isHL ? 2 : 1}
                      strokeDasharray={edge.type === 'external' ? '4 3' : 'none'}
                      opacity={isDim ? 0.15 : 1}
                      markerEnd={`url(#${isHL ? 'arrow-highlight' : edge.type === 'external' ? 'arrow-external' : 'arrow-internal'})`}
                      style={{ transition: 'opacity 0.2s, stroke 0.2s' }}
                    />
                  )
                })}

                {/* 节点 */}
                {nodes.map(node => {
                  const isHL = isHighlighted(node.id)
                  const isDim = isDimmed(node.id)
                  const isFocus = focus === node.id
                  const isExt = node.type === 'external'
                  const isDrag = dragging === node.id
                  const hasOverride = !!nodeOverrides[node.id]
                  const pos = getNodePos(node)
                  const fill = isExt ? '#f0f9ff' : node.health === 'green' ? '#f0fdf4' : node.health === 'red' ? '#fef2f2' : node.health === 'yellow' ? '#fffbeb' : '#f4f4f5'
                  const stroke = isExt ? '#7dd3fc' : node.health === 'green' ? '#86efac' : node.health === 'red' ? '#fca5a5' : node.health === 'yellow' ? '#fcd34d' : '#d4d4d8'
                  const labelColor = isExt ? '#0369a1' : node.health === 'green' ? '#166534' : node.health === 'red' ? '#991b1b' : node.health === 'yellow' ? '#854d0e' : '#52525b'
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => onNodeClick(node.id)}
                      onMouseDown={e => onNodeMouseDown(e, node.id)}
                      onMouseEnter={() => setHovered(node.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={isDrag ? 'cursor-grabbing' : 'cursor-grab'}
                      style={{ transition: isDrag ? 'none' : 'opacity 0.2s', opacity: isDim ? 0.3 : 1 }}
                    >
                      {/* 焦点光环 */}
                      {isFocus && (
                        <rect x={-4} y={-4} width={108} height={44} rx={8} fill="none" stroke="#d946ef" strokeWidth={2} strokeDasharray="3 3" className="animate-pulse" />
                      )}
                      {/* 拖拽指示器 */}
                      {hasOverride && (
                        <circle cx={-8} cy={-8} r={3} fill="#f59e0b" title="已移动" />
                      )}
                      <rect
                        x={0}
                        y={0}
                        width={100}
                        height={36}
                        rx={6}
                        fill={fill}
                        stroke={isHL ? '#d946ef' : stroke}
                        strokeWidth={isHL ? 2 : 1}
                        strokeDasharray={isExt ? '4 3' : 'none'}
                        style={{ transition: 'stroke 0.2s, stroke-width 0.2s', filter: isDrag ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))' : 'none' }}
                      />
                      <text x={50} y={16} textAnchor="middle" className="font-mono" style={{ fontSize: 10, fill: labelColor, fontWeight: isHL ? 600 : 500 }}>
                        {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
                      </text>
                      <text x={50} y={28} textAnchor="middle" style={{ fontSize: 8, fill: '#9ca3af' }}>
                        {isExt ? '外部' : node.meta ? `${node.meta.dir}` : ''}
                      </text>
                      {/* 健康度小圆点 */}
                      {!isExt && (
                        <circle
                          cx={92}
                          cy={8}
                          r={3}
                          fill={node.health === 'green' ? '#10b981' : node.health === 'red' ? '#f43f5e' : node.health === 'yellow' ? '#f59e0b' : '#d4d4d8'}
                        />
                      )}
                    </g>
                  )
                })}
              </svg>

              {/* Minimap 浮层 */}
              {showMinimap && (
                <div className="absolute top-2 right-2 w-44 h-20 bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg overflow-hidden backdrop-blur-sm">
                  <div className="px-1.5 py-0.5 text-[9px] text-zinc-500 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
                    <span className="flex items-center gap-0.5"><MapIcon className="h-2.5 w-2.5" /> Minimap</span>
                    <button onClick={() => setShowMinimap(false)} className="hover:text-zinc-700 dark:hover:text-zinc-300" title="隐藏">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full" style={{ height: 'calc(100% - 16px)' }} preserveAspectRatio="xMidYMid meet">
                    {/* 边 */}
                    {edges.map((edge, i) => {
                      const from = nodeById.get(edge.from)
                      const to = nodeById.get(edge.to)
                      if (!from || !to) return null
                      const fp = getNodePos(from)
                      const tp = getNodePos(to)
                      return <line key={i} x1={fp.x + 50} y1={fp.y} x2={tp.x + 50} y2={tp.y} stroke={edge.type === 'external' ? '#7dd3fc' : '#cbd5e1'} strokeWidth={2} opacity={0.5} />
                    })}
                    {/* 节点 */}
                    {nodes.map(n => {
                      const p = getNodePos(n)
                      const isF = focus === n.id
                      const isExt = n.type === 'external'
                      const color = isExt ? '#7dd3fc' : n.health === 'green' ? '#10b981' : n.health === 'red' ? '#f43f5e' : n.health === 'yellow' ? '#f59e0b' : '#d4d4d8'
                      return (
                        <rect
                          key={n.id}
                          x={p.x}
                          y={p.y}
                          width={100}
                          height={36}
                          rx={4}
                          fill={color}
                          opacity={isF ? 1 : 0.6}
                          stroke={isF ? '#d946ef' : 'none'}
                          strokeWidth={isF ? 4 : 0}
                        />
                      )
                    })}
                  </svg>
                </div>
              )}
              {!showMinimap && (
                <button
                  onClick={() => setShowMinimap(true)}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  title="显示 Minimap"
                >
                  <MapIcon className="h-3.5 w-3.5 text-zinc-500" />
                </button>
              )}

              {/* 拖拽提示 */}
              <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-500 shadow-sm backdrop-blur-sm">
                拖拽节点重新布局 · {Object.keys(nodeOverrides).length > 0 && <span className="text-amber-600">{Object.keys(nodeOverrides).length} 个已移动 · </span>}点击切换焦点
              </div>
            </div>

            {/* 图例 */}
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
              <span className="flex items-center gap-1 ml-auto">
                <span className="h-0.5 w-6 bg-fuchsia-500" /> 高亮路径
              </span>
              <span className="text-zinc-400">· 点击节点切换焦点</span>
            </div>
          </CardContent>
        </Card>

        {/* 右侧：焦点详情 */}
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
                </div>
              )}
            </CardContent>
          </Card>

          {/* 上下游列表 */}
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
                  <ArrowUp className="h-3 w-3" /> 上游 ({graph.upstream.size})
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {graph.upstream.size === 0 && <div className="text-[11px] text-zinc-400 py-2 text-center">无库内上游</div>}
                  {[...graph.upstream].map(t => {
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
                  <ArrowDown className="h-3 w-3" /> 下游 ({graph.downstream.size})
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {graph.downstream.size === 0 && <div className="text-[11px] text-zinc-400 py-2 text-center">无下游</div>}
                  {[...graph.downstream].map(t => {
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
