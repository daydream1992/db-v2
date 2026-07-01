#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""intraday_run.py — 盘中调度(daemon 长进程)
    9:25-15:00 常驻,每 5 分钟跑一帧,内存状态(StateCache)跨帧累积。
    盘中不落库(性能),退出/15:00 后 flush 到 output/eod/state_YYYYMMDD.json。
    ⚠️ 必须 daemon 模式跑(cron 起不来,状态会丢)。
    用法:python intraday_run.py  (前台跑,看实时输出;Ctrl+C 安全退出+flush)
    阈值见 _common.TH
"""
from __future__ import annotations
import sys
import time
import signal
import datetime as dt
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import _common  # noqa: E402
import index_monitor, sector_monitor, stock_monitor  # noqa: E402
from state_cache import StateCache  # noqa: E402

OUTPUT_DIR = SCRIPT_DIR / 'output' / 'eod'
TICK_SECONDS = 300  # __TODO__(建议:300) 5 分钟一帧
# 交易时段(只在这些时段跑)
TRADE_WINDOWS = [('09:25', '11:30'), ('13:00', '15:00')]


state = StateCache()
tq = None


def in_trade_window(now: dt.datetime) -> bool:
    hhmm = now.strftime('%H:%M')
    for lo, hi in TRADE_WINDOWS:
        if lo <= hhmm <= hi:
            return True
    return False


def tick() -> None:
    """跑一帧:3 层采集 + 状态更新 + 信号检测 + 打印"""
    ts = dt.datetime.now().strftime('%H:%M:%S')
    print(f"\n{'='*60}\n帧 {ts}  {state.summary()}\n{'='*60}")

    # 大盘层
    idx = index_monitor.collect(tq)
    north = index_monitor.collect_north_money(tq)
    futures = index_monitor.collect_futures_basis(tq)
    div_sigs = index_monitor.detect_divergence(idx, north, futures)
    sh, sz = idx.get('999999.SH', {}), idx.get('399001.SZ', {})
    for sig in div_sigs:
        print(f"  ⚠️ {sig}")

    # 板块层
    sectors_all = tq.get_sector_list(list_type=0)
    sec_rows = sector_monitor.collect(tq, sectors_all)
    # 首帧打 BlockType 标签(贵,只第一帧做)— 改用静态查表,毫秒级
    sector_monitor.tag_block_type_static(sec_rows)
    # 板块涨停数 → 退潮检测
    sec_zt_now = {r['code']: r['zt_num'] for r in sec_rows}
    drops = state.update_sector_zt(sec_zt_now)
    index_zaf = sh.get('zaf', 0)
    max_flow = max((abs(r['zjl']) for r in sec_rows), default=1) or 1
    sec_ranked = sector_monitor.rank(sec_rows, index_zaf, max_flow)
    mainlines = {r['code'] for r in sec_ranked if r['is_mainline']}
    retreats = [r for r in sec_ranked if sector_monitor.is_retreat(r, drops.get(r['code']))]
    print(f"  主线板块 {len(mainlines)} 个, 退潮预警 {len(retreats)} 个")
    for r in sec_ranked[:5]:
        print(f"    强度Top {r['code']} 涨停{r['zt_num']} 涨幅{r['zaf']}% 主力{r['zjl']:.0f}万")

    # 个股层
    stocks = tq.get_stock_list()
    pools = stock_monitor.collect(tq, stocks, state, ts)
    n_zt = len(pools['首板']) + len(pools['连板梯队'])
    n_dt = len(pools['跌停池'])
    n_zhaban = len(pools['炸板风险'])
    fbl = n_zt / (n_zt + n_zhaban) * 100 if (n_zt + n_zhaban) else 0
    max_lb = max((r['lb'] for r in pools['连板梯队']), default=0)
    udr = (sh.get('up', 0) + sz.get('up', 0)) / max(1, sh.get('down', 0) + sz.get('down', 0))

    # 情绪评级
    emo = index_monitor.rate_emotion(n_zt, round(fbl, 2), max_lb, round(udr, 2))
    print(f"  情绪: {emo['rating']}  {emo['detail']}")
    print(f"  涨停{n_zt} 跌停{n_dt} 炸板{n_zhaban} 封板率{fbl:.1f}% 最高连板{max_lb}")
    print(f"  连板梯队 {len(pools['连板梯队'])} / 首板 {len(pools['首板'])} / "
          f"龙头 {len(pools['龙头'])} / 易炸 {len(pools['易炸预警'])}")

    # 变盘检测(状态层)
    frame_summary = {'ts': ts, 'zt_cnt': n_zt, 'udr': round(udr, 2),
                     'fbl': round(fbl, 2), 'max_lb': max_lb}
    check_turn(frame_summary)
    state.push_frame(frame_summary)


def check_turn(cur: dict) -> None:
    """变盘检测(跨帧)。阈值 TH.TURN_*"""
    prev = state.prev_frame()
    if not prev:
        return
    # 涨停数 5 分钟降幅
    if prev['zt_cnt'] > 0:
        drop = (prev['zt_cnt'] - cur['zt_cnt']) / prev['zt_cnt']
        if drop > _common.TH.TURN_ZT_DROP:
            print(f"  🔄 变盘:涨停数 {prev['zt_cnt']}→{cur['zt_cnt']} 降{drop*100:.0f}%")
    # 涨跌比翻转
    if prev['udr'] >= _common.TH.TURN_UDR_FLIP_HI and cur['udr'] <= _common.TH.TURN_UDR_FLIP_LO:
        print(f"  🔄 变盘:涨跌比 {prev['udr']}→{cur['udr']} 翻转")
    # 封板率连续 N 帧下滑
    if len(state.frame_history) >= _common.TH.TURN_FBL_FRAMES:
        recent = state.frame_history[-_common.TH.TURN_FBL_FRAMES:] + [cur]
        fbls = [f['fbl'] for f in recent]
        if all(fbls[i] >= fbls[i+1] for i in range(len(fbls)-1)):
            total = fbls[0] - fbls[-1]
            if total > _common.TH.TURN_FBL_DROP * 100:
                print(f"  🔄 变盘:封板率连续{_common.TH.TURN_FBL_FRAMES}帧下滑 {total:.1f}%")


def on_exit(signum=None, frame=None):
    """安全退出:flush 状态"""
    print(f"\nflush 状态到磁盘...")
    path = state.flush(OUTPUT_DIR)
    print(f"已落盘 {path}")
    try:
        tq.close()
    except Exception:
        pass
    sys.exit(0)


def main() -> int:
    global tq
    signal.signal(signal.SIGINT, on_exit)
    if not _common.init_tq(__file__):
        return 1
    tq = _common.get_tq()

    print(f"盘中 daemon 启动,每 {TICK_SECONDS}s 一帧,交易时段 {TRADE_WINDOWS}")
    print("Ctrl+C 安全退出(flush 状态后)")

    while True:
        now = dt.datetime.now()
        if in_trade_window(now):
            try:
                tick()
            except Exception as e:
                print(f"  帧异常: {e}")
        else:
            # 非交易时段,退出前 flush(如果是 15:00 后)
            hhmm = now.strftime('%H:%M')
            if hhmm > '15:00':
                print("收盘,daemon 退出")
                on_exit()
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
