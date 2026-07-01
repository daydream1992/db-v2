#!/usr/bin/env python3
"""骗炮全年回测 + 股本数据衔接 — 临时编排脚本（完成后可删）"""
import subprocess, duckdb, sys, time
from datetime import datetime
from pathlib import Path

DB = r'K:\DB数据库_v2\db\profit_radar.duckdb'
PROJECT_ROOT = Path(__file__).parent.parent
SEGMENTS = [
    ('20250102','20250331','2025Q1',57),
    ('20250401','20250630','2025Q2',60),
    ('20250701','20250930','2025Q3',66),
    ('20251001','20251231','2025Q4',60),
    ('20260101','20260622','2026',110),
]
MAX_RETRY = 5  # 每段最多重试次数

LOGFILE = PROJECT_ROOT / 'logs' / f'pianpao_full_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'

def log(msg):
    """同时写日志和打印（安全处理编码）"""
    s = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    # 写日志
    with open(LOGFILE, 'a', encoding='utf-8') as f:
        f.write(s + '\n')
    # 打印（处理 GBK 编码错误）
    try:
        print(s)
    except UnicodeEncodeError:
        # Windows 控制台可能不支持 UTF-8，用 ASCII 替换
        print(s.encode('ascii', 'replace').decode('ascii'))

def seg_done(s, e, expected_total):
    """该段交易日是否全部进库"""
    try:
        con = duckdb.connect(DB, read_only=True)
        # 期望总数（从trading_calendar查实际交易日）
        total = con.execute(f"SELECT COUNT(*) FROM trading_calendar WHERE date >= '{s[:4]}-{s[4:6]}-{s[6:]}' AND date <= '{e[:4]}-{e[4:6]}-{e[6:]}' AND is_trading=TRUE").fetchone()[0]
        # 已完成数
        done = con.execute(f"SELECT COUNT(DISTINCT trade_date) FROM pianpao_daily_summary WHERE trade_date >= '{s[:4]}-{s[4:6]}-{s[6:]}' AND trade_date <= '{e[:4]}-{e[4:6]}-{e[6:]}'").fetchone()[0]
        con.close()
        return done >= total, done, total
    except Exception as ex:
        log(f"  [ERROR] 检查完成状态失败: {ex}")
        return False, 0, expected_total

def main():
    log("=" * 60)
    log("骗炮全年回测 + 股本数据衔接 — 开始")
    log("=" * 60)

    overall_start = time.time()

    for s, e, name, expected_total in SEGMENTS:
        log(f"\n[{name}] 开始 (目标: {expected_total}天)")

        for attempt in range(MAX_RETRY):
            is_done, done, total = seg_done(s, e, expected_total)

            if done >= total:
                log(f"[{name}] 已完成 {done}/{total}天，跳过")
                break

            log(f"[{name}] 第{attempt+1}次尝试: 当前 {done}/{total}天")
            seg_start = time.time()

            # 运行回测（不捕获输出，直接写入日志文件）
            try:
                with open(LOGFILE, 'a', encoding='utf-8') as log_f:
                    result = subprocess.run(
                        [sys.executable, str(PROJECT_ROOT / '2_计算' / '71_pianpao_batch.py'), '--start', s, '--end', e],
                        stdout=log_f,
                        stderr=log_f,
                        timeout=7200  # 单段最多2小时
                    )
                seg_el = time.time() - seg_start

                if result.returncode == 0:
                    log(f"[{name}] 本次完成，耗时 {seg_el/60:.1f}分钟")
                else:
                    log(f"[{name}] 本次失败 (exit {result.returncode})，耗时 {seg_el/60:.1f}分钟")
            except subprocess.TimeoutExpired:
                log(f"[{name}] 超时 (>2小时)，继续下一次尝试")
            except Exception as ex:
                log(f"[{name}] 异常: {ex}")

            time.sleep(5)  # 让DuckDB释放锁

        # 最终检查
        is_done, done, total = seg_done(s, e, expected_total)
        if done >= total:
            log(f"[{name}] ✓ 完成 {done}/{total}天")
        else:
            log(f"[{name}] ✗ 未完成 {done}/{total}天 (已达最大重试次数)")
            log(f"[{name}] 继续下一段（可手动重跑补充）")

    # 全部回测完成后，衔接股本数据
    log(f"\n{'=' * 60}")
    log("[137] 开始股本数据入库 (1_入库/137_capital_info.py)")
    log(f"{'=' * 60}")

    try:
        with open(LOGFILE, 'a', encoding='utf-8') as log_f:
            result = subprocess.run(
                [sys.executable, str(PROJECT_ROOT / '1_入库' / '137_capital_info.py')],
                stdout=log_f,
                stderr=log_f,
                timeout=3600  # 最多1小时
            )
        if result.returncode == 0:
            log("[137] ✓ 完成")
        else:
            log(f"[137] ✗ 失败 (exit {result.returncode})")
    except subprocess.TimeoutExpired:
        log("[137] 超时 (>1小时)")
    except Exception as ex:
        log(f"[137] 异常: {ex}")

    overall_el = time.time() - overall_start
    log(f"\n{'=' * 60}")
    log(f"全部完成！总耗时 {overall_el/60:.1f}分钟")
    log(f"日志文件: {LOGFILE}")
    log(f"{'=' * 60}")

if __name__ == '__main__':
    main()
