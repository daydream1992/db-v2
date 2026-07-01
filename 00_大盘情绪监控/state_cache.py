#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""state_cache.py — 状态层核心数据中枢
    盘中常驻内存(不落库),跨帧维护:
      - 首封时间(每只股 FCAmo 首次 >0 的帧时间)
      - 帧历史(涨停数/涨跌比/封板率序列,供变盘检测)
      - 上帧连板龙头(检测断板/A杀)
      - 板块前日涨停数(检测板块退潮)
    盘后统一 flush 到 output/eod/state_YYYYMMDD.json
    依赖:intraday_run 必须是 daemon 长进程(9:25-15:00 常驻),否则状态丢失
"""
from __future__ import annotations
import json
import datetime as dt
from pathlib import Path
from typing import Any


class StateCache:
    """盘中状态中枢。daemon 进程内单例。"""

    def __init__(self) -> None:
        self.first_zt_time: dict[str, str] = {}      # code -> 'HH:MM:SS' 首封时间
        self.frame_history: list[dict] = []          # 每帧汇总(涨停数/涨跌比/封板率/时间戳)
        self.prev_lb_leaders: set[str] = set()       # 上帧连板股(检测断板)
        self.prev_sector_zt: dict[str, int] = {}     # 板块前帧涨停数(检测退潮)
        self.today_str: str = dt.date.today().strftime('%Y%m%d')

    # ─── 首封时间 ───
    def record_first_zt(self, code: str, fcamo: float, ts: str) -> None:
        """FCAmo 首次 >0 时记录首封时间(已记录不覆盖)"""
        if fcamo > 0 and code not in self.first_zt_time:
            self.first_zt_time[code] = ts

    def is_first_zt(self, code: str) -> bool:
        return code in self.first_zt_time

    # ─── 帧历史(变盘检测用)───
    def push_frame(self, summary: dict) -> None:
        """每帧结束存一条 {ts, zt_cnt, udr, fengban_rate, max_lb}"""
        self.frame_history.append(summary)
        # 只保留近 20 帧(约 100 分钟),防爆内存
        if len(self.frame_history) > 20:
            self.frame_history = self.frame_history[-20:]

    def prev_frame(self) -> dict | None:
        return self.frame_history[-2] if len(self.frame_history) >= 2 else None

    # ─── 连板断板检测 ───
    def update_lb_leaders(self, lb_codes: set[str]) -> set[str]:
        """返回本帧"断板"股(昨连板今不在)"""
        broken = self.prev_lb_leaders - lb_codes
        self.prev_lb_leaders = lb_codes.copy()
        return broken

    # ─── 板块退潮检测 ───
    def update_sector_zt(self, sector_zt: dict[str, int]) -> dict[str, float]:
        """返回板块涨停数降幅 {code: 降幅比例}"""
        drops = {}
        for code, cur in sector_zt.items():
            prev = self.prev_sector_zt.get(code, 0)
            if prev > 0:
                drops[code] = (prev - cur) / prev
        self.prev_sector_zt = sector_zt.copy()
        return drops

    # ─── 落盘(盘后/daemon 退出时)───
    def flush(self, output_dir: Path) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"state_{self.today_str}.json"
        data = {
            'date': self.today_str,
            'first_zt_time': self.first_zt_time,
            'frame_history': self.frame_history,
            'lb_leaders_final': list(self.prev_lb_leaders),
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        return path

    def summary(self) -> str:
        return (f"首封{len(self.first_zt_time)}只 / 帧{len(self.frame_history)} / "
                f"连板跟踪{len(self.prev_lb_leaders)}只")
