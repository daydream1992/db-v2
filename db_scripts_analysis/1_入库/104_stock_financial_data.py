#!/usr/bin/env python3
"""股票专业财务数据(2026季度) — 每日盘后

3 个 TQ API 合并为一条流水线:
  1. get_sector_list() → 枚举 A 股板块代码
  2. get_stock_list_in_sector() → 由板块取全量股票(set 去重)
  3. get_financial_data() → 取专业财务指标核心字段, 锁 2026 报告期

当前范围: 只入 2026 年季度报表(tag_time ∈ 2026)。
数据源: TQ API (get_financial_data) — 需先在通达信客户端下载专业财务数据。
---
# @meta table=stock_financial_data cn=股票专业财务数据(2026季度) dir=1_入库 sort=104
# @meta schedule=daily mode=increment source=API(TQ:get_financial_data)
# @meta note: 去重键 code+tag_time, 同股同季保留最新公告; 只入 tag_time∈2026
"""
import os, sys, time, json
from pathlib import Path
from datetime import datetime

import duckdb, pandas as pd
from loguru import logger

# === 项目路径 ===
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# === TQ API 初始化 (尝试多个安装路径) ===
tq = None
TQ_PATHS = [
    r"K:\txdlianghua\PYPlugins\user",
    r"K:\txdlianghua\PYPlugins\sys",
]
for _p in TQ_PATHS:
    if Path(_p).exists():
        sys.path.insert(0, _p)
        try:
            from tqcenter import tq as _tq
            _tq.initialize(os.path.abspath(__file__))   # 需绝对路径定位客户端 (同 101_jb)
            tq = _tq   # 仅初始化成功后才赋值
            break
        except Exception as _e:
            logger.warning(f"TQ 初始化失败({_p}): {_e}")
            tq = None

# === 常量 ===
DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_financial_data'
MODE = 'increment'
SCHEDULE = 'daily'

# 取数范围: 2026 报告期 (Q1=20260331 已披露, H1/Q3/年报随披露滚动补齐)
START_TIME = '20260101'
END_TIME = '20261231'

# === 核心字段映射 (硬编码固定, 每次都自取这套核心) ===
# FN 编号 + 中文名 源自《获取专业财务数据》官方字段表
# key 大写 FN 匹配 API 输出列名; field_list 调用时转 Fn 小写n(与文档/tdxdata可用示例一致)
FIELD_MAP = {
    # 每股指标 (FN1-FN7)
    'FN1':  '基本每股收益',
    'FN2':  '扣非每股收益',
    'FN3':  '每股未分配利润',
    'FN4':  '每股净资产',
    'FN5':  '每股资本公积金',
    'FN6':  '净资产收益率',
    'FN7':  '每股经营现金流量',
    # 资产负债表 - 资产
    'FN8':  '货币资金',
    'FN17': '存货',
    'FN21': '流动资产合计',
    'FN27': '固定资产',
    'FN28': '在建工程',
    'FN33': '无形资产',
    'FN35': '商誉',
    'FN39': '非流动资产合计',
    'FN40': '资产总计',
    # 资产负债表 - 负债与权益
    'FN41': '短期借款',
    'FN54': '流动负债合计',
    'FN55': '长期借款',
    'FN62': '非流动负债合计',
    'FN63': '负债合计',
    'FN64': '实收资本',
    'FN65': '资本公积',
    'FN66': '盈余公积',
    'FN68': '未分配利润',
    'FN72': '所有者权益合计',
    # 利润表
    'FN134': '净利润',
    'FN207': '息税前利润EBIT',
    'FN208': '息税折旧摊销前利润EBITDA',
    'FN230': '营业收入',
    'FN231': '营业利润',
    'FN232': '归母净利润',
    'FN233': '扣非净利润',
    'FN304': '研发费用',
    # 现金流量表
    'FN234': '经营活动现金流量净额',
    'FN235': '投资活动现金流量净额',
    'FN236': '筹资活动现金流量净额',
    'FN133': '期末现金及现金等价物余额',
    # 每股/股本/单季度补充
    'FN219': '每股经营性现金流',
    'FN225': '每股现金流量净额',
    'FN238': '总股本',
    'FN281': '加权净资产收益率',
    'FN311': '基本每股收益_单季度',
    'FN312': '营业总收入_单季度',
    'FN324': '净利润_单季度',
}
FIELDS_UPPER = list(FIELD_MAP.keys())                      # 输出列名 (大写)
FIELDS = [f"Fn{k[2:]}" for k in FIELDS_UPPER]              # API field_list (Fn+数字)


def _stock_code_to_tdx(code: str) -> str:
    """裸代码 → TQ 标准格式(带交易所后缀)

    6开头→.SH, 其他→.SZ; 已带后缀/板块代码保持原样。
    (get_stock_list_in_sector 返回裸代码, get_financial_data 需带后缀)
    """
    if code.endswith('.SH') or code.endswith('.SZ'):
        return code
    if code.startswith(('88', '9')):
        return code
    if code.startswith('6'):
        return f"{code}.SH"
    return f"{code}.SZ"


def fetch_data():
    """取全 A 股 2026 季度专业财务数据(核心字段)

    流程: 板块枚举 → 全量股票 → 分批 get_financial_data → 整理(过滤2026/取最新公告)
    返回: DataFrame[code, announce_time, tag_time, FN*, fetch_time]
    """
    if tq is None:
        logger.error(f"{TABLE}: TQ 未初始化, 无法取数")
        return pd.DataFrame()

    # 1. 板块 → 全量股票 (set 去重, 同 101_jb)
    sectors = tq.get_sector_list()
    logger.info(f"板块总数: {len(sectors)}")

    all_stocks = set()
    for i, sector in enumerate(sectors):
        try:
            in_sector = tq.get_stock_list_in_sector(sector)
            if in_sector:
                all_stocks.update(in_sector)
        except Exception as e:
            logger.debug(f"板块 {sector} 成分股失败: {e}")
        if (i + 1) % 50 == 0:
            logger.info(f"  板块进度: {i+1}/{len(sectors)}, 累计股票: {len(all_stocks)}")

    stocks = sorted(all_stocks)
    tdx_codes = [_stock_code_to_tdx(c) for c in stocks]
    # 试跑旋钮: STOCK_LIMIT=N 只取前 N 只 (0=全量)
    _limit = int(os.environ.get('STOCK_LIMIT', '0'))
    if _limit > 0:
        tdx_codes = tdx_codes[:_limit]
        logger.info(f"全量股票: {len(all_stocks)} (STOCK_LIMIT={_limit}, 实取 {len(tdx_codes)})")
    else:
        logger.info(f"全量股票: {len(tdx_codes)}")

    # 2. 分批取 2026 季度财务数据
    all_frames = []
    failed = []
    batch_size = 50
    t0 = time.time()
    n_batches = (len(tdx_codes) + batch_size - 1) // batch_size

    for bi in range(n_batches):
        batch = tdx_codes[bi * batch_size:(bi + 1) * batch_size]
        try:
            result = tq.get_financial_data(
                stock_list=batch,
                field_list=FIELDS,
                start_time=START_TIME,
                end_time=END_TIME,
                report_type='report_time',   # 按截止日期(报告期)筛选, 签名默认值最稳
            )
        except Exception as e:
            failed.append({'codes': batch, 'err': f"API错误: {e}"})
            result = {}

        if isinstance(result, dict):
            for code, sub in result.items():
                if sub is None:
                    continue
                if isinstance(sub, pd.DataFrame) and len(sub) > 0:
                    sub = sub.copy()
                    sub['code'] = code
                    all_frames.append(sub)

        if (bi + 1) % 3 == 0 or (bi + 1) == n_batches:
            elapsed = time.time() - t0
            done_batches = bi + 1
            rate = done_batches / elapsed if elapsed > 0 else 0
            eta = (n_batches - done_batches) / rate if rate > 0 else 0
            logger.info(f"  财务进度: 批次 {done_batches}/{n_batches} ({rate:.1f}批/秒, 剩余~{eta:.0f}s)")

    logger.info(f"获取完成: 股票帧 {len(all_frames)}, 失败批次 {len(failed)}")

    if failed:
        fail_path = PROJECT_ROOT / 'logs' / f'{TABLE}_failed_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        fail_path.parent.mkdir(exist_ok=True)
        with open(fail_path, 'w', encoding='utf-8') as f:
            json.dump(failed, f, ensure_ascii=False, indent=2)
        logger.warning(f"失败批次已保存: {fail_path}")

    if not all_frames:
        logger.warning(f"{TABLE}: get_financial_data 返回空 (确认客户端已下载专业财务数据)")
        return pd.DataFrame()

    df = pd.concat(all_frames, ignore_index=True)

    # 3. 防御性过滤: 只留 2026 报告期 (无论 report_type 语义如何都保正确)
    df['tag_time'] = pd.to_numeric(df['tag_time'], errors='coerce')
    df = df.dropna(subset=['tag_time'])
    df = df[df['tag_time'].astype('int64').astype(str).str[:4] == '2026']
    if df.empty:
        logger.warning(f"{TABLE}: 过滤后无 2026 报告期数据")
        return pd.DataFrame()

    # 4. 同股同季保留最新公告 (修正报告覆盖原值)
    df['announce_time'] = pd.to_numeric(df['announce_time'], errors='coerce')
    df = (df.sort_values('announce_time', ascending=False)
            .drop_duplicates(subset=['code', 'tag_time'], keep='first'))

    # 5. 类型规整: FN→数值, announce/tag→int
    for col in FIELDS_UPPER:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    df['announce_time'] = df['announce_time'].astype('int64')
    df['tag_time'] = df['tag_time'].astype('int64')

    # 6. 列顺序 + fetch_time
    df['fetch_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cols = ['code', 'announce_time', 'tag_time'] + FIELDS_UPPER + ['fetch_time']
    cols = [c for c in cols if c in df.columns]
    df = df[cols]

    logger.info(f"{TABLE}: 整理后 {len(df)} 行, 覆盖 {df['code'].nunique()} 只股票")
    return df


def ensure_table(con):
    """建表(硬编码 schema: code/announce_time/tag_time BIGINT + 45个FN DOUBLE + fetch_time)"""
    fn_cols = ',\n        '.join([f'"{c}" DOUBLE' for c in FIELDS_UPPER])
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        "code" VARCHAR,
        "announce_time" BIGINT,
        "tag_time" BIGINT,
        {fn_cols},
        "fetch_time" VARCHAR
    )""")
    logger.debug(f"{TABLE}: 表就绪")


def save_data(con, df):
    """增量入库: 按 (code, tag_time) 删除再插入, 同股同季覆盖"""
    if df.empty:
        logger.info(f"{TABLE}: 数据为空, 跳过")
        return

    pairs = df[['code', 'tag_time']].drop_duplicates().values.tolist()
    col_list = ','.join([f'"{c}"' for c in df.columns])

    con.execute("BEGIN")
    try:
        for code, tag_time in pairs:
            con.execute(
                f"DELETE FROM {TABLE} WHERE code = ? AND tag_time = ?",
                [code, int(tag_time)],
            )
        con.register('_df', df)
        con.execute(f"INSERT INTO {TABLE}({col_list}) SELECT {col_list} FROM _df")
        con.unregister('_df')
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

    logger.info(f"{TABLE}: 入库完成, 共 {len(df):,} 条 (覆盖 {df['code'].nunique()} 只股票)")


def run(force=False):
    """运行入口

    增量: 按 code+tag_time 去重覆盖; 同日已入库则跳过(force=True 强制重跑)。
    """
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        # 同日跳过 (避免日内重复全量拉取)
        if not force:
            today = datetime.now().strftime('%Y-%m-%d')
            try:
                cnt = con.execute(
                    f"SELECT COUNT(*) FROM {TABLE} WHERE fetch_time LIKE ?",
                    [today + '%'],
                ).fetchone()[0]
                if cnt > 0:
                    logger.info(f"○ {TABLE} 今日已入库(fetch_time含{today}, {cnt}条), 跳过 (force=True 强制)")
                    return True
            except Exception:
                pass  # 表未建等, 继续执行

        ensure_table(con)
        df = fetch_data()
        if df.empty:
            logger.warning(f"○ {TABLE} 数据为空, 跳过")
            return True
        save_data(con, df)
        logger.info(f"✔ {TABLE} 完成")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        try:
            tq.close()
        except Exception:
            pass
        con.close()


if __name__ == '__main__':
    run(force=True)
