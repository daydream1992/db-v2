#!/usr/bin/env python3
"""
批量获取全市场股票+板块的88个字段数据，入库 DuckDB

@读取: tqcenter.get_more_info(stock_code, field_list=[])
"""
# @meta table=sjb_api_plhqL2kz_88zd cn=L2快照88字段 dir=1_入库 sort=101
# @meta schedule=daily mode=increment source=tqcenter API
# @meta note: 脚本文件名含前缀101_jb_，实际表名去掉前缀

import sys, time, json, os
from datetime import datetime
from pathlib import Path

import duckdb, pandas as pd
from loguru import logger

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\sys')
from tqcenter import tq
tq.initialize(os.path.abspath(__file__))

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'sjb_api_plhqL2kz_88zd'  # DuckDB 表名不能以数字开头
MODE = 'increment'
SCHEDULE = 'daily'

# === 88字段英→中映射表（含分类）===
# cat: L2=L2资金流 ZAF=涨跌幅 ZT=涨停 VAL=估值 DEAL=成交 BASE=基础 FLAG=标志 DATE=日期 OTHER=其他
FIELD_MAP = {
    'MainBusiness':       {'cn': '主营构成',       'cat': 'BASE'},
    'SafeValue':          {'cn': '安全值',         'cat': 'OTHER'},
    'ShineValue':         {'cn': '发光值',          'cat': 'OTHER'},
    'ShapeValue':         {'cn': '形状值',          'cat': 'OTHER'},
    'TPFlag':             {'cn': 'T+0标志',        'cat': 'FLAG'},
    'ZTPrice':            {'cn': '涨停价',          'cat': 'ZT'},
    'DTPrice':            {'cn': '跌停价',          'cat': 'ZT'},
    'HqDate':             {'cn': '行情日期',        'cat': 'DATE'},
    'fHSL':               {'cn': '换手率%',         'cat': 'DEAL'},
    'fLianB':             {'cn': '连板天数',        'cat': 'ZT'},
    'Wtb':                {'cn': '委比',            'cat': 'OTHER'},
    'Zsz':                {'cn': '总市值_万',        'cat': 'VAL'},
    'Ltsz':               {'cn': '流通市值_万',      'cat': 'VAL'},
    'vzangsu':            {'cn': '涨速',            'cat': 'ZAF'},
    'Fzhsl':              {'cn': '振幅%',            'cat': 'DEAL'},
    'FzAmo':              {'cn': '成交金额_万',       'cat': 'DEAL'},
    'VOpenZAF':           {'cn': '抢筹涨幅%',        'cat': 'ZAF'},
    'ZAF':                {'cn': '日涨跌幅%',        'cat': 'ZAF'},
    'ZAFYesterday':       {'cn': '昨日涨跌幅%',      'cat': 'ZAF'},
    'ZAFPre2D':           {'cn': '前2日涨跌幅%',     'cat': 'ZAF'},
    'ZAFPre5':            {'cn': '近5日涨跌幅%',     'cat': 'ZAF'},
    'ZAFPre10':           {'cn': '近10日涨跌幅%',    'cat': 'ZAF'},
    'ZAFPre20':           {'cn': '近20日涨跌幅%',    'cat': 'ZAF'},
    'ZAFPre30':           {'cn': '近30日涨跌幅%',    'cat': 'ZAF'},
    'ZAFPre60':           {'cn': '近60日涨跌幅%',    'cat': 'ZAF'},
    'ZAFYear':            {'cn': '近一年涨跌幅%',    'cat': 'ZAF'},
    'ZAFPreMyMonth':      {'cn': '近一月涨跌幅%',    'cat': 'ZAF'},
    'ZAFPreOneYear':      {'cn': '近一年涨幅2%',     'cat': 'ZAF'},
    'Zjl':                {'cn': '主买净额_万',      'cat': 'L2'},
    'Zjl_HB':             {'cn': '主力净流入_万',    'cat': 'L2'},
    'TotalBVol':          {'cn': '总买量',           'cat': 'L2'},
    'TotalSVol':          {'cn': '总卖量',           'cat': 'L2'},
    'BCancel':            {'cn': '买撤单笔数',       'cat': 'L2'},
    'SCancel':            {'cn': '卖撤单笔数',       'cat': 'L2'},
    'L2TicNum':           {'cn': 'L2逐笔成交数',     'cat': 'L2'},
    'L2OrderNum':          {'cn': 'L2逐笔委托数',     'cat': 'L2'},
    'FCAmo':              {'cn': '主买成交额_万',    'cat': 'L2'},
    'FCb':                {'cn': '封单比',           'cat': 'L2'},
    'OpenZAF':            {'cn': '开盘涨跌幅%',      'cat': 'ZAF'},
    'OpenAmo':            {'cn': '开盘金额',         'cat': 'DEAL'},
    'OpenZTBuy':          {'cn': '开盘涨停买入',      'cat': 'ZT'},
    'OpenAmoPre1':        {'cn': '昨日开盘金额',      'cat': 'DEAL'},
    'OpenVolPre1':        {'cn': '昨日开盘量',        'cat': 'DEAL'},
    'CJJEPre1':           {'cn': '昨日成交金额',       'cat': 'DEAL'},
    'CJJEPre3':           {'cn': '前3日成交金额',     'cat': 'DEAL'},
    'FDEPre1':            {'cn': '昨日封单额',         'cat': 'ZT'},
    'FDEPre2':            {'cn': '前2日封单额',        'cat': 'ZT'},
    'ZTGPNum':            {'cn': '板块内涨停个股数',   'cat': 'ZT'},
    'LastStartZT':        {'cn': '首次涨停时间',       'cat': 'ZT'},
    'LastZTHzNum':         {'cn': '连板数',            'cat': 'ZT'},
    'EverZTCount':         {'cn': '历史涨停次数',       'cat': 'ZT'},
    'ConZAFDateNum':       {'cn': '连涨天数',           'cat': 'ZT'},
    'YearZTDay':           {'cn': '近一年涨停天数',     'cat': 'ZT'},
    'MA5Value':            {'cn': 'MA5均线值',         'cat': 'OTHER'},
    'HisHigh':             {'cn': '历史最高价',        'cat': 'BASE'},
    'HisLow':              {'cn': '历史最低价',        'cat': 'BASE'},
    'IPO_Price':           {'cn': 'IPO发行价',          'cat': 'BASE'},
    'More_YJL':            {'cn': '业绩预告',          'cat': 'BASE'},
    'BetaValue':           {'cn': 'Beta系数',           'cat': 'VAL'},
    'DynaPE':              {'cn': '动态市盈率',         'cat': 'VAL'},
    'MorePE':              {'cn': '更多PE',             'cat': 'VAL'},
    'StaticPE_TTM':         {'cn': '静态PE_TTM',         'cat': 'VAL'},
    'DYRatio':             {'cn': '股息率',             'cat': 'VAL'},
    'PB_MRQ':              {'cn': '市净率',             'cat': 'VAL'},
    'IsT0Fund':            {'cn': '是否T+0基金',       'cat': 'FLAG'},
    'IsZCZGP':             {'cn': '是否中概股',         'cat': 'FLAG'},
    'IsKzz':               {'cn': '是否可转债',         'cat': 'FLAG'},
    'Kzz_HSCode':          {'cn': '可转债沪市代码',     'cat': 'BASE'},
    'QHMainYYMM':          {'cn': '期货主力合约月份',   'cat': 'BASE'},
    'FreeLtgb':            {'cn': '自由流通股本',       'cat': 'VAL'},
    'Yield':               {'cn': '收益率',             'cat': 'VAL'},
    'KfEarnMoney':          {'cn': '可赚钱',             'cat': 'OTHER'},
    'RDInputFee':           {'cn': '研发投入费用',       'cat': 'BASE'},
    'CashZJ':              {'cn': '现金资金',            'cat': 'BASE'},
    'PreReceiveZJ':        {'cn': '预收资金',            'cat': 'BASE'},
    'OtherQYJzc':          {'cn': '其他权益净资产',      'cat': 'BASE'},
    'StaffNum':            {'cn': '员工人数',            'cat': 'BASE'},
    'RecentGGJYDate':      {'cn': '最近股权激励日期',   'cat': 'DATE'},
    'RecentHGDate':        {'cn': '最近回购日期',        'cat': 'DATE'},
    'RecentIncentDate':    {'cn': '最近激励日期',        'cat': 'DATE'},
    'NoticeDate_Recent':   {'cn': '最近公告日期',        'cat': 'DATE'},
    'RecentReleaseDate':   {'cn': '最近解禁日期',        'cat': 'DATE'},
    'RecentDZDate':        {'cn': '最近大宗交易日期',    'cat': 'DATE'},
    'ReportDate':          {'cn': '报告期',              'cat': 'DATE'},
    'ZTDate_Recent':       {'cn': '最近涨停日期',        'cat': 'DATE'},
    'DTDate_Recent':       {'cn': '最近跌停日期',        'cat': 'DATE'},
    'TopDate_Recent':      {'cn': '最近创新高日期',      'cat': 'DATE'},
    'StopJYDate_Recent':   {'cn': '最近停牌日期',       'cat': 'DATE'},
    'code':                {'cn': '股票代码',            'cat': 'BASE'},
    'stock_type':          {'cn': '标的类型',            'cat': 'BASE'},
    'fetch_time':          {'cn': '查询时间',            'cat': 'DATE'},
}

# 分类中文说明
CAT_CN = {
    'L2':   'L2资金流',
    'ZAF':  '涨跌幅',
    'ZT':   '涨停相关',
    'VAL':  '估值/市值',
    'DEAL': '成交/换手',
    'BASE': '基础/公司',
    'FLAG': '标志位',
    'DATE': '日期',
    'OTHER':'其他技术指标',
}

# 列名（英文字段名，DuckDB 规范）
COLUMNS_EN = list(FIELD_MAP.keys())


def _stock_code_to_tdx(code: str) -> str:
    """股票代码转换为TQ格式（需带交易所后缀）

    规则: 已带后缀(.SH/.SZ)→保持原样
          6开头→.SH, 其他→.SZ
          板块代码(88/9开头)→保持原样
    """
    # 已带后缀直接返回
    if code.endswith('.SH') or code.endswith('.SZ'):
        return code
    # 板块代码或特殊代码保持原样
    if code.startswith(('88', '9')):
        return code
    # 股票代码加后缀
    if code.startswith('6'):
        return f"{code}.SH"
    else:
        return f"{code}.SZ"


def _get_schema_from_sample(sample_df: pd.DataFrame) -> str:
    """根据样本数据推断 DuckDB 列类型"""
    cols = []
    for col in sample_df.columns:
        if col == 'code':
            cols.append(f'"{col}" VARCHAR')
        elif sample_df[col].dtype == 'object':
            cols.append(f'"{col}" VARCHAR')
        elif sample_df[col].dtype == 'int64':
            cols.append(f'"{col}" BIGINT')
        else:
            cols.append(f'"{col}" DOUBLE')
    return ',\n    '.join(cols)


def fetch_data():
    """获取全市场股票+板块的88字段快照"""
    # 获取板块列表
    sectors = tq.get_sector_list()
    logger.info(f"板块总数: {len(sectors)}")

    # 遍历板块获取全市场股票（set自动去重）
    all_stocks = set()
    for sector in sectors:
        stocks_in_sector = tq.get_stock_list_in_sector(sector)
        if stocks_in_sector:
            all_stocks.update(stocks_in_sector)
    stocks = sorted(all_stocks)
    stocks_set = set(stocks)
    logger.info(f"股票总数: {len(stocks)}")

    # 合并股票和板块
    all_codes = stocks + sectors
    logger.info(f"总目标数: {len(all_codes)}")

    # 获取数据
    all_data = []
    failed = []
    start_time = time.time()
    batch_size = 100

    for i, code in enumerate(all_codes):
        try:
            # 股票代码需转换格式（加交易所后缀）
            tdx_code = _stock_code_to_tdx(code)
            data = tq.get_more_info(tdx_code, field_list=[])
            if data:
                data['code'] = code  # 存储原始代码
                # stock_type: 股票=stock, 板块=sector
                data['stock_type'] = 'stock' if code in stocks_set else 'sector'
                data['fetch_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                all_data.append(data)
            else:
                failed.append((code, 'empty'))
        except Exception as e:
            failed.append((code, str(e)))

        if (i + 1) % batch_size == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            remaining = (len(all_codes) - i - 1) / rate if rate > 0 else 0
            logger.info(f"  进度: {i+1}/{len(all_codes)} ({rate:.1f} 只/秒), 预计剩余: {remaining:.0f}秒")

    elapsed = time.time() - start_time
    logger.info(f"获取完成! 耗时: {elapsed:.1f}秒, 成功: {len(all_data)}, 失败: {len(failed)}")

    df = pd.DataFrame(all_data)
    if df.empty:
        logger.warning(f"{TABLE}: get_more_info 返回空")
        return pd.DataFrame()

    # 校验上游返回的列是否齐全（silent column drop 检测）
    missing = [c for c in COLUMNS_EN if c not in df.columns]
    if missing:
        logger.error(f"✘ {TABLE} 上游少返 {len(missing)}/{len(COLUMNS_EN)} 列: {missing}")
    extra = [c for c in df.columns if c not in COLUMNS_EN]
    if extra:
        logger.warning(f"⚠ {TABLE} 上游多返 {len(extra)} 列(未声明): {extra}")

    # 统一列顺序(缺失列自然不出现, 已在日志中暴露)
    cols_ordered = [c for c in COLUMNS_EN if c in df.columns]
    df = df[cols_ordered]

    # 保存失败列表
    if failed:
        fail_path = PROJECT_ROOT / 'logs' / f'{TABLE}_failed_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        fail_path.parent.mkdir(exist_ok=True)
        with open(fail_path, 'w', encoding='utf-8') as f:
            json.dump(failed, f, ensure_ascii=False, indent=2)
        logger.warning(f"失败目标已保存: {fail_path}")

    return df


def ensure_table(con):
    """确保表存在（首次运行时根据样本建表）"""
    # 先检查表是否已存在
    try:
        con.execute(f"SELECT 1 FROM {TABLE} LIMIT 1")
        logger.debug(f"{TABLE} 已存在，跳过建表")
        return
    except:
        pass

    # 获取样本数据推断 schema
    logger.info(f"{TABLE}: 首次运行，获取样本推断表结构...")
    sample_df = fetch_data()
    if sample_df.empty:
        # 兜底：创建仅含必需列的表
        logger.warning(f"{TABLE}: 样本为空，创建默认表结构")
        con.execute(f"""CREATE TABLE {TABLE} (
            date DATE,
            code VARCHAR,
            stock_type VARCHAR,
            fetch_time VARCHAR
        )""")
        return

    # 根据样本推断类型
    schema = _get_schema_from_sample(sample_df)
    con.execute(f"""CREATE TABLE {TABLE} (
        {schema}
    )""")
    # 备份样本（首次建表后清空，正式数据由 save_data 写入）
    con.execute(f"DELETE FROM {TABLE}")
    logger.info(f"{TABLE}: 建表完成")


def save_data(con, df):
    """保存数据到数据库（增量模式 - 快照模式）

    去重键: HqDate + code（同一天同一code只保留一条）
    同步备份: 数据同时写入 DuckDB 和 parquet 文件
    """
    if df.empty:
        logger.info(f"{TABLE}: 数据为空，跳过")
        return

    total = len(df)

    # 1. DuckDB: 按 HqDate + code 去重
    if MODE == 'increment':
        dates_codes = df[['HqDate', 'code']].drop_duplicates().values.tolist()
        for hqdate, code in dates_codes:
            con.execute(f"DELETE FROM {TABLE} WHERE HqDate = ? AND code = ?", [hqdate, code])

    # 2. 写入 DuckDB
    con.register('_df', df)
    cols = df.columns.tolist()
    col_list = ','.join([f'"{c}"' for c in cols])
    sel_list = ','.join([f'"{c}"' for c in cols])
    con.execute(f"INSERT INTO {TABLE}({col_list}) SELECT {sel_list} FROM _df")
    con.unregister('_df')

    # 3. 同步写入 parquet（DuckDB 直接导出整表）
    _sync_parquet(con)

    logger.info(f"{TABLE}: 入库完成，共 {total:,} 条")


def _get_parquet_path() -> Path:
    """获取 parquet 文件路径（放在数据库同目录）"""
    backup_dir = Path(DB_PATH).parent
    return backup_dir / f'{TABLE}.parquet'


def _sync_parquet(con):
    """同步 DuckDB 表数据到 parquet 文件（以 DuckDB 为准，全量覆盖）"""
    try:
        count = con.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
        if count == 0:
            return

        pq_path = _get_parquet_path()
        # DuckDB 全表导出覆盖 parquet，保证两者严格同步
        con.execute(f"COPY {TABLE} TO '{pq_path}' (FORMAT PARQUET, OVERWRITE_OR_IGNORE TRUE)")
        logger.info(f"{TABLE}: parquet 已同步 ({count:,} 条)")

    except Exception as e:
        logger.warning(f"{TABLE}: parquet 同步失败: {e}")


def run(force=False):
    """运行脚本

    快照模式：每次运行获取当前全市场快照，按 HqDate+code 去重
    """
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        # 增量检测：检查是否已有今天(HqDate)的快照
        if not force and MODE == 'increment':
            try:
                today = datetime.now().strftime('%Y%m%d')
                count_today = con.execute(
                    f"SELECT COUNT(*) FROM {TABLE} WHERE HqDate = ?", [today]
                ).fetchone()[0]
                if count_today > 0:
                    logger.info(f"○ {TABLE} 今日快照已存在(HqDate={today}, {count_today}条)，跳过")
                    return True
            except Exception as e:
                logger.warning(f"增量检测失败，继续执行: {e}")

        ensure_table(con)
        df = fetch_data()
        save_data(con, df)
        logger.info(f"✔ {TABLE} 完成")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        tq.close()
        con.close()


if __name__ == '__main__':
    run()
