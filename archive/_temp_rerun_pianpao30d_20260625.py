"""临时:用当前引擎重跑最近30个交易日 pianpao,统一口径。跑完可删。"""
import duckdb, sys
from pathlib import Path
PROJECT_ROOT = Path(r'K:\DB数据库_v2')
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))
from pianpao_engine import run_analysis, save_to_db, ensure_tables, DEFAULT_CONFIG
from loguru import logger
logger.remove()
logger.add(sys.stderr, level='ERROR')

DB = r'K:\DB数据库_v2\db\profit_radar.duckdb'
con = duckdb.connect(DB)
ensure_tables(con)
cfg = DEFAULT_CONFIG.copy()

dates = ['20260521','20260522','20260525','20260526','20260527','20260528','20260529',
         '20260601','20260602','20260603','20260604','20260605','20260608','20260609',
         '20260610','20260611','20260612','20260615','20260616','20260617','20260618',
         '20260622','20260623','20260624','20260625']

ok = fail = 0
for d in dates:
    try:
        results, _ = run_analysis(con, d, cfg, {})
        save_to_db(con, results, None, d, {})
        print(f"{d}: daily={len(results)}", flush=True)
        ok += 1
    except Exception as e:
        print(f"{d}: FAIL {type(e).__name__}: {e}", flush=True)
        fail += 1
print(f"DONE ok={ok} fail={fail}", flush=True)
con.close()
