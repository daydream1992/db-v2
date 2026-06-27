"""
通达信股票交易数据 (vipdoc/cw) 解析与 Parquet 导出

二进制格式：13 字节/条，无文件头，小端序
[indicator(u8)] [date(u32,YYYYMMDD)] [value1(f32)] [value2(f32)]
"""
import struct
import os
import sys
import logging
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

# 单条记录格式: indicator(u8) + date(u32) + value1(f32) + value2(f32) = 13 bytes
CW_RECORD_SIZE = 13

# numpy dtype 用于批量解析
CW_DTYPE = np.dtype([
    ('indicator', 'u1'),
    ('date', '<u4'),
    ('value1', '<f4'),
    ('value2', '<f4'),
])

# GP 指标名称映射 (GP01-GP46)
GP_NAMES = {
    0x01: "GP01-股东人数", 0x02: "GP02-龙虎榜", 0x03: "GP03-融资融券1",
    0x04: "GP04-大宗交易", 0x05: "GP05-增减持1", 0x06: "GP06-陆股通持股量",
    0x07: "GP07-陆股通市场成交净额", 0x08: "GP08-龙虎榜机构卖方",
    0x09: "GP09-龙虎榜机构买方", 0x0A: "GP10-近3月机构调研",
    0x0B: "GP11-融资融券2", 0x0C: "GP12-融资融券3", 0x0D: "GP13-融资融券4",
    0x0E: "GP14-涨停数据", 0x0F: "GP15-涨跌停", 0x10: "GP16-总市值",
    0x11: "GP17-龙虎榜营业部", 0x12: "GP18-龙虎榜沪深股通",
    0x13: "GP19-每周股票质押数量", 0x14: "GP20-每周股票质押比例",
    0x15: "GP21-股息率", 0x16: "GP22-涨跌停封成比封流比",
    0x17: "GP23-拟增减持", 0x18: "GP24-涨停", 0x19: "GP25-盘前盘后成交量",
    0x1A: "GP26-拟增减持金额", 0x1B: "GP27-人气排名", 0x1C: "GP28-股票回购",
    0x1D: "GP29-证券信息", 0x1E: "GP30-分红送转", 0x1F: "GP31-转融券1",
    0x20: "GP32-转融券2", 0x21: "GP33-跌停数据", 0x22: "GP34-跌停",
    0x23: "GP35-增减持2", 0x24: "GP36-竞价涨停买", 0x25: "GP37-龙虎榜2",
    0x26: "GP38-涨停相关1", 0x27: "GP39-涨停相关2", 0x28: "GP40-涨停相关3",
    0x29: "GP41-股权登记日", 0x2A: "GP42-龙虎榜专业机构买卖净额",
    0x2B: "GP43-配股实施", 0x2C: "GP44-股票评分", 0x2D: "GP45-评级系数",
    0x2E: "GP46-拟询价转让", 0x2F: "GP47-未知",
}

# BK 板块指标名称映射 (BK05-BK19)
BK_NAMES = {
    5: "BK05-市盈率TTM", 6: "BK06-市净率MRQ", 7: "BK07-市销率TTM",
    8: "BK08-市现率TTM", 9: "BK09-涨跌数", 10: "BK10-板块总市值(亿元)",
    11: "BK11-板块流通市值(亿元)", 12: "BK12-涨停数", 13: "BK13-跌停数",
    14: "BK14-涨停数据", 15: "BK15-融资融券", 16: "BK16-陆股通资金流入",
    17: "BK17-开盘成交数", 18: "BK18-板块股息率", 19: "BK19-板块自由流通市值(亿元)",
}


def extract_code_info(filename: str) -> dict:
    """从文件名提取代码信息。

    Returns:
        {code: str, market: str, data_type: str}
        data_type: 'GP' (个股) 或 'BK' (板块)
        区分方式: gpsh*.dat 中 code>=880000 为板块，否则为个股
    """
    name = Path(filename).stem  # 去掉 .dat
    if len(name) >= 6:
        market_prefix = name[2:4].upper()
        code_str = name[4:]

        suffix_map = {'SZ': '.SZ', 'SH': '.SH', 'BJ': '.BJ'}
        suffix = suffix_map.get(market_prefix, '')

        # 区分 GP/BK: SH 市场中 code>=880000 为板块指数(BK)，否则为个股(GP)
        # 注意：gpsh*.dat 中 600xxx 是个股(属于 SH 市场)，880xxx 是板块
        if market_prefix == 'SH' and code_str.isdigit() and int(code_str) >= 880000:
            data_type = 'BK'
            market = 'sh'  # BK 板块属于 SH 市场
        elif market_prefix == 'SH':
            data_type = 'GP'
            market = 'sh'  # gpsh*.dat 中的个股代码也属于 SH 市场
        else:
            data_type = 'GP'
            market = market_prefix.lower()  # SZ, BJ 市场的文件都是个股

        return {'code': f"{code_str}{suffix}", 'market': market, 'data_type': data_type}
    return {'code': 'UNKNOWN', 'market': 'other', 'data_type': 'GP'}


def parse_cw_file(filepath: str) -> dict:
    """解析单个 cw .dat 文件，返回 {code, market, data_type, records} 字典。

    records 是 numpy 结构化数组，字段: indicator, date, value1, value2
    """
    info = extract_code_info(os.path.basename(filepath))

    data = np.fromfile(filepath, dtype=CW_DTYPE)

    # 过滤无效日期 (date=0)
    valid = data['date'] != 0
    records = data[valid]

    return {
        'code': info['code'],
        'market': info['market'],
        'data_type': info['data_type'],
        'records': records,
        'count': len(records),
    }


def parse_cw_directory(cw_dir: str, max_workers: int = 4) -> dict:
    """解析 cw 目录下所有 .dat 文件，按数据类型(GP/BK)分组返回。

    Returns:
        {'gp': [(code, market, records), ...], 'bk': [(code, market, records), ...]}
    """
    cw_path = Path(cw_dir)
    if not cw_path.exists():
        log.warning(f"cw 目录不存在: {cw_dir}")
        return {}

    # 收集 .dat 文件
    dat_files = [
        str(f) for f in cw_path.iterdir()
        if f.suffix == '.dat' and f.name.startswith(('gpsz', 'gpsh', 'gpbj'))
    ]
    log.info(f"发现 {len(dat_files)} 个 cw .dat 文件")

    if not dat_files:
        return {}

    # 并行解析
    results = {'gp': [], 'bk': []}
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(parse_cw_file, f): f for f in dat_files}
        for future in futures:
            try:
                result = future.result()
                code = result['code']
                records = result['records']
                market = result['market']
                data_type = result['data_type']

                if len(records) == 0:
                    continue

                results[data_type.lower()].append((code, market, records))

            except Exception as e:
                log.warning(f"解析文件失败: {futures[future]}: {e}")

    # 统计
    for dtype, items in results.items():
        count = sum(len(r) for _, _, r in items)
        label = '板块' if dtype == 'bk' else '个股'
        log.info(f"  {label} (BK): {len(items)} 个, {count} 条记录" if dtype == 'bk'
                 else f"  个股 (GP): {len(items)} 个, {count} 条记录")
    total = sum(len(r) for items in results.values() for _, _, r in items)
    log.info(f"总计: {total} 条记录")

    return results


def date_to_str(date_u32: np.ndarray) -> np.ndarray:
    """将 YYYYMMDD u32 数组转为日期字符串数组"""
    year = date_u32 // 10000
    month = (date_u32 % 10000) // 100
    day = date_u32 % 100
    return np.char.add(
        np.char.add(
            year.astype(str),
            np.char.add(np.char.zfill(month.astype(str), 2), np.char.zfill(day.astype(str), 2))
        ),
        ''
    )


def write_cw_parquet(cw_data: dict, output_dir: str, batch_size: int = 2_000_000):
    """将解析后的 cw 数据写入 Parquet 文件（流式分批写入，避免内存溢出）。

    输出 2 个独立文件:
      - gp_cw.parquet  个股数据 (GP01-GP46)
      - bk_cw.parquet  板块数据 (BK05-BK19)

    Args:
        cw_data: {'gp': [(code, market, records), ...], 'bk': [(code, market, records), ...]}
        output_dir: 输出目录
        batch_size: 每批写入的记录数
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # GP 个股 Parquet schema
    gp_schema = pa.schema([
        pa.field('code', pa.utf8()),          # 股票代码 如 000001.SZ
        pa.field('market', pa.utf8()),         # 市场 sh/sz/bj
        pa.field('indicator', pa.uint8()),     # 指标编号 1-46 对应 GP01-GP46
        pa.field('date', pa.date32()),         # 日期
        pa.field('value1', pa.float32()),      # 子值1
        pa.field('value2', pa.float32()),      # 子值2
    ])

    # BK 板块 Parquet schema
    bk_schema = pa.schema([
        pa.field('code', pa.utf8()),          # 板块代码 如 881010.SH
        pa.field('market', pa.utf8()),         # 市场 (板块固定为 sh)
        pa.field('indicator', pa.uint8()),     # 指标编号 5-19 对应 BK05-BK19
        pa.field('date', pa.date32()),         # 日期
        pa.field('value1', pa.float32()),      # 子值1
        pa.field('value2', pa.float32()),      # 子值2
    ])

    for data_type, schema in [('gp', gp_schema), ('bk', bk_schema)]:
        items = cw_data.get(data_type, [])
        if not items:
            continue

        output_file = out_path / f"{data_type}_cw.parquet"
        writer = pq.ParquetWriter(output_file, schema, compression='snappy')
        total_written = 0
        label = '板块' if data_type == 'bk' else '个股'

        try:
            batch_codes = []
            batch_markets = []
            batch_records = []
            batch_len = 0

            def flush_batch():
                nonlocal batch_codes, batch_markets, batch_records, batch_len, total_written
                if not batch_records:
                    return

                all_recs = np.concatenate(batch_records)
                n = len(all_recs)

                # 日期转换: YYYYMMDD -> date32
                date_arr = all_recs['date'].astype(np.uint32)
                try:
                    import pandas as pd
                    dt_series = pd.to_datetime(date_arr.astype(str), format='%Y%m%d', errors='coerce')
                    epoch_ts = pd.Timestamp('1970-01-01')
                    date32_values = ((dt_series - epoch_ts).days).fillna(0).astype(np.int32).values
                except Exception:
                    date32_values = np.zeros(n, dtype=np.int32)

                # 构建 code 和 market 数组
                code_arr = []
                market_arr = []
                for code, market, recs in zip(batch_codes, batch_markets, batch_records):
                    cnt = len(recs)
                    code_arr.extend([code] * cnt)
                    market_arr.extend([market] * cnt)

                table = pa.table({
                    'code': pa.array(code_arr, type=pa.utf8()),
                    'market': pa.array(market_arr, type=pa.utf8()),
                    'indicator': pa.array(all_recs['indicator'].tolist(), type=pa.uint8()),
                    'date': pa.array(date32_values.tolist(), type=pa.date32()),
                    'value1': pa.array(all_recs['value1'].tolist(), type=pa.float32()),
                    'value2': pa.array(all_recs['value2'].tolist(), type=pa.float32()),
                })
                writer.write_table(table)
                total_written += n

                batch_codes = []
                batch_markets = []
                batch_records = []
                batch_len = 0

            for code, market, records in items:
                batch_codes.append(code)
                batch_markets.append(market)
                batch_records.append(records)
                batch_len += len(records)

                if batch_len >= batch_size:
                    flush_batch()

            flush_batch()

        finally:
            writer.close()

        log.info(f"OK {label}数据写入 {output_file} ({total_written} 条)")


def main():
    """主入口"""
    import argparse
    parser = argparse.ArgumentParser(description='通达信股票交易数据 (cw) 转 Parquet')
    parser.add_argument('--cw-dir', type=str, default=r'D:\iTendx\vipdoc\cw',
                        help='cw 数据目录路径')
    parser.add_argument('--output-dir', type=str, default='./output/cw',
                        help='Parquet 输出目录')
    parser.add_argument('--max-workers', type=int, default=4,
                        help='并行解析工作进程数')
    args = parser.parse_args()

    print("=" * 60)
    print("通达信股票交易数据 (cw) 转 Parquet")
    print("=" * 60)
    print(f"数据目录: {args.cw_dir}")
    print(f"输出目录: {args.output_dir}")
    print()

    start = datetime.now()

    # 解析
    market_data = parse_cw_directory(args.cw_dir, max_workers=args.max_workers)
    if not market_data:
        print("未找到可解析的数据文件")
        return

    # 写入 Parquet
    write_cw_parquet(market_data, args.output_dir)

    elapsed = (datetime.now() - start).total_seconds()
    print(f"\n导出完成，耗时 {elapsed:.1f} 秒")


if __name__ == '__main__':
    main()
