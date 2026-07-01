#!/usr/bin/env python3
"""tes_022_sentiment_v3 — 验证 get_scjy_value / get_more_info.ZTGPNum 的实测返回
    目标:
      1) get_scjy_value(['SC24','SC03','SC04']) 1 次拿全市场 涨停/跌停/曾涨停/曾跌停
      2) get_more_info(指数).ZTGPNum 板块指数涨停家数
      3) 拿上证/深证/科创/创业 4 个板块的 ZTGPNum 验证加和=全市场
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

# SC 系列 关键 ID
SC_FIELDS = {
    'SC24': '沪深京涨跌停股个数(涨停不含ST/未开板新股,跌停不含ST)',
    'SC03': '沪深京涨停股个数(涨停/曾涨停)',
    'SC04': '沪深京跌停股个数(跌停/曾跌停)',
    'SC31': '沪深京涨跌家数(涨/跌,剔除停牌)',
}

# 通达信指数代码
INDEX_CODES = [
    ('999999.SH', '上证指数'),
    ('399001.SZ', '深证成指'),
    ('000300.SH', '沪深300'),
    ('000688.SH', '科创50'),
    ('399006.SZ', '创业板指'),
    ('899050.BJ', '北证50'),
]


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def probe_scjy() -> None:
    """step1: get_scjy_value 全市场指标"""
    banner("step1: get_scjy_value 全市场 SC 系列")
    res = tq.get_scjy_value(field_list=list(SC_FIELDS.keys()))
    print(f"  顶层 type={type(res).__name__}")
    if isinstance(res, dict):
        print(f"  顶层 keys={list(res.keys())[:20]}")
        for fid, desc in SC_FIELDS.items():
            if fid in res:
                v = res[fid]
                if isinstance(v, list):
                    print(f"  [{fid}] {desc}")
                    print(f"           -> list[len={len(v)}] {v[:4]}")
                else:
                    print(f"  [{fid}] -> {v!r}")
        if 'ErrorId' in res:
            print(f"  ErrorId={res['ErrorId']}")


def probe_ztgpnum() -> None:
    """step2: get_more_info 拿各板块 ZTGPNum"""
    banner("step2: get_more_info 板块指数 ZTGPNum 涨停家数")
    for code, name in INDEX_CODES:
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            zh = {
                'UpHome': info.get('UpHome'),
                'DownHome': info.get('DownHome'),
                'ZTGPNum': info.get('ZTGPNum'),  # 板块指数的涨停家数
                'Now': info.get('Now'),
                'ErrorId': info.get('ErrorId'),
            }
            print(f"  [{code} {name}] {zh}")
        except Exception as e:
            print(f"  [{code}] 异常: {e}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1

    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] {str(rc)[:80]}")
    except Exception as e:
        print(f"refresh_cache 失败: {e}")

    probe_scjy()
    probe_ztgpnum()

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
