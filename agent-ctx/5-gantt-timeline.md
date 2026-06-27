# Task 5: Add Gantt Timeline to Orchestration View

## Summary
Added an execution topology Gantt timeline chart to the Orchestration view's "执行历史" tab, displayed above the existing execution history table.

## Changes Made

### File Modified
- `/home/z/my-project/src/components/dataops/orchestration-view.tsx`

### New Components & Helpers

1. **Helper functions**: `parseTs()`, `fmtTime()`, `fmtTimeFull()` for time parsing/formatting
2. **`STATUS_BAR_COLOR`** constant mapping run statuses to SVG fill/stroke/text colors
3. **`GanttTooltip`** interface for tooltip state
4. **`GanttTimeline`** component — the main new SVG-based Gantt chart

### GanttTimeline Features
- **SVG rendering** with responsive viewBox (1100×dynamic height)
- **Time axis**: 10-minute interval labels at top (17:00, 17:10, 17:20, etc.)
- **15 rows** (one per PIPELINE_RUN), 28px each
- **Color-coded bars**: success=emerald, failed=rose, running=sky, skipped=zinc
- **Running bars**: animated gradient with pulse effect (`animate` SVG element)
- **Failed bars**: white dot indicator at end
- **Bar labels**: table name inside bar (if wide enough) + duration label at end
- **Hover effects**: row highlight, bar shadow, brightness increase
- **Tooltip**: shows table name, status, start→end time, duration, rows affected, errors
- **Click**: opens the same RunDetailSheet as the table rows
- **Grid lines**: dashed vertical lines at 10-min intervals
- **Legend**: 4 colored dots for status types
- **Header**: "执行时序图" with Activity icon + time span subtitle

### HistoryView Changes
- Now wraps content in `<div className="space-y-4">` with GanttTimeline on top
- ScrollArea height reduced from `calc(100vh-260px)` to `calc(100vh-520px)` to accommodate Gantt chart above

### Import Changes
- Added `useMemo`, `useCallback` from React
- Added `Activity` from lucide-react

## Verification
- `bun run lint` — 0 errors
- Dev server compiles successfully (200 responses)
- Existing DAG view and Schedules view untouched
- RunDetailSheet integration preserved (click Gantt bar → opens detail sheet)
