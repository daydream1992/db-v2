#!/usr/bin/env python3
"""tes_024_formula_market — 试 formula_process_mul_zb 拿全市场情绪
    目标: 1 个公式对单只"指数/股票"调用,看 TOTALHQINFO/DYNAINFO(60/61) 能不能拿全市场数
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

# 三组公式:用不同函数拿全市场统计
# A: TOTALHQINFO(1~4) — 涨/跌/涨停/跌停
# B: DYNAINFO(60/61) — 沪深总涨/跌; DYNAINFO(22/23) — 板块指数跌/涨停
# C: 用 "999999.SH" 当 stock,看公式上下文里 TOTALHQINFO 拿到的是"上证成分"还是"全市场"
FORMULAS = {
    'A_TOTALHQ': 'TOTALHQINFO(1);TOTALHQINFO(2);TOTALHQINFO(3);TOTALHQINFO(4);',
    'B_DYNA_60': 'DYNAINFO(60);DYNAINFO(61);DYNAINFO(22);DYNAINFO(23);',
    'C_DYNA_88': 'DYNAINFO(88);DYNAINFO(89);DYNAINFO(90);',
}

# 测试用 stock:上证实指(0 票)/上交所 A 股(0 票)/随便 1 只股
TEST_STOCKS = ['999999.SH', '600635.SH']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def probe_one(formula_name: str, formula_src: str, stock: str) -> None:
    print(f"\n--- formula={formula_name} stock={stock} ---")
    t0 = time.time()
    try:
        # 1) 先在客户端"建"公式 — 客户端 GUI 才有,这里只能假装公式已存在
        # 2) 调 formula_zb 单股跑这个公式源码
        res = tq.formula_zb(formula_name=formula_name, formula_arg=formula_src)
        print(f"  formula_zb 耗时 {time.time()-t0:.2f}s")
        print(f"  返回: {res!r}")
    except Exception as e:
        print(f"  formula_zb 异常: {e}")


def probe_mul(formula_name: str, formula_src: str, stock: str) -> None:
    print(f"\n--- formula_process_mul_zb formula={formula_name} stock={stock} ---")
    t0 = time.time()
    try:
        res = tq.formula_process_mul_zb(
            formula_name=formula_name,
            formula_arg=formula_src,
            return_count=1,
            return_date=True,
            stock_list=[stock],
            stock_period='1d',
            start_time='20260701',
            end_time='20260701',
            count=1,
            dividend_type=0,
        )
        print(f"  formula_process_mul_zb 耗时 {time.time()-t0:.2f}s")
        print(f"  顶层: {list(res.keys())[:5] if isinstance(res, dict) else type(res)}")
        if isinstance(res, dict) and 'ErrorId' in res:
            print(f"  ErrorId={res['ErrorId']}")
        for k, v in res.items():
            if k == 'ErrorId':
                continue
            if isinstance(v, dict):
                print(f"  [{k}]:")
                for kk, vv in v.items():
                    if isinstance(vv, list) and vv:
                        print(f"    {kk}: {vv[:2]}")
                    else:
                        print(f"    {kk}: {vv!r}")
            else:
                print(f"  [{k}]: {v!r}")
    except Exception as e:
        print(f"  formula_process_mul_zb 异常: {e}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1

    banner("step1: 试 3 组公式 × 2 个 stock,看返回啥")
    # 单股 formula_zb 不需要公式在客户端存在(传 formula_arg 源码)
    for fname, fsrc in FORMULAS.items():
        for stock in TEST_STOCKS:
            probe_one(fname, fsrc, stock)
            probe_mul(fname, fsrc, stock)

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
