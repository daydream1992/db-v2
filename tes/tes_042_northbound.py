#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tes_042_northbound — 验 SC8 北向资金(万元)是否可取
    文档明示 SC8=北向资金(docs/TDXQuant接口数据库框架.md L112)。
    本探针:
      1. get_scjy_value(['SC8']) 看 Value 结构 + 最近值
      2. get_scjy_value() 全量 SC keys(确认 SC8 在列 + 看有无其他北向相关)
      3. 带 start_time/end_time 取近期区间
    SC 系列 = T-1 盘后历史序列(非盘中实时)。
    2024-08 起交易所停披露北向实时,验 SC8 是否仍回历史值。
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(os.path.abspath(__file__))
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1
    try:
        tq.refresh_cache(market='AG', force=True)
    except Exception as e:
        print(f"refresh_cache 失败(可忽略): {e}")

    banner("step1: get_scjy_value(['SC8']) 北向资金结构")
    try:
        res = tq.get_scjy_value(field_list=['SC8'])
        print(f"  type={type(res).__name__}")
        if isinstance(res, dict):
            print(f"  keys={list(res.keys())}")
            if 'ErrorId' in res:
                print(f"  ErrorId={res['ErrorId']}")
            v = res.get('SC8')
            print(f"  SC8 type={type(v).__name__}")
            if isinstance(v, list):
                print(f"  SC8 len={len(v)}")
                for it in v[-5:]:
                    print(f"    {it!r}")
            elif isinstance(v, dict):
                print(f"  SC8 keys={list(v.keys())}")
                print(f"  SC8 = {v}")
            else:
                print(f"  SC8 = {v!r}")
        else:
            print(f"  res = {res!r}")
    except Exception as e:
        print(f"  FAIL: {e}")

    banner("step2: get_scjy_value() 全量 SC keys(确认 SC8 在列)")
    try:
        res = tq.get_scjy_value()
        print(f"  type={type(res).__name__}")
        if isinstance(res, dict):
            print(f"  keys={list(res.keys())}")
    except Exception as e:
        print(f"  FAIL: {e}")

    banner("step3: get_scjy_value(['SC8'], start/end) 近期区间")
    for kw in (
        {'field_list': ['SC8'], 'start_time': '20260601', 'end_time': '20260701'},
        {'field_list': ['SC8'], 'start_date': '20260601', 'end_date': '20260701'},
    ):
        try:
            res = tq.get_scjy_value(**kw)
            tag = 'start_time' if 'start_time' in kw else 'start_date'
            print(f"  [{tag}] type={type(res).__name__}")
            if isinstance(res, dict):
                v = res.get('SC8')
                if isinstance(v, list):
                    print(f"  [{tag}] SC8 len={len(v)} 末3={v[-3:]!r}")
                else:
                    print(f"  [{tag}] SC8 = {v!r}")
            break  # 第一个成功的签名就停
        except Exception as e:
            print(f"  [{tag}] FAIL: {e}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
