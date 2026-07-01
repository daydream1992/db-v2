#!/usr/bin/env python3
"""tes_025_gpjy_batch — 试 get_gpjy_value 批量拿 EverZTCount
    假设 1: EverZTCount/LastZTHzNum/LastStartZT 是 GP 字段
    假设 2: get_gpjy_value 批量调用 stock_list 一次拿全
    目标: 5533 只 1 次调用 vs 现在 5533 次循环
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
SAMPLE = ['600635.SH', '300911.SZ', '002822.SZ', '000890.SZ', '301448.SZ']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def probe_single() -> None:
    """step1: 单只 get_more_info 拿 5 个连板字段(对照基线)"""
    banner("step1: 基线 - 单只 get_more_info")
    for code in SAMPLE:
        info = tq.get_more_info(stock_code=code, field_list=[])
        keys_of_interest = ['LastStartZT', 'LastZTHzNum', 'EverZTCount',
                            'ConZAFDateNum', 'YearZTDay']
        out = {k: info.get(k) for k in keys_of_interest}
        print(f"  [{code}] {out}")


def probe_gpjy_field(field_id, label) -> None:
    """step2: 试 get_gpjy_value 用不同 field 名字,看哪个能拿到连板数"""
    print(f"\n--- field={field_id} ({label}) ---")
    t0 = time.time()
    try:
        res = tq.get_gpjy_value(
            stock_list=SAMPLE,
            field_list=[field_id],
            start_time='20260701',
            end_time='20260701',
        )
        print(f"  耗时 {time.time()-t0:.2f}s")
        print(f"  顶层 type={type(res).__name__}")
        if isinstance(res, dict):
            print(f"  顶层 keys={list(res.keys())[:8]}")
            first_code = next((k for k in res if k != 'ErrorId'), None)
            if first_code:
                print(f"  示例 [{first_code}]:")
                v = res[first_code]
                if isinstance(v, list):
                    print(f"    list[len={len(v)}] first={v[0] if v else None}")
                elif isinstance(v, dict):
                    for kk, vv in list(v.items())[:3]:
                        print(f"    {kk}: {vv!r}")
                else:
                    print(f"    {v!r}")
            if 'ErrorId' in res:
                print(f"  ErrorId={res['ErrorId']}")
    except Exception as e:
        print(f"  异常: {e}")


def probe_gpjy_batch_all() -> None:
    """step3: 拿全市场 5533 只 1 次,看耗时"""
    banner("step3: 全市场 get_gpjy_value 1 次")
    codes = tq.get_stock_list()
    print(f"  股票数: {len(codes)}")
    # 试一些疑似字段名
    for field_id in ['EverZTCount', 'EverCount', 'ZTCount']:
        t0 = time.time()
        try:
            res = tq.get_gpjy_value(
                stock_list=codes,
                field_list=[field_id],
                start_time='20260701',
                end_time='20260701',
            )
            print(f"  field={field_id} 耗时 {time.time()-t0:.2f}s "
                  f"返回 type={type(res).__name__} keys={list(res.keys())[:3] if isinstance(res, dict) else '-'}")
        except Exception as e:
            print(f"  field={field_id} 异常: {e}")


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

    probe_single()
    banner("step2: 试 get_gpjy_value 各种字段名")
    for fid, label in [
        ('1', '行情_基本'),
        ('30', '行情_高级'),
        ('EverZTCount', 'EverZTCount(直名)'),
        ('ZTCount', 'ZTCount'),
        ('ZTGPNum', 'ZTGPNum(板块涨停)'),
    ]:
        probe_gpjy_field(fid, label)

    probe_gpjy_batch_all()

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
