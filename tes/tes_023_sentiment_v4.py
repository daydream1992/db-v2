#!/usr/bin/env python3
"""tes_023_sentiment_v4 — 板块层验证
    目标:
      1) get_sector_list 拿到系统板块,数清楚有几个
      2) get_bkjy_value 一次拉 5 个板块的 BK9/BK12/BK13/BK14
      3) 验 BK14 (市场高度 2板及以上) 字段是否真有数据
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def probe_sector_list() -> list:
    banner("step1: get_sector_list 拿系统板块")
    sectors = tq.get_sector_list(list_type=0)
    print(f"  返回 type={type(sectors).__name__} len={len(sectors) if hasattr(sectors,'__len__') else '?'}")
    if isinstance(sectors, list) and sectors:
        print(f"  前 10: {sectors[:10]}")
        print(f"  最后 5: {sectors[-5:]}")
    return sectors


def probe_bkjy(sectors: list) -> None:
    banner("step2: get_bkjy_value 拉板块 BK9/BK12/BK13/BK14")
    if not sectors or not isinstance(sectors, list):
        print("  无板块代码,跳过")
        return
    # 取前 5 个试
    sample = sectors[:5]
    print(f"  样本板块: {sample}")
    res = tq.get_bkjy_value(
        stock_list=sample,
        field_list=['BK9', 'BK12', 'BK13', 'BK14'],
        start_time='20260629',
        end_time='20260701',
    )
    print(f"  顶层 type={type(res).__name__}")
    if isinstance(res, dict):
        for code in sample:
            if code in res:
                blk = res[code]
                if isinstance(blk, dict):
                    print(f"  [{code}]:")
                    for k in ['BK9', 'BK12', 'BK13', 'BK14']:
                        v = blk.get(k, [])
                        if v:
                            last = v[-1] if isinstance(v, list) and v else None
                            print(f"    {k}: {v!r}" if not isinstance(v, list) else f"    {k}: list[len={len(v)}] last={last!r}")
                        else:
                            print(f"    {k}: (空)")
                else:
                    print(f"  [{code}]: {blk!r}")
            else:
                print(f"  [{code}]: 字段缺失")
        if 'ErrorId' in res:
            print(f"  ErrorId={res['ErrorId']}")


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

    sectors = probe_sector_list()
    probe_bkjy(sectors)

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
