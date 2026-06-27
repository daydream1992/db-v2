#!/usr/bin/env python3
"""市场快照数据 — 实时更新

数据源：TQ get_market_snapshot API
读取方式：单股票轮询获取实时快照
---
# @meta table=market_snapshot cn=市场快照数据 dir=1_入库 sort=105
# @meta schedule=intraday mode=increment source=tqcenter
"""
import duckdb, pandas as pd
from loguru import logger
from datetime import datetime
import sys
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\sys')
from tqcenter import tq

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'market_snapshot'
MODE = 'increment'
SCHEDULE = 'intraday'

# 重点证券池（今日开盘涨幅TOP100），可自定义
TOP_CODES = ['880015.SH','880075.SH','880005.SH','880035.SH','880074.SH','880034.SH','301580.SZ','300179.SZ','920725.BJ','880044.SH','301176.SZ','123271.SZ','300401.SZ','300014.SZ','300099.SZ','920066.BJ','300319.SZ','880014.SH','300861.SZ','688367.SH','688662.SH','880004.SH','300570.SZ','301071.SZ','000889.SZ','000751.SZ','603335.SH','002348.SZ','600110.SH','002167.SZ','601636.SH','000777.SZ','002160.SZ','600769.SH','002297.SZ','600353.SH','603407.SH','002741.SZ','605198.SH','002674.SZ','501073.SH','000811.SZ','600172.SH','002141.SZ','002655.SZ','002449.SZ','000571.SZ','159535.SZ','920178.BJ','688478.SH','600961.SH','600500.SH','001216.SZ','300726.SZ','002735.SZ','000880.SZ','159965.SZ','600397.SH','688786.SH','002491.SZ','123270.SZ','301196.SZ','300088.SZ','501046.SH','003031.SZ','920045.BJ','603989.SH','920971.BJ','002585.SZ','600517.SH','603261.SH','600552.SH','600703.SH','688598.SH']

FIELD_MAP = {
    'code': '证券代码',
    'snapshot_time': '快照时间',
    'LastClose': '前收盘价',
    'Open': '开盘价',
    'Max': '最高价',
    'Min': '最低价',
    'Now': '现价',
    'Volume': '总手',
    'NowVol': '现手',
    'Amount': '总成交金额',
    'Inside': '内盘',
    'Outside': '外盘',
    'TickDiff': '笔涨跌',
    'InOutFlag': '内外盘标志',
    'Jjjz': '基金净值',
    'Buyp1': '买一价', 'Buyp2': '买二价', 'Buyp3': '买三价', 'Buyp4': '买四价', 'Buyp5': '买五价',
    'Buyv1': '买一量', 'Buyv2': '买二量', 'Buyv3': '买三量', 'Buyv4': '买四量', 'Buyv5': '买五量',
    'Sellp1': '卖一价', 'Sellp2': '卖二价', 'Sellp3': '卖三价', 'Sellp4': '卖四价', 'Sellp5': '卖五价',
    'Sellv1': '卖一量', 'Sellv2': '卖二量', 'Sellv3': '卖三量', 'Sellv4': '卖四量', 'Sellv5': '卖五量',
    'UpHome': '上涨家数',
    'DownHome': '下跌家数',
    'Before5MinNow': '5分钟前价格',
    'Average': '均价',
    'XsFlag': '小数位数',
    'Zangsu': '涨速',
    'ZAFPre3': '3日涨幅'
}

def ensure_table(con):
    con.execute("""CREATE TABLE IF NOT EXISTS market_snapshot (
        code VARCHAR(20),
        snapshot_time TIMESTAMP,
        LastClose DOUBLE,
        Open DOUBLE,
        Max DOUBLE,
        Min DOUBLE,
        Now DOUBLE,
        Volume INTEGER,
        NowVol INTEGER,
        Amount DOUBLE,
        Inside INTEGER,
        Outside INTEGER,
        TickDiff DOUBLE,
        InOutFlag INTEGER,
        Jjjz DOUBLE,
        Buyp1 DOUBLE, Buyp2 DOUBLE, Buyp3 DOUBLE, Buyp4 DOUBLE, Buyp5 DOUBLE,
        Buyv1 INTEGER, Buyv2 INTEGER, Buyv3 INTEGER, Buyv4 INTEGER, Buyv5 INTEGER,
        Sellp1 DOUBLE, Sellp2 DOUBLE, Sellp3 DOUBLE, Sellp4 DOUBLE, Sellp5 DOUBLE,
        Sellv1 INTEGER, Sellv2 INTEGER, Sellv3 INTEGER, Sellv4 INTEGER, Sellv5 INTEGER,
        UpHome INTEGER,
        DownHome INTEGER,
        Before5MinNow DOUBLE,
        Average DOUBLE,
        XsFlag INTEGER,
        Zangsu DOUBLE,
        ZAFPre3 DOUBLE
    )""")

def fetch_data():
    """获取重点证券快照"""
    tq.initialize(__file__)
    try:
        # 优先使用TOP_CODES，若为空则从数据库取前100只
        if TOP_CODES:
            codes = TOP_CODES
        else:
            codes = duckdb.connect(DB_PATH).execute("SELECT DISTINCT code FROM stock_daily_kline LIMIT 100").fetchall()
            codes = [c[0] for c in codes]
        logger.info(f"获取 {len(codes)} 只重点证券快照")

        rows = []
        for code in codes:  # 全量证券
            try:
                data = tq.get_market_snapshot(stock_code=code, field_list=[])
                row = {
                    'code': code,
                    'snapshot_time': datetime.now(),
                    'LastClose': float(data.get('LastClose', 0)),
                    'Open': float(data.get('Open', 0)),
                    'Max': float(data.get('Max', 0)),
                    'Min': float(data.get('Min', 0)),
                    'Now': float(data.get('Now', 0)),
                    'Volume': int(data.get('Volume', 0)),
                    'NowVol': int(data.get('NowVol', 0)),
                    'Amount': float(data.get('Amount', 0)),
                    'Inside': int(data.get('Inside', 0)),
                    'Outside': int(data.get('Outside', 0)),
                    'TickDiff': float(data.get('TickDiff', 0)),
                    'InOutFlag': int(data.get('InOutFlag', 2)),
                    'Jjjz': float(data.get('Jjjz', 0)),
                    'UpHome': int(data.get('UpHome', 0)),
                    'DownHome': int(data.get('DownHome', 0)),
                    'Before5MinNow': float(data.get('Before5MinNow', 0)),
                    'Average': float(data.get('Average', 0)),
                    'XsFlag': int(data.get('XsFlag', 2)),
                    'Zangsu': float(data.get('Zangsu', 0)),
                    'ZAFPre3': float(data.get('ZAFPre3', 0))
                }
                # 展开五档买卖
                for i, (p, v) in enumerate(zip(data.get('Buyp', []), data.get('Buyv', [])), 1):
                    row[f'Buyp{i}'], row[f'Buyv{i}'] = float(p), int(v)
                for i, (p, v) in enumerate(zip(data.get('Sellp', []), data.get('Sellv', [])), 1):
                    row[f'Sellp{i}'], row[f'Sellv{i}'] = float(p), int(v)
                rows.append(row)
            except Exception as e:
                logger.debug(f"{code} 获取失败: {e}")

        df = pd.DataFrame(rows)
        tq.close()
        return df
    except Exception as e:
        logger.error(f"fetch_data 错误: {e}")
        return pd.DataFrame()

def save_data(con, df):
    if df.empty:
        logger.warning("数据为空，跳过入库")
        return
    con.execute("DELETE FROM market_snapshot")
    con.execute("INSERT INTO market_snapshot SELECT * FROM df")

def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)
        df = fetch_data()
        if not df.empty:
            save_data(con, df)
            logger.success(f"✓ {TABLE} 入库 {len(df)} 条")
            return True
        return False
    except Exception as e:
        logger.error(f"✗ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()

if __name__ == '__main__':
    run()
