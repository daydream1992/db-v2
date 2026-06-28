# Task 4: Logs View Enhancement - run_id Grouping & Virtual Scroll

## Task Info
- **Task ID**: 4
- **Agent**: main (Z.ai Code)
- **File Modified**: `/home/z/my-project/src/components/dataops/logs-view.tsx`

## Work Summary

Enhanced the Logs view with 6 major features as requested:

### 1. run_id Grouping Toggle
- Added `groupByRun` boolean state (default: false)
- When enabled, filtered logs are grouped by their `runId` field
- Each group header shows: Run ID, time range (first → last timestamp), log count, status indicator (ERROR→red, WARNING→amber, else green)
- Groups are collapsible with ChevronDown/ChevronRight toggle
- Auto-collapse: groups with errors are expanded by default, clean groups are collapsed

### 2. Group Toggle UI
- Added "按执行分组" button with `Layers` icon in the filter bar
- Active state: filled dark background (bg-zinc-700), inactive: outline
- Badge showing number of groups when active
- Additional group count badge in log stream header when grouping is active

### 3. Group Header Styling
- Group header with `bg-zinc-100 dark:bg-zinc-800` background
- Left side: collapse icon + status dot + Run ID in mono font
- Right side: log count badge + time range in small text
- Status-based left border colors:
  - ERROR: `border-l-2 border-rose-400`
  - WARNING: `border-l-2 border-amber-400`
  - Clean: `border-l-2 border-emerald-400`
- Click-to-toggle collapse behavior

### 4. Mock run_id Generation
- `useMemo` assigns run_ids to static logs:
  - Groups by same date prefix + same table
  - Splits on time gaps > 10 minutes within same table (handles retries like capital_info and t_bk5_19)
  - Generates IDs like `run-20260625-001`, `run-20260625-002`, etc.
- Live logs from streamer already have their own run context (kept as-is)

### 5. Virtual Scrolling Optimization
- Only renders log lines visible in viewport + buffer of 20 lines above/below
- Uses binary search to find first visible item efficiently
- `VirtualItem` type supports both 'log' and 'group-header' items
- Pre-calculated cumulative positions and heights
- `ResizeObserver` tracks container height for accurate calculations
- Total height maintained with absolute positioning for correct scroll behavior
- Scroll-to-bottom functionality preserved with virtual scroll

### 6. Log Row Improvements
- Left border color per log level:
  - ERROR: `border-l-2 border-rose-400`
  - WARNING: `border-l-2 border-amber-400`
  - INFO: `border-l-2 border-emerald-400`
  - DEBUG: `border-l-2 border-zinc-300 dark:border-zinc-600`
- Each row has `row-hover-gradient` class for hover effect
- Copy button shows "Copied!" tooltip for 1.5s after click (positioned above the copy icon)

## Technical Details
- New interfaces: `LogItem`, `LogGroup`, `VirtualItem`
- Constants: `ROW_HEIGHT=28`, `GROUP_HEADER_HEIGHT=36`, `BUFFER_COUNT=20`
- `estimateRowHeight()` function handles expanded rows with multi-line content
- `GroupHeader` extracted as a separate sub-component for clarity
- All existing functionality preserved (level chips, table filter, search, live mode, export, auto-scroll, useLogStreamer integration)

## Verification
- `bun run lint` passes with 0 errors, 0 warnings
- Dev server returns 200 OK
