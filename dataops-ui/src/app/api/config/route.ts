import { NextRequest, NextResponse } from 'next/server'
import { REAL_TABLE_CONFIGS } from '@/lib/dataops/real-data'

// In-memory store for config overrides (mock, since we can't write to actual tables.json)
const configOverrides: Record<string, { schedule?: string; mode?: string; depends_on?: string[] }> = {}

const VALID_SCHEDULES = ['daily', 'weekly', 'monthly', 'once', 'intraday'] as const
const VALID_MODES = ['increment', 'full'] as const

// GET — read all table configurations
export async function GET() {
  const tables = Object.values(REAL_TABLE_CONFIGS).map(cfg => {
    const override = configOverrides[cfg.table]
    return {
      tableName: cfg.table,
      cn: cfg.cn,
      schedule: override?.schedule ?? cfg.schedule,
      mode: override?.mode ?? cfg.mode,
      sort: cfg.sort,
      dir: cfg.dir,
      source: cfg.source,
      depends_on: override?.depends_on ?? cfg.dependsOn,
      status: cfg.isView ? 'view' : 'active',
    }
  })

  // Available options for dropdowns
  const options = {
    schedules: VALID_SCHEDULES,
    modes: VALID_MODES,
    tableNames: Object.keys(REAL_TABLE_CONFIGS),
  }

  return NextResponse.json({ tables, options })
}

// PUT — update a single table's config
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { tableName, updates } = body as {
      tableName: string
      updates: { schedule?: string; mode?: string; depends_on?: string[] }
    }

    if (!tableName || !updates) {
      return NextResponse.json({ error: 'Missing tableName or updates' }, { status: 400 })
    }

    const original = REAL_TABLE_CONFIGS[tableName]
    if (!original) {
      return NextResponse.json({ error: `Table "${tableName}" not found` }, { status: 404 })
    }

    // Validate schedule
    if (updates.schedule !== undefined && !VALID_SCHEDULES.includes(updates.schedule as typeof VALID_SCHEDULES[number])) {
      return NextResponse.json(
        { error: `Invalid schedule "${updates.schedule}". Must be one of: ${VALID_SCHEDULES.join('/')}` },
        { status: 400 }
      )
    }

    // Validate mode
    if (updates.mode !== undefined && !VALID_MODES.includes(updates.mode as typeof VALID_MODES[number])) {
      return NextResponse.json(
        { error: `Invalid mode "${updates.mode}". Must be one of: ${VALID_MODES.join('/')}` },
        { status: 400 }
      )
    }

    // Validate depends_on — each entry must be a known table
    if (updates.depends_on !== undefined) {
      const knownTables = new Set(Object.keys(REAL_TABLE_CONFIGS))
      const invalid = updates.depends_on.filter((d: string) => !knownTables.has(d))
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Unknown tables in depends_on: ${invalid.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Merge with existing overrides
    const existing = configOverrides[tableName] || {}
    configOverrides[tableName] = { ...existing, ...updates }

    const merged = configOverrides[tableName]
    const updated = {
      tableName,
      cn: original.cn,
      schedule: merged.schedule ?? original.schedule,
      mode: merged.mode ?? original.mode,
      sort: original.sort,
      dir: original.dir,
      source: original.source,
      depends_on: merged.depends_on ?? original.dependsOn,
      status: original.isView ? 'view' : 'active',
    }

    return NextResponse.json({ updated })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// POST — export full config as downloadable JSON
export async function POST() {
  const fullConfig = Object.values(REAL_TABLE_CONFIGS).map(cfg => {
    const override = configOverrides[cfg.table]
    return {
      table: cfg.table,
      cn: cfg.cn,
      schedule: override?.schedule ?? cfg.schedule,
      mode: override?.mode ?? cfg.mode,
      sort: cfg.sort,
      dir: cfg.dir,
      source: cfg.source,
      sourceDetail: cfg.sourceDetail,
      depends_on: override?.depends_on ?? cfg.dependsOn,
      isView: cfg.isView,
      note: cfg.note,
    }
  })

  return NextResponse.json(fullConfig)
}
