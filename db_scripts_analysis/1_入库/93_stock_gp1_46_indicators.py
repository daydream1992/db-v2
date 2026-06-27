#!/usr/bin/env python3
"""个股GP指标(GP1-GP48, 表名保留"46"历史命名) — 每日盘后

数据来源: 二进制 vipdoc/cw/gpsz*.dat,gpsh*.dat,gpbj*.dat (13字节/条)
读取方式: 4_工具/tdx_reader.py TdxReader.read_gp() / read_gp_stream()
长表结构: 每天每股票每指标一行, code/gp_code/gp_name/value_0/value_1
GP1-48 indicator字节映射见 tdx_reader.GP_MAPPING (GP1-46=0x01-0x2E顺序, GP27=0x1b, GP47/48=0x2f/0x30)

更新规则(MODE=increment, COVER_DAYS=5):
  1. 空表 → 首次全量入库(DELETE 全表后 INSERT)
  2. 非空 → 按 trading_calendar 取最近 COVER_DAYS 个交易日的最早日为窗口起点 cutoff,
     仅覆盖该窗口(DELETE WHERE date>=cutoff 后 INSERT): 自动补全当天晚出指标
     (融资融券/港股通等次日才齐全) + 修复近期缺口; 窗口之前数据不动(增量保护)。
  3. 交易日历不可用/窗口为空 → 退化为全量入库。
  4. 滑动窗口固定 5 个交易日, 不做 MAX(date) 早退 —— 每次都刷新最近几天。
  5. 流式入库: read_gp_stream 分批 yield, 命中窗口后即写即释放, 避免1亿+行驻留OOM。
  6. 整个 DELETE+INSERT 包在单事务内, 中途异常 ROLLBACK, 不丢数据。

字段更新频率(按120天实测 upd_ratio + last_date + 业务规律归类, 非逐日严格验证; 2026-06-25 全量重跑后):
  - 当日盘后日更(主流, T日盘后即出): 龙虎榜系列 GP02/08/09/17/18/37/42, 涨跌停系列
    GP14/15/22/24/33/34/36/38/39/40, 大宗交易GP04, 总市值GP16, 股息率GP21, 拟增减持GP23,
    盘前盘后成交量GP25, 股票回购GP28, 分红送转GP30, 股票评分GP44, 评级系数GP45,
    人气排名GP27(0x1b, 全市场982万条); 近3月机构调研GP10(滚动窗口, 天天有)。
  - T+1晚出(次日才齐全 —— 这正是 COVER_DAYS=5 滑动窗口存在的理由): 融资融券1-4
    GP03/11/12/13, 陆股通持股量GP06, 陆股通市场成交净额GP07, 每周股票质押数量GP19,
    证券信息GP29, 增减持1/2 GP05/35, 拟询价转让GP46。
  - 周更(唯一真周更, note标注"每周更新"): 每周股票质押比例 GP20。
    ⚠ GP19/GP20 名字都带"每周", 但 GP19 实测近日更+T+1、GP20 才是周更 —— 诊断
    缺失看 upd_ratio, 别看名字。
  - 季频/事件驱动(有披露或事件才有, 非固定周期): 股东人数GP01(季报), 拟增减持金额GP26,
    转融券1/2 GP31/32, 股权登记日GP41, 配股实施GP43。
  - 未公开指标(二进制实测存在, get_gpjy_value 官方只到GP46, 语义未知, 已占位入库):
    GP47(0x2f, 56万条)、GP48(0x30, 1.7万条/仅4天)。

历史: GP27 曾因 GP_MAPPING 字节误配(0x2b↔0x1b 与GP43冲突)致 0x1b 的982万条数据被丢弃,
  2026-06-25 改回 0x1b 并全量重跑恢复。

过期判定: 入库只动最近 COVER_DAYS 天, 历史区间冻结。当日是否需要重跑由调度层决定。
"""
# @meta table=stock_gp1_46_indicators cn=个股GP指标 dir=1_入库 sort=093
# @meta schedule=daily mode=increment source=二进制

import duckdb, pandas as pd
FIELD_MAP = {'gp_code': '指标代码', 'gp_name': '指标名称', 'value_0': '指标值1', 'value_1': '指标值2'}

import sys
from pathlib import Path
from loguru import logger
from datetime import datetime

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_gp1_46_indicators'
MODE = 'increment'
COVER_DAYS = 5  # 每次覆盖最近N个交易日(滑动刷新: 补全当天晚出指标 + 修复近期缺口)
SCHEDULE = 'daily'


def fetch_data():
    """读 cw 二进制文件，提取 GP1-46 全量个股指标"""
    from tdx_reader import TdxReader
    df = TdxReader().read_gp()
    if df.empty:
        logger.warning(f"{TABLE}: read_gp 返回空")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        date DATE,
        code VARCHAR,
        gp_code VARCHAR,
        gp_name VARCHAR,
        value_0 DOUBLE,
        value_1 DOUBLE
    )""")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)
        today = datetime.now().date()
        max_date = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]

        # 覆盖窗口: 最近 COVER_DAYS 个交易日的最早日。
        # 每次刷新最近几天 → 自动补全当天晚出指标(融资融券/港股通等) + 修复近期缺口;
        # 窗口之前的数据不动(增量保护)。空表 / 日历异常 → 退化为全量。
        if max_date is None:
            mode, cutoff = 'full', None
            logger.info("  空表, 首次全量入库")
        else:
            try:
                win_start = con.execute("""
                    SELECT MIN(d) FROM (
                        SELECT date d FROM trading_calendar
                        WHERE is_trading = TRUE AND date <= ?
                        ORDER BY date DESC LIMIT ?
                    )
                """, [today, COVER_DAYS]).fetchone()[0]
                if not win_start:
                    raise RuntimeError("calendar window empty")
                mode, cutoff = 'overwrite', pd.Timestamp(win_start)
                logger.info(f"  覆盖最近{COVER_DAYS}个交易日: date >= {win_start}")
            except Exception:
                mode, cutoff = 'full', None
                logger.warning("  交易日历不可用, 退化为全量入库")

        # 流式入库: read_gp_stream 每批 yield, 过滤后即写即释放, 避免1亿+行驻留内存OOM。
        # 包在事务里: DELETE+INSERT 原子, 中途异常 ROLLBACK 不丢数据。
        from tdx_reader import TdxReader
        con.execute("BEGIN")
        total = 0
        try:
            if mode == 'full':
                con.execute(f"DELETE FROM {TABLE}")
            else:
                con.execute(f"DELETE FROM {TABLE} WHERE date >= ?", [cutoff])
            for batch in TdxReader().read_gp_stream(files_per_batch=30):
                if batch is None or batch.empty:
                    continue
                if mode == 'overwrite':
                    batch = batch[batch['date'] >= cutoff]
                    if batch.empty:
                        continue
                con.register('_gp_batch', batch)
                con.execute(f"INSERT INTO {TABLE}(date,code,gp_code,gp_name,value_0,value_1) "
                            f"SELECT date,code,gp_code,gp_name,value_0,value_1 FROM _gp_batch")
                total += len(batch)
                con.unregister('_gp_batch')
        except Exception:
            con.execute("ROLLBACK")
            raise
        con.execute("COMMIT")
        if total == 0:
            logger.info(f"○ {TABLE} 无数据")
        else:
            logger.info(f"✔ {TABLE} 入库完成({mode})，共 {total:,} 条")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
