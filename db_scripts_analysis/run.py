#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run.py — 数据库入库统一入口（包工头）

用法:
  python run.py all [--weekly|--full]   执行入库
  python run.py 10                      按编号执行
  python run.py kline                   按关键字匹配执行
  python run.py scan                    红绿扫描
  python run.py check 表名              深度检查
  python run.py get 表名 [--code X] [--days N]  导出数据
  python run.py add 表名                新增表
  python run.py remove 表名             删除表
  python run.py fix 表名 [--date DATE]  补数(force=True)
  python run.py backup                  备份数据库

元数据来源：脚本头部 @meta（优先）> tables.json（备用）
"""
import sys
import re
import json
import shutil
import importlib.util
import argparse
from datetime import datetime
from pathlib import Path

import duckdb
import pandas as pd
from loguru import logger
from rich.console import Console
from rich.table import Table

# ========== 常量区 ==========
BASE_DIR = Path(__file__).parent.resolve()
CONFIG_PATH = BASE_DIR / 'config' / 'tables.json'
DB_PATH = Path(r'K:\DB数据库_v2\db\profit_radar.duckdb')
LOG_DIR = BASE_DIR / 'logs'
BACKUP_DIR = BASE_DIR / 'archive'
OUTPUT_DIR = BASE_DIR / 'output'

DIR_ORDER = ['1_入库', '2_计算']
SCHEDULE_TIERS = {
    'daily': ['daily'],
    'weekly': ['daily', 'weekly'],
    'full': ['daily', 'weekly', 'monthly', 'once'],
}

# ========== 日志配置 ==========
def setup_logger():
    LOG_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d')
    log_file = LOG_DIR / f'run_{ts}.log'
    logger.remove()
    logger.add(sys.stderr, level='INFO', format='{time:HH:mm:ss} | {level:<7} | {message}')
    logger.add(str(log_file), level='DEBUG', encoding='utf-8',
               format='{time:YYYY-MM-DD HH:mm:ss} | {level:<7} | {message}')


# ========== @meta 解析 ==========
def parse_meta(script_path: Path) -> dict:
    """从脚本头部解析 @meta 元数据"""
    try:
        content = script_path.read_text(encoding='utf-8')
    except Exception:
        return {}

    meta = {}
    # 解析一行中的多个 # @meta key=value
    for line in content.split('\n'):
        # 匹配整行：# @meta key=value key=value ...
        m = re.match(r'#\s*@meta\s+(.*)', line)
        if m:
            # 解析所有 key=value
            for kv in m.group(1).split():
                parts = kv.split('=', 1)
                if len(parts) == 2:
                    meta[parts[0].strip()] = parts[1].strip()
    return meta


def get_all_scripts_meta() -> dict:
    """扫描所有脚本，返回 {table_name: meta}"""
    result = {}

    for dir_name in DIR_ORDER:
        dir_path = BASE_DIR / dir_name
        if not dir_path.exists():
            continue

        for script_path in dir_path.glob('*.py'):
            meta = parse_meta(script_path)
            table_name = meta.get('table')
            if table_name:
                meta['_script_path'] = script_path
                meta['_dir'] = dir_name
                result[table_name] = meta

    return result


# ========== 配置读写（备用） ==========
def load_tables() -> dict:
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_tables(tables: dict):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(tables, f, ensure_ascii=False, indent=2)


# ========== 脚本发现与加载 ==========
def find_script_path(table_name: str, scripts_meta: dict) -> Path:
    """从已扫描的脚本元数据中找脚本路径"""
    if table_name in scripts_meta:
        return scripts_meta[table_name].get('_script_path')
    return None


def load_script_module(table_name: str, scripts_meta: dict):
    """加载脚本模块"""
    script_path = find_script_path(table_name, scripts_meta)
    if not script_path or not script_path.exists():
        return None

    spec = importlib.util.spec_from_file_location(table_name, str(script_path))
    if not spec or not spec.loader:
        return None

    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ========== 表过滤与匹配 ==========
def filter_by_schedule(scripts_meta: dict, schedules: list) -> list:
    """按schedule过滤，先1_入库再2_计算，按sort排"""
    result = []
    for d in DIR_ORDER:
        items = [(name, meta) for name, meta in scripts_meta.items()
                 if meta.get('_dir') == d and meta.get('schedule', 'once') in schedules]
        items.sort(key=lambda x: int(x[1].get('sort', 999)))
        result.extend([name for name, _ in items])
    return result


def match_keyword(scripts_meta: dict, keyword: str) -> list:
    """按关键字匹配表名/中文名/sort编号"""
    kw = keyword.lower()
    result = []
    for d in DIR_ORDER:
        items = []
        for name, meta in scripts_meta.items():
            if meta.get('_dir') != d:
                continue
            sort_raw = meta.get('sort', '')
            sort = str(int(sort_raw)) if sort_raw else ''
            if (name == kw or kw in name
                    or kw in meta.get('cn', '').lower()
                    or sort.startswith(kw)):
                items.append((name, int(meta.get('sort', 999))))
        items.sort(key=lambda x: x[1])
        result.extend([n for n, _ in items])
    return list(dict.fromkeys(result))  # 去重保序


# ========== 命令实现 ==========

def cmd_all(scripts_meta: dict, tier: str):
    """批量执行入库"""
    schedules = SCHEDULE_TIERS.get(tier, SCHEDULE_TIERS['daily'])
    table_list = filter_by_schedule(scripts_meta, schedules)
    if not table_list:
        logger.warning('没有匹配的表')
        return

    logger.info(f'共 {len(table_list)} 张表 (schedule={schedules})')

    results = []
    for name in table_list:
        meta = scripts_meta.get(name, {})
        sort = meta.get('sort', '?')
        cn = meta.get('cn', '')
        logger.info(f'[{sort}] {name} ({cn})')

        mod = load_script_module(name, scripts_meta)
        if mod is None:
            logger.warning(f'  SKIP: 脚本不存在')
            results.append((name, 'SKIP'))
            continue

        try:
            ok = mod.run(force=False)
            results.append((name, 'OK' if ok else 'FAIL'))
        except Exception as e:
            logger.error(f'  ERROR: {e}')
            results.append((name, 'ERROR'))

    _print_summary(results)


def cmd_run_tables(scripts_meta: dict, keywords: list, force: bool = False):
    """按关键字执行指定表"""
    all_matched = []
    for kw in keywords:
        all_matched.extend(match_keyword(scripts_meta, kw))
    unique = list(dict.fromkeys(all_matched))

    if not unique:
        logger.warning(f'未匹配到表: {keywords}')
        return

    logger.info(f'匹配 {len(unique)} 张表: {unique}')
    results = []
    for name in unique:
        mod = load_script_module(name, scripts_meta)
        if mod is None:
            logger.warning(f'{name}: 脚本不存在')
            results.append((name, 'SKIP'))
            continue
        try:
            ok = mod.run(force=force)
            results.append((name, 'OK' if ok else 'FAIL'))
        except Exception as e:
            logger.error(f'{name}: {e}')
            results.append((name, 'ERROR'))

    _print_summary(results)


def cmd_scan(scripts_meta: dict):
    """红绿扫描"""
    tables_json = load_tables()
    con = duckdb.connect(str(DB_PATH), read_only=True)

    table = Table(title='Data Scan')
    table.add_column('#', width=4)
    table.add_column('Table', style='cyan', width=30)
    table.add_column('Status', width=6)
    table.add_column('Rows', justify='right', width=12)
    table.add_column('Date Range', width=28)
    table.add_column('Script', width=6)

    # 按目录+sort排序
    sorted_items = sorted(scripts_meta.items(),
                          key=lambda x: (DIR_ORDER.index(x[1].get('_dir', '1_入库'))
                                        if x[1].get('_dir', '1_入库') in DIR_ORDER else 9,
                                        int(x[1].get('sort', 999))))

    for i, (name, meta) in enumerate(sorted_items, 1):
        # 行数
        try:
            row_count = con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        except Exception:
            row_count = -1

        # 日期范围
        date_range = '-'
        if row_count > 0:
            for col in ['date', 'trade_date', 'lhb_date', 'stat_date', 'report_date',
                        'snapshot_date', 'update_date', 'trade_time', 'ex_date']:
                try:
                    r = con.execute(f"SELECT MIN({col}), MAX({col}) FROM {name}").fetchone()
                    if r[0] and r[1]:
                        date_range = f'{str(r[0])[:10]} ~ {str(r[1])[:10]}'
                        break
                except Exception:
                    continue

        # 脚本
        script_path = meta.get('_script_path')
        has_script = 'Y' if script_path and script_path.exists() else 'N'

        # 状态（从 tables.json 读）
        json_meta = tables_json.get(name, {})
        status = json_meta.get('status', '-')

        # 颜色
        if row_count == 0:
            status_color = '[red]0[/red]'
        elif row_count < 0:
            status_color = '[yellow]?[/yellow]'
        else:
            status_color = '[green]OK[/green]'

        table.add_row(str(i), name, status_color, f'{row_count:,}', date_range, has_script)

    con.close()
    Console().print(table)


def cmd_check(table_name: str, scripts_meta: dict):
    """深度检查"""
    if table_name not in scripts_meta:
        logger.error(f'{table_name}: 未找到脚本')
        return

    meta = scripts_meta[table_name]
    tables_json = load_tables()
    json_meta = tables_json.get(table_name, {})

    con = duckdb.connect(str(DB_PATH), read_only=True)

    logger.info(f'Table: {table_name}')
    logger.info(f'CN: {meta.get("cn", "-")}')
    logger.info(f'Source: {meta.get("source", "-")}')
    logger.info(f'Schedule: {meta.get("schedule", "-")}')
    logger.info(f'Mode: {meta.get("mode", "-")}')
    logger.info(f'Status: {json_meta.get("status", "-")}')

    # 字段
    try:
        cols = con.execute(f"DESCRIBE {table_name}").df()
        # 字段中文从数据字典 SSOT 取 (FIELD_MAP > dim > 通达信映射 > COMMON_CN)
        from config.gen_data_dict import build_data_dict
        col_cn = {c['name']: c.get('cn', '')
                  for c in build_data_dict().get(table_name, {}).get('columns', [])}
        logger.info(f'Columns ({len(cols)}):')
        for _, row in cols.iterrows():
            cn = col_cn.get(row['column_name'], '')
            logger.info(f'  {row["column_name"]:<25} {row["column_type"]:<14} {cn}')
    except Exception as e:
        logger.error(f'DESCRIBE failed: {e}')

    # 行数
    try:
        cnt = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        logger.info(f'Rows: {cnt:,}')
    except Exception:
        pass

    # 脚本路径
    script_path = meta.get('_script_path')
    logger.info(f'Script: {script_path} {"[exists]" if script_path and script_path.exists() else "[MISSING]"}')

    con.close()


# ========== 类型分类 & 新鲜度（catalog/health/join 共用）=========

# 顺序敏感: 前面优先。日期列候选（健康度/新鲜度用）。
# HqDate/hq_date: 快照表(如 sjb_api_plhqL2kz_88zd)的日期列, 存 YYYYMMDD 紧凑串
_DATE_COLS = ('date', 'trade_date', 'lhb_date', 'stat_date', 'report_date',
              'snapshot_date', 'update_date', 'trade_time', 'ex_date',
              'HqDate', 'hq_date')

# join key 优先级（cmd_join 选关联键用）
_JOIN_KEY_PRIORITY = ('code', 'date', 'bk_code', 'gp_code', 'sc_code', 'industry_code')


def _normalize_datestr(val) -> str:
    """把任何日期值统一成 'YYYY-MM-DD'，保证 _freshness 词法比较正确。

    DuckDB DATE 列返回 datetime.date → str 已是 ISO; 但快照表的 HqDate 是
    VARCHAR 存 'YYYYMMDD' 紧凑串, 不规范会误判新鲜度。
    """
    if val is None:
        return ''
    s = str(val)
    if len(s) >= 10 and s[4] in '-/':
        return s[:10]            # 已是 ISO / 带分隔符
    if len(s) == 8 and s.isdigit():
        return f'{s[0:4]}-{s[4:6]}-{s[6:8]}'   # YYYYMMDD → YYYY-MM-DD
    return s[:10]


def _classify_type(entry: dict, table_name: str) -> tuple:
    """按 data_dict 条目分类，返回 (类型标签, rich颜色名)。

    优先级: 孤儿 > 测试 > 多表产物 > 视图 > 维度 > 事实。
    (用颜色标签而非 emoji — Windows GBK 控制台渲染不了 4 字节 emoji)
    """
    if entry.get('orphan'):
        return ('孤儿', 'red bold')
    if entry.get('is_test'):
        return ('测试', 'grey50')
    if entry.get('multi_table'):
        return ('多表', 'cyan')
    if entry.get('is_view') or table_name.endswith('_labeled'):
        return ('视图', 'yellow')
    if entry.get('is_dim') or table_name.startswith('dim_') or table_name.endswith('_indicator'):
        return ('维度', 'magenta')
    return ('事实', 'blue')


def _last_trading_day(con) -> object:
    """最近一个交易日(is_trading=1 且 <= 今天); 查不到回退到跳过周末的启发式。"""
    try:
        r = con.execute(
            "SELECT MAX(date) FROM trading_calendar WHERE is_trading=1 AND date <= CURRENT_DATE"
        ).fetchone()
        if r and r[0]:
            return r[0]
    except Exception:
        pass
    from datetime import timedelta
    d = datetime.now().date()
    while d.weekday() >= 5:  # 5=周六 6=周日
        d -= timedelta(days=1)
    return d


def _table_maxdate(con, table_name: str) -> tuple:
    """返回 (命中的日期列名, 规范化后的 'YYYY-MM-DD' 最大日期); 无日期列返回 (None, None)。"""
    for col in _DATE_COLS:
        try:
            r = con.execute(f'SELECT MAX({col}) FROM {table_name}').fetchone()
            if r and r[0]:
                return col, _normalize_datestr(r[0])
        except Exception:
            continue
    return None, None


def _freshness(schedule: str, max_date, last_td, row_count: int) -> tuple:
    """按 schedule 判新鲜度，返回 (rich 颜色, 文案)。"""
    if row_count == 0:
        return ('red', '空表')
    sched = (schedule or '').lower()
    if sched in ('', 'once'):
        return ('white', '—')
    if max_date is None:
        return ('yellow', '无日期列')
    md = str(max_date)[:10]
    from datetime import timedelta
    if sched == 'daily':
        if last_td is not None and md < str(last_td)[:10]:
            return ('red', f'滞后{md}')
        return ('green', '最新')
    if sched == 'weekly':
        cutoff = (datetime.now() - timedelta(days=7)).date()
        return ('red' if md < str(cutoff) else 'green', '滞后' if md < str(cutoff) else '最新')
    if sched == 'monthly':
        cutoff = (datetime.now() - timedelta(days=35)).date()
        return ('yellow' if md < str(cutoff) else 'green', '滞后' if md < str(cutoff) else '最新')
    return ('white', '—')


# ========== 总目录 / 健康度 / 关联发现 ==========

def _rerun_table(name: str, scripts_meta: dict) -> bool:
    """重跑某表入库 (force=True)，返回是否成功。复用脚本契约 run(force)->bool。"""
    mod = load_script_module(name, scripts_meta)
    if mod is None:
        logger.error(f'{name}: 脚本加载失败')
        return False
    try:
        return bool(mod.run(force=True))
    except Exception as e:
        logger.error(f'{name}: 重跑出错 {e}')
        return False


def _health_autofix(red_tables: list, scripts_meta: dict, yes: bool):
    """对 health 标红的表逐个重跑补数 (force=True)。

    安全: 默认逐表 [y/N] 确认 (默认 N=跳过); --yes 跳过确认批量重跑。
    大表(>5千万行)额外提示耗时。属敏感操作, 故默认不自动执行。
    """
    if not red_tables:
        logger.info('无滞后/空表，无需补数')
        return
    BIG = 50_000_000
    logger.info(f'开始补数（{len(red_tables)} 张滞后/空表）')
    results = []
    for name, cnt in red_tables:
        if not yes:
            tag = f' [大表 {cnt:,} 行, 重跑耗时长]' if cnt >= BIG else f' [{cnt:,} 行]'
            ans = input(f'[fix?] {name}{tag} 重跑? [y/N]: ').strip().lower()
            if ans != 'y':
                logger.info(f'{name}: 跳过')
                results.append((name, 'SKIP'))
                continue
        logger.info(f'重跑 {name} (force=True) ...')
        ok = _rerun_table(name, scripts_meta)
        results.append((name, 'OK' if ok else 'FAIL'))
    _print_summary(results)


def cmd_catalog(scripts_meta: dict):
    """总目录 — 一张表看清所有对象的 类型 + 脚本↔表↔中文 映射 + 行数。

    解决: 脚本名表名对不上、不知道哪些是维度/视图表。
    """
    from config.gen_data_dict import build_data_dict
    data_dict = build_data_dict()
    con = duckdb.connect(str(DB_PATH), read_only=True)

    def _row(name, meta_or_entry, script_name, sort, sched):
        entry = data_dict.get(name, {})
        try:
            cnt = con.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]
        except Exception:
            cnt = -1
        label, color = _classify_type(entry, name)
        return {'label': label, 'color': color, 'sort': sort,
                'name': name, 'cn': entry.get('cn') or meta_or_entry.get('cn', ''),
                'script': script_name, 'sched': sched, 'rows': cnt}

    rows = []
    seen = set()
    # 1) 有脚本的表 (scripts_meta)
    for name, meta in scripts_meta.items():
        seen.add(name)
        sp = meta.get('_script_path')
        rows.append(_row(name, meta, sp.name if sp else '-', meta.get('sort', ''), meta.get('schedule', '')))
    # 2) data_dict 里脚本没覆盖的 (孤儿/dim/view/test/多表产物)
    for name, entry in data_dict.items():
        if name == '_meta' or name in seen:
            continue
        sp = entry.get('source_script', '')
        rows.append(_row(name, entry, Path(sp).name if sp else '-', '', ''))

    con.close()

    type_order = {'事实': 0, '维度': 1, '视图': 2, '多表': 3, '测试': 4, '孤儿': 5}
    rows.sort(key=lambda r: (type_order.get(r['label'], 9), str(r['sort']).zfill(4)))

    table = Table(title=f'数据目录（共 {len(rows)} 个对象）')
    table.add_column('类', width=6)
    table.add_column('表名', style='cyan', width=30)
    table.add_column('中文名', width=24)
    table.add_column('脚本', width=30)
    table.add_column('行数', justify='right', width=13)
    for r in rows:
        cnt = f'{r["rows"]:,}' if r['rows'] >= 0 else '?'
        type_cell = f'[{r["color"]}]{r["label"]}[/{r["color"]}]'
        table.add_row(type_cell, r['name'], r['cn'], r['script'], cnt)
    Console().print(table)
    Console().print('[dim]图例: 事实(蓝) 维度(紫) 视图(黄) 多表产物(青) 测试(灰) 孤儿(红) — 脚本名≠表名时以「表名」列为准[/dim]')


def cmd_health(scripts_meta: dict, fix: bool = False, yes: bool = False):
    """健康总览 — scan + integrity + 新鲜度，一张红绿灯。

    解决: 一眼看清哪张表该更新了、一致性是否 0 异常。
    fix=True 时对标红的滞后/空表逐个补数 (默认逐表确认)。
    """
    from config.gen_data_dict import build_data_dict, check_integrity
    data_dict = build_data_dict()
    con = duckdb.connect(str(DB_PATH), read_only=True)
    last_td = _last_trading_day(con)
    db_tables = set(con.execute("SHOW TABLES").fetchdf()['name'].tolist())

    # 一致性计数 (与 check_integrity.py 同口径)
    n_red_orphan = sum(1 for k, v in data_dict.items() if k != '_meta' and v.get('orphan'))
    n_yel_dead = sum(1 for name in scripts_meta if name not in db_tables)
    n_todo = sum(1 for i in check_integrity(data_dict) if i.startswith('[YEL]'))

    table = Table(title=f'入库健康度（最近交易日 {last_td}）')
    table.add_column('表名', style='cyan', width=30)
    table.add_column('类型', width=5)
    table.add_column('sched', width=7)
    table.add_column('行数', justify='right', width=11)
    table.add_column('最新日期', width=12)
    table.add_column('新鲜度', width=16)

    n_green = n_yel_f = n_red_f = 0
    red_tables = []  # (name, row_count) 待补数候选 (freshness=red)
    items = sorted(scripts_meta.items(),
                   key=lambda x: (DIR_ORDER.index(x[1].get('_dir', '1_入库'))
                                  if x[1].get('_dir', '1_入库') in DIR_ORDER else 9,
                                  int(x[1].get('sort', 999))))
    for name, meta in items:
        entry = data_dict.get(name, {})
        tlabel, tcolor = _classify_type(entry, name)
        try:
            cnt = con.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]
        except Exception:
            cnt = -1
        _, md = _table_maxdate(con, name) if cnt > 0 else (None, None)
        color, text = _freshness(meta.get('schedule', ''), md, last_td, cnt)
        n_green += color == 'green'
        n_yel_f += color == 'yellow'
        n_red_f += color == 'red'
        if color == 'red':
            red_tables.append((name, cnt))
        type_cell = f'[{tcolor}]{tlabel}[/{tcolor}]'
        table.add_row(name, type_cell, meta.get('schedule', ''),
                      f'{cnt:,}' if cnt >= 0 else '?',
                      str(md)[:10] if md else '-',
                      f'[{color}]{text}[/{color}]')
    con.close()
    Console().print(table)
    logger.info(f'新鲜度 → 最新={n_green}  待查={n_yel_f}  滞后或空={n_red_f}')
    logger.info(f'一致性 → 孤儿={n_red_orphan}  死脚本={n_yel_dead}  字段中文TODO={n_todo}')
    if n_red_orphan or n_yel_dead:
        logger.warning('存在一致性问题，跑 `python run.py integrity` 看详情')
    if n_red_f and not fix:
        logger.warning(f'{n_red_f} 张表滞后或空，用 `python run.py health --fix` 补数 (逐表确认) 或 `python run.py fix <表>`')
    if fix:
        _health_autofix(red_tables, scripts_meta, yes)


def cmd_join(table_name: str):
    """关联发现 — 找该表的 _labeled 视图 + 可 join 的 dim 表 + 推荐 join key + JOIN 模板。

    解决: 取数时不知道这张表能 join 谁、用什么 key。
    """
    from config.gen_data_dict import build_data_dict
    con = duckdb.connect(str(DB_PATH), read_only=True)
    db_tables = set(con.execute("SHOW TABLES").fetchdf()['name'].tolist())
    if table_name not in db_tables:
        logger.error(f'{table_name}: DB 无此表')
        con.close()
        return

    try:
        target_cols = set(con.execute(f'DESCRIBE {table_name}').fetchdf()['column_name'].tolist())
    except Exception as e:
        logger.error(f'DESCRIBE {table_name} 失败: {e}')
        con.close()
        return

    logger.info(f'目标表: {table_name}（{len(target_cols)} 列）')

    # 1) _labeled 视图 (字段含义已 JOIN, 取数首选)
    labeled = f'{table_name}_labeled'
    if labeled in db_tables:
        logger.info(f'已有取数视图: {labeled}  (字段含义已 JOIN，直接查它即可)')
    else:
        logger.info(f'无 {labeled} 视图')

    # 2) 候选 dim 表 (列名能交上的才有 join 可能)
    data_dict = build_data_dict()
    dim_tables = [t for t, v in data_dict.items()
                  if t != '_meta' and (v.get('is_dim') or t.startswith('dim_') or t.endswith('_indicator'))]

    candidates = []
    for dt in dim_tables:
        try:
            dcols = set(con.execute(f'DESCRIBE {dt}').fetchdf()['column_name'].tolist())
        except Exception:
            continue
        shared = target_cols & dcols
        if not shared:
            continue
        key = next((k for k in _JOIN_KEY_PRIORITY if k in shared), sorted(shared)[0])
        candidates.append((dt, key, sorted(shared), data_dict.get(dt, {}).get('cn', '')))

    if candidates:
        logger.info(f'可关联的维度表（{len(candidates)}）:')
        for dt, key, shared, cn in candidates:
            Console().print(f'   • [cyan]{dt:<30}[/cyan] join key=[green]{key}[/green]  共有列={shared}  {cn}')
        best_dt, best_key, _, _ = candidates[0]
        Console().print('\n   [dim]JOIN 模板（复制即用）:[/dim]')
        Console().print(f'   [green]SELECT t.*, d.*[/green]')
        Console().print(f'   [green]FROM {table_name} t[/green]')
        Console().print(f'   [green]LEFT JOIN {best_dt} d ON t.{best_key} = d.{best_key}[/green]')
    else:
        logger.warning('没有列名能匹配上的 dim 表（可能需先建 dim_*_indicator 维度表，或在脚本里加 FIELD_MAP）')

    con.close()


def cmd_get(table_name: str, code: str = None, days: int = 30):
    """导出数据"""
    scripts_meta = get_all_scripts_meta()
    if table_name not in scripts_meta:
        logger.error(f'{table_name}: 未找到脚本')
        return

    OUTPUT_DIR.mkdir(exist_ok=True)
    con = duckdb.connect(str(DB_PATH), read_only=True)

    conditions = []
    if code:
        conditions.append(f"code = '{code}'")
    if days > 0:
        for col in ['date', 'trade_date']:
            try:
                con.execute(f"SELECT {col} FROM {table_name} LIMIT 1").fetchone()
                conditions.append(f"{col} >= CURRENT_DATE - INTERVAL '{days} DAYS'")
                break
            except Exception:
                continue

    where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
    query = f"SELECT * FROM {table_name}{where} ORDER BY 1, 2 LIMIT 10000"

    try:
        df = con.execute(query).df()
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        path = OUTPUT_DIR / f'{table_name}_{ts}.csv'
        df.to_csv(path, index=False, encoding='utf-8-sig')
        logger.info(f'Exported {len(df)} rows -> {path}')
    except Exception as e:
        logger.error(f'Export failed: {e}')

    con.close()


def cmd_add(table_name: str):
    """新增表（交互式）"""
    tables = load_tables()
    if table_name in tables:
        logger.error(f'{table_name} already exists')
        return

    cn = input('CN: ').strip() or table_name
    source = input('Source (API/SQL): ').strip() or 'API(TQ)'
    period = input('Period: ').strip() or 'daily'

    schedule_map = {'daily': 'daily', 'weekly': 'weekly', 'monthly': 'monthly'}
    schedule = schedule_map.get(period, 'once')
    d = '2_计算' if 'SQL' in source else '1_入库'
    mode = 'increment' if schedule in ('daily', 'weekly') else 'full'
    sort = max((int(t.get('sort', 0)) for t in tables.values()), default=0) + 1

    tables[table_name] = {
        'cn': cn, 'source': source, 'period': period,
        'schedule': schedule, 'mode': mode, 'dir': d, 'sort': sort,
    }
    save_tables(tables)
    logger.info(f'Added {table_name} -> tables.json (dir={d}, sort={sort})')

    # 提示创建脚本
    logger.info(f'请创建 {d}/{sort:03d}_{table_name}.py')


def cmd_remove(table_name: str):
    """删除表"""
    tables = load_tables()
    if table_name not in tables:
        logger.error(f'{table_name} not in tables.json')
        return

    confirm = input(f'Remove {table_name}? [y/N]: ').strip().lower()
    if confirm != 'y':
        logger.info('Cancelled')
        return

    # 删除脚本
    scripts_meta = get_all_scripts_meta()
    script_path = scripts_meta.get(table_name, {}).get('_script_path')
    if script_path and script_path.exists():
        script_path.unlink()
        logger.info(f'Deleted: {script_path}')

    del tables[table_name]
    save_tables(tables)
    logger.info(f'Removed {table_name} from tables.json')


def cmd_fix(table_name: str, scripts_meta: dict):
    """补数（force=True）"""
    if table_name not in scripts_meta:
        logger.error(f'{table_name}: 未找到脚本')
        return

    logger.info(f'Fix {table_name} (force=True)')
    mod = load_script_module(table_name, scripts_meta)
    if mod is None:
        logger.error(f'Script not found for {table_name}')
        return

    try:
        mod.run(force=True)
    except Exception as e:
        logger.error(f'Fix failed: {e}')


def cmd_backup():
    """备份数据库"""
    BACKUP_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    dst = BACKUP_DIR / f'profit_radar_{ts}.duckdb'
    logger.info(f'Backup -> {dst}')
    shutil.copy2(str(DB_PATH), str(dst))
    size_mb = dst.stat().st_size / 1024 / 1024
    logger.info(f'Done ({size_mb:.0f} MB)')


# ========== 汇总打印 ==========
def _print_summary(results: list):
    ok = sum(1 for _, s in results if s == 'OK')
    fail = sum(1 for _, s in results if s == 'FAIL')
    skip = sum(1 for _, s in results if s == 'SKIP')
    err = sum(1 for _, s in results if s == 'ERROR')

    table = Table(title=f'Summary (OK={ok} FAIL={fail} SKIP={skip} ERROR={err})')
    table.add_column('Table', style='cyan', width=30)
    table.add_column('Status', width=8)

    color = {'OK': 'green', 'FAIL': 'red', 'SKIP': 'yellow', 'ERROR': 'red'}
    for name, status in results:
        table.add_row(name, f'[{color.get(status, "white")}]{status}[/{color.get(status, "white")}]')

    Console().print(table)


# ========== 入口 ==========
def main():
    setup_logger()

    # 扫描所有脚本的 @meta
    scripts_meta = get_all_scripts_meta()
    logger.debug(f'扫描到 {len(scripts_meta)} 个脚本')

    # 如果第一个参数不是已知子命令，当作关键字匹配执行
    known_commands = {'all', 'scan', 'catalog', 'health', 'join', 'check', 'get', 'add', 'remove', 'fix', 'backup', 'integrity', 'sync-dict'}
    if len(sys.argv) > 1 and sys.argv[1] not in known_commands and not sys.argv[1].startswith('-'):
        cmd_run_tables(scripts_meta, sys.argv[1:])
        return

    parser = argparse.ArgumentParser(description='DB v2 Runner')
    sub = parser.add_subparsers(dest='command')

    # all
    p_all = sub.add_parser('all', help='Run ingestion')
    p_all.add_argument('--weekly', action='store_true')
    p_all.add_argument('--full', action='store_true')

    # scan
    sub.add_parser('scan', help='Health scan')

    # check
    p_check = sub.add_parser('check', help='Deep check')
    p_check.add_argument('table')

    # get
    p_get = sub.add_parser('get', help='Export data')
    p_get.add_argument('table')
    p_get.add_argument('--code', default=None)
    p_get.add_argument('--days', type=int, default=30)

    # add
    p_add = sub.add_parser('add', help='Add table')
    p_add.add_argument('table')

    # remove
    p_rm = sub.add_parser('remove', help='Remove table')
    p_rm.add_argument('table')

    # fix
    p_fix = sub.add_parser('fix', help='Fix (force=True)')
    p_fix.add_argument('table')
    p_fix.add_argument('--date', default=None)

    # backup
    sub.add_parser('backup', help='Backup database')

    # integrity (一致性健康检查)
    sub.add_parser('integrity', help='Check DB/script/dict consistency')

    # sync-dict (重新生成数据字典)
    sub.add_parser('sync-dict', help='Regenerate data dictionary')

    # catalog (总目录: 类型+脚本↔表↔中文+行数)
    sub.add_parser('catalog', help='Show full table catalog (type/script/cn/rows)')

    # health (健康总览: scan+integrity+新鲜度; --fix 自动补数)
    p_health = sub.add_parser('health', help='Health board: freshness + consistency')
    p_health.add_argument('--fix', action='store_true', help='Re-run stale/empty tables (confirm each, or --yes)')
    p_health.add_argument('--yes', action='store_true', help='With --fix, skip per-table confirmation')

    # join (关联发现: dim + _labeled + join key)
    p_join = sub.add_parser('join', help='Discover joinable dim tables & keys')
    p_join.add_argument('table')

    args = parser.parse_args()

    if args.command == 'all':
        tier = 'full' if args.full else ('weekly' if args.weekly else 'daily')
        cmd_all(scripts_meta, tier)
    elif args.command == 'scan':
        cmd_scan(scripts_meta)
    elif args.command == 'check':
        cmd_check(args.table, scripts_meta)
    elif args.command == 'get':
        cmd_get(args.table, args.code, args.days)
    elif args.command == 'add':
        cmd_add(args.table)
    elif args.command == 'remove':
        cmd_remove(args.table)
    elif args.command == 'fix':
        cmd_fix(args.table, scripts_meta)
    elif args.command == 'backup':
        cmd_backup()
    elif args.command == 'integrity':
        from config.check_integrity import main as integrity_main
        sys.exit(integrity_main())
    elif args.command == 'sync-dict':
        from config.gen_data_dict import main as sync_main
        sys.argv = [sys.argv[0], '--sync']  # 隔离子参数
        sync_main()
    elif args.command == 'catalog':
        cmd_catalog(scripts_meta)
    elif args.command == 'health':
        cmd_health(scripts_meta, fix=args.fix, yes=args.yes)
    elif args.command == 'join':
        cmd_join(args.table)
    else:
        # 无子命令时当作关键字匹配执行
        if len(sys.argv) > 1:
            cmd_run_tables(scripts_meta, sys.argv[1:])
        else:
            parser.print_help()


if __name__ == '__main__':
    main()