#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_temp_bench_tick_20260701 — 实测 intraday tick 单帧耗时
    停 daemon 后跑(避免 TQ 单例冲突)。init 单独计时,tick 单独计时。"""
from __future__ import annotations
import os
import sys
import time
from pathlib import Path

MON = Path(r'k:\DB数据库_v2\00_大盘情绪监控')
sys.path.insert(0, str(MON))
import _common  # noqa: E402
import intraday_run  # noqa: E402

t0 = time.time()
if not _common.init_tq(os.path.abspath(__file__)):
    sys.exit(1)
t_init = time.time()
intraday_run.tq = _common.get_tq()
print(f"[init_tq + refresh_cache] {t_init - t0:.1f}s")

t1 = time.time()
intraday_run.tick()
t2 = time.time()
print(f"\n===== tick 单帧耗时 {t2 - t1:.1f}s =====")

try:
    intraday_run.tq.close()
except Exception:
    pass
