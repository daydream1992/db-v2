#!/usr/bin/env python3
# @meta table=kline_ingest_plan cn=K线入库计划 dir=4_工具 sort=002
# @meta schedule=daily mode=batch source=TDX文件
"""
K线入库计划与执行

使用方法:
  cd K:/DB数据库_v2
  python 4_工具/ingest_plan.py kline      - 查看计划
  python 4_工具/ingest_plan.py kline --run - 执行入库

执行流程:
  1. 先跑交易日历 (91_trading_calendar.py)
  2. 检查是否交易日
  3. 按顺序执行K线入库（失败重试3次）
  4. 结果记录到 logs/ingestion_state.json
"""
import sys
import json
import importlib.util
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
import duckdb
import pandas as pd
from pathlib import Path
from datetime import datetime
from loguru import logger

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
BASE_DIR = Path(r'K:\DB数据库_v2').resolve()
LOG_DIR = BASE_DIR / 'logs'
STATE_FILE = LOG_DIR / 'ingestion_state.json'

# K线表定义（按依赖顺序固定）
KLINE_TABLES = [
    # ingest: 从TDX文件入库
    {'name': 'stock_daily_kline',    'sort': 10, 'script': '1_入库/10_stock_daily_kline.py'},
    {'name': 'stock_kline_5m',       'sort': 81, 'script': '1_入库/081_stock_kline_5m.py'},
    {'name': 'stock_kline_1m',       'sort': 80, 'script': '1_入库/080_stock_kline_1m.py'},
    # derived: 从5分钟聚合
    {'name': 'stock_kline_15m',      'sort': 82, 'script': '2_计算/82_stock_kline_15m.py'},
    {'name': 'stock_kline_30m',      'sort': 83, 'script': '2_计算/83_stock_kline_30m.py'},
    {'name': 'stock_kline_60m',      'sort': 84, 'script': '2_计算/84_stock_kline_60m.py'},
    # derived: 从日K聚合
    {'name': 'stock_kline_weekly',   'sort': 17, 'script': '2_计算/17_stock_kline_weekly.py'},
    {'name': 'stock_kline_monthly',  'sort': 18, 'script': '2_计算/18_stock_kline_monthly.py'},
]

MAX_RETRIES = 3
RETRY_DELAY = 30


# ========== 日志配置 ==========
def setup_logger():
    LOG_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = LOG_DIR / f'ingestion_{ts}.log'
    logger.remove()
    logger.add(sys.stderr, level='INFO', format='{time:HH:mm:ss} | {message}')
    logger.add(str(log_file), level='DEBUG', encoding='utf-8')
    return log_file


# ========== 状态管理 ==========
def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {'last_run': None, 'last_success': None, 'failures': []}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')


# ========== 数据库查询 ==========
def get_table_date_col(conn, table):
    cols = conn.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}'").df()
    date_cols = cols[cols['column_name'].str.contains('date|time', case=False)]
    if date_cols.empty:
        return None
    return date_cols['column_name'].iloc[0]


def get_max_date(conn, table, date_col):
    if not date_col:
        return None
    max_val = conn.execute(f"SELECT MAX({date_col}) FROM {table}").fetchone()[0]
    if not max_val:
        return None
    if isinstance(max_val, (pd.Timestamp, datetime)):
        return max_val.strftime('%Y-%m-%d') if hasattr(max_val, 'strftime') else str(max_val)[:10]
    elif hasattr(max_val, 'date'):
        return max_val.strftime('%Y-%m-%d')
    return str(max_val)[:10]


def get_missing_dates(conn, table, date_col):
    if not date_col:
        return []
    max_date = get_max_date(conn, table, date_col)
    if not max_date:
        return []
    try:
        missing = conn.execute(f"""
            SELECT date FROM trading_calendar
            WHERE is_trading = TRUE AND date > '{max_date}'
            ORDER BY date
        """).fetchall()
        return [str(r[0]) for r in missing]
    except Exception:
        return []


# ========== 脚本执行（import 方式，带重试） ==========
def run_script(script_path, retry=MAX_RETRIES):
    """通过 importlib 加载模块执行"""
    full_path = BASE_DIR / script_path
    if not full_path.exists():
        return False, f'脚本不存在: {script_path}'

    logger.info(f"  执行: {script_path}")

    for attempt in range(1, retry + 1):
        try:
            # 动态加载模块
            spec = importlib.util.spec_from_file_location('ingestion_script', str(full_path))
            if not spec or not spec.loader:
                return False, f'无法加载: {script_path}'

            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            if hasattr(module, 'run'):
                ok = module.run(force=False)
                if ok:
                    return True, '成功'
                else:
                    logger.warning(f"  失败 (尝试 {attempt}/{retry})")
            else:
                return False, '脚本无 run() 函数'

        except Exception as e:
            logger.warning(f"  错误: {e}")

        if attempt < retry:
            logger.info(f"  等待 {RETRY_DELAY} 秒后重试...")
            import time; time.sleep(RETRY_DELAY)

    return False, '重试耗尽'


# ========== 查看计划 ==========
def plan_kline(conn):
    """显示入库计划"""
    print("=" * 100)
    print("【K线入库计划】")
    print("=" * 100)
    print(f"{'序号':<4} {'表名':<24} {'最新数据':<12} {'缺失'}")
    print("-" * 60)

    for info in KLINE_TABLES:
        name = info['name']
        date_col = get_table_date_col(conn, name)
        if not date_col:
            print(f"{info['sort']:<4} {name:<24} {'无日期列':<12}")
            continue

        current = get_max_date(conn, name, date_col)
        missing = get_missing_dates(conn, name, date_col)
        missing_str = f'{len(missing)}天' if missing else '无'
        if missing and len(missing) <= 3:
            missing_str = ', '.join(missing)
        elif missing:
            missing_str = f'{missing[0]}... ({len(missing)}天)'

        print(f"{info['sort']:<4} {name:<24} {current or 'N/A':<12} {missing_str}")

    print("-" * 60)


# ========== 执行入库 ==========
def run_ingestion():
    """执行入库"""
    log_file = setup_logger()
    start_time = datetime.now()

    logger.info("=" * 60)
    logger.info(f"K线入库开始 {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)

    # 1. 先跑交易日历
    logger.info("[091] trading_calendar (交易日历)")
    ok, msg = run_script('1_入库/91_trading_calendar.py')
    logger.info(f"  {'✔' if ok else '✘'} {msg}")
    if not ok:
        logger.warning("  交易日历入库失败，继续执行...")

    # 2. 执行K线入库（按固定顺序）
    # 差额逻辑：查目标表最新日期 + 1天，自然只入库缺失数据
    results = []
    for info in KLINE_TABLES:
        logger.info(f"[{info['sort']}] {info['name']}")
        ok, msg = run_script(info['script'])
        results.append({'name': info['name'], 'ok': ok, 'msg': msg})
        logger.info(f"  {'✔' if ok else '✘'} {msg}")

    # 更新状态
    state = load_state()
    today = datetime.now().date().isoformat()
    state['last_run'] = today

    success = sum(1 for r in results if r['ok'])
    failed = [r for r in results if not r['ok']]

    state['last_success'] = today if success == len(results) else None
    if failed:
        state['failures'].append({'date': today, 'tables': [r['name'] for r in failed]})
        state['failures'] = state['failures'][-10:]
    save_state(state)

    # 汇总
    elapsed = (datetime.now() - start_time).total_seconds()
    logger.info("=" * 60)
    logger.info(f"完成: 成功 {success}/{len(results)}, 耗时 {elapsed:.0f}秒")
    logger.info(f"日志: {log_file}")
    if failed:
        logger.warning(f"失败: {[r['name'] for r in failed]}")
    logger.info("=" * 60)


# ========== 主入口 ==========
def main():
    args = sys.argv[1:] if len(sys.argv) > 1 else ['kline']
    do_run = '--run' in args

    if 'kline' in args:
        if do_run:
            run_ingestion()
        else:
            conn = duckdb.connect(DB_PATH, read_only=True)
            plan_kline(conn)
            conn.close()
    else:
        print("用法:")
        print("  python 4_工具/ingest_plan.py kline      → 查看计划")
        print("  python 4_工具/ingest_plan.py kline --run → 执行入库")


if __name__ == '__main__':
    main()
