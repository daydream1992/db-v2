# Task 3: Dashboard KPI Drill-Down Interactivity

## Agent
main (Z.ai Code)

## Task
Enhance the Dashboard KPI cards with drill-down interactivity in `/home/z/my-project/src/components/dataops/dashboard-view.tsx`

## Work Done

### 1. Updated Imports
- Added `ArrowUpRight` to lucide-react imports
- Added `Popover, PopoverTrigger, PopoverContent` from `@/components/ui/popover`
- Added `type ReactNode` to React imports

### 2. KpiCard Component Enhancement
Updated the KpiCard component signature to accept 3 new optional props:
- `onClick?: () => void` — for navigation cards (数据表总数, 待处理告警)
- `popover?: ReactNode` — for popover content (执行成功率, 入库行数)
- `navigable?: boolean` — shows ArrowUpRight icon on hover

Behavior:
- When `popover` is provided: wraps card in shadcn `<Popover>` with `<PopoverTrigger asChild>`, clicking toggles popover
- When `onClick` is provided: wraps card in a `<div>` with click/keyboard handler
- When neither: renders plain card (backward compatible)

Visual polish:
- `cursor-pointer` on clickable cards
- `focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-800` for keyboard focus
- `ArrowUpRight` icon appears on hover with `opacity-0 group-hover:opacity-100 transition-opacity`
- Preserves existing `hover:shadow-md hover:-translate-y-0.5` and `animate-stagger-in`

### 3. KPI Card Wiring
- **数据表总数** → `onClick={() => onNavigate('health')}`, `navigable`
- **执行成功率** → `popover={<SuccessRatePopover />}` 
- **入库行数** → `popover={<IngestRowsPopover />}`
- **待处理告警** → `onClick={() => onNavigate('lint')}`, `navigable`

### 4. SuccessRatePopover Component
- Header with CheckCircle2 icon + "每日执行成功率" + "近 7 天" badge
- Mini table: 日期 | 成功/总数 | 率%
- Last 7 days from `scaledStats`
- Color coding: green (100%) / amber (≥90%) / red (<90%)
- Weekend/zero entries show "—"
- Footer: "点击查看更多 → 编排" link that calls `onNavigate('orchestration')`

### 5. IngestRowsPopover Component
- Header with TrendingUp icon + "Top 5 大表" + "按行数" badge
- Top 5 tables sorted by rows desc (from TABLES mock data)
- Mini bars showing relative size (fuchsia gradient)
- Footer: "点击查看更多 → 目录" link that calls `onNavigate('catalog')`

### 6. Popover Styling
- `w-80` max width with `p-0` (internal sections handle padding)
- `animate-scale-fade-in` class for smooth appearance
- `side="bottom" align="center"` positioning
- Clean card-like appearance with section borders

## Verification
- `bun run lint` passes with 0 errors
- Dev server compiles successfully (200 responses)
- No existing functionality broken (animate-stagger-in, animate-count-up preserved)
