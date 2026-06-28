#!/usr/bin/env python3
"""tes_012_subscribe_warn — 订阅行情 + 涨幅突破实时预警
    用途:探 subscribe_hq / unsubscribe_hq 回调机制 + send_warn 预警推送。
         订阅板块成分股,涨幅 > 阈值首次突破后取消该股订阅并推预警;
         首次回调打印一次原始载荷,看推送帧结构。
    ⚠ 长驻进程(运行到 Ctrl+C),不纳入 tes_000_all 批跑。
    修正(相对原始草稿):
      - get_full_tick(code) 不存在 → 改 get_market_snapshot(stock_code=, field_list=[]),
        字段 Now / LastClose / Volume(与 105_market_snapshot、竞价监控/data.py 一致)。
      - subscribe_hq 累计订阅硬上限 100 只(>100 抛 ValueError)→ MAX_SUBSCRIBE 切片。
      - DRY_RUN=True 默认只打预警载荷,不实推(避免打扰,同 tes_010);置 False 实推。
"""
from __future__ import annotations
import json
import sys
import time
import signal
from pathlib import Path
from datetime import datetime
from collections import defaultdict

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

# ===================== 监控配置 =====================
SECTOR_NAMES = ['通达信88']     # 板块名(也可换板块号如 '880301')
PRICE_RISE_THRESHOLD = 5.0     # 涨幅阈值 > 5%
ANTI_SHAKE_SECONDS = 10        # 同票防抖间隔(秒)
BATCH_SUBSCRIBE_SIZE = 50      # 每批订阅数量
MAX_SUBSCRIBE = 100            # subscribe_hq 累计硬上限,整板块须切片到 ≤100
DRY_RUN = True                 # True=只打载荷不实推;False=实推 send_warn

# ===================== 运行态 =====================
SUBSCRIBE_CODES: list[str] = []
last_warn_time: dict[str, int] = defaultdict(int)
TRIGGERED_STOCKS: set[str] = set()
EXIT_FLAG = False
_seen_first_tick = False       # 仅首次回调打印一次原始载荷(探推送帧结构)


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def now() -> str:
    return datetime.now().strftime('%H:%M:%S')


# ===================== 信号处理 =====================
def signal_handler(signum, frame) -> None:  # noqa: ANN001
    """Ctrl+C:置退出标记,主循环自然退出后由 finally 清理(不 sys.exit,避免重复清理)。"""
    global EXIT_FLAG
    print(f"\n[{now()}] 接收 Ctrl+C,准备退出...")
    EXIT_FLAG = True


# ===================== 工具函数 =====================
def get_valid_stock_codes(sector_names: list[str]) -> list[str]:
    """从板块取有效股票代码(去重 + 仅保留 .SH/.SZ)。"""
    valid: set[str] = set()
    for sector in sector_names:
        try:
            # get_stock_list_in_sector(block_code, block_type=0, list_type=0) —— 这里按板块名传
            sector_codes = tq.get_stock_list_in_sector(sector)
            if not sector_codes:
                print(f"[{now()}] 警告:板块 {sector} 未取到股票列表")
                continue
            for code in sector_codes:
                if code and isinstance(code, str) and (code.endswith('.SH') or code.endswith('.SZ')):
                    valid.add(code)
                else:
                    print(f"[{now()}] 过滤无效代码:{code}")
        except Exception as e:  # noqa: BLE001
            print(f"[{now()}] 取板块 {sector} 成分股失败:{e}")
    out = sorted(valid)
    print(f"[{now()}] 板块 {sector_names} 有效股票 {len(out)} 只:{out[:10]}...")
    return out


def batch_subscribe(stocks: list[str], batch_size: int) -> bool:
    """分批订阅(避免单次过多 + 触发 100 上限)。"""
    total_ok = True
    for i in range(0, len(stocks), batch_size):
        batch = stocks[i:i + batch_size]
        try:
            print(f"\n[{now()}] 订阅第 {i // batch_size + 1} 批({len(batch)} 只):{batch[:5]}...")
            sub_res = tq.subscribe_hq(stock_list=batch, callback=price_rise_callback)
            if not sub_res:
                print(f"[{now()}] 第 {i // batch_size + 1} 批订阅失败:{sub_res}")
                total_ok = False
            else:
                print(f"[{now()}] 第 {i // batch_size + 1} 批订阅成功")
        except Exception as e:  # noqa: BLE001
            # 累计 > 100 会在此抛 ValueError("订阅数大于100")
            print(f"[{now()}] 第 {i // batch_size + 1} 批订阅异常:{e}")
            total_ok = False
    return total_ok


def unsubscribe_single_stock(stock_code: str) -> bool:
    """取消单只订阅(首次触发后不再监控)。"""
    try:
        ok = tq.unsubscribe_hq(stock_list=[stock_code])
        if ok and stock_code in SUBSCRIBE_CODES:
            SUBSCRIBE_CODES.remove(stock_code)
        return bool(ok)
    except Exception as e:  # noqa: BLE001
        print(f"[{now()}] 取消 {stock_code} 订阅失败:{e}")
        return False


# ===================== 核心回调 =====================
def price_rise_callback(data_str: str):  # noqa: ANN201
    """订阅行情回调:涨幅突破阈值则(干跑打印 / 实推预警),并取消该股订阅。"""
    global _seen_first_tick
    try:
        code_json = json.loads(data_str)
        code = code_json.get('Code')

        # 前置过滤:错误帧 / 非监控票 / 已触发的票
        if code_json.get('ErrorId') != "0" or not code:
            return
        if code not in SUBSCRIBE_CODES or code in TRIGGERED_STOCKS:
            return

        # 首次回调打印一次原始载荷,看推送帧结构
        if not _seen_first_tick:
            _seen_first_tick = True
            print(f"\n[{now()}] [首次回调样本] {data_str[:300]}")

        # 取最新行情(get_full_tick 不存在 → get_market_snapshot)
        snap = tq.get_market_snapshot(stock_code=code, field_list=[])
        if not snap:
            return
        latest_price = round(float(snap.get('Now', 0) or 0), 2)
        pre_close = round(float(snap.get('LastClose', 0) or 0), 2)
        if pre_close <= 0 and latest_price > 0:
            pre_close = round(latest_price - 0.01, 2)
        if latest_price <= 0 or pre_close <= 0:
            return

        rise_rate = round(((latest_price - pre_close) / pre_close) * 100, 2)

        if rise_rate > PRICE_RISE_THRESHOLD:
            current_time = int(time.time())
            if current_time - last_warn_time[code] < ANTI_SHAKE_SECONDS:
                return

            TRIGGERED_STOCKS.add(code)
            last_warn_time[code] = current_time
            unsubscribe_single_stock(code)

            volume = snap.get('Volume', '0') or '0'
            reason = "涨幅突破"
            print(f"[{now()}] {code} 涨幅 {rise_rate}% > {PRICE_RISE_THRESHOLD}% —— {reason}")

            if DRY_RUN:
                print(f"[{now()}] [DRY_RUN] 预警载荷 code={code} price={latest_price} "
                      f"pre_close={pre_close} vol={volume} time={datetime.now().strftime('%Y%m%d%H%M%S')}")
            else:
                try:
                    warn_res = tq.send_warn(
                        stock_list=[code],
                        time_list=[datetime.now().strftime('%Y%m%d%H%M%S')],
                        price_list=[str(latest_price)],
                        close_list=[str(pre_close)],
                        volum_list=[str(volume)],
                        bs_flag_list=['0'],
                        warn_type_list=['3'],
                        reason_list=[reason],
                        count=1,
                    )
                    print(f"[{now()}] 预警发送结果:{warn_res}")
                except Exception as e:  # noqa: BLE001
                    print(f"[{now()}] {code} 发送预警失败:{e}")
            print(f"[{now()}] 已取消 {code} 订阅,后续不再监控")
    except Exception as e:  # noqa: BLE001
        print(f"[{now()}] 回调异常:{e}")


# ===================== 订阅 / 取消订阅 =====================
def subscribe_stocks() -> bool:
    if not SUBSCRIBE_CODES:
        print(f"\n[{now()}] 无有效股票可订阅,跳过")
        return False
    print(f"\n[{now()}] 开始批量订阅({len(SUBSCRIBE_CODES)} 只)")
    return batch_subscribe(SUBSCRIBE_CODES, BATCH_SUBSCRIBE_SIZE)


def unsubscribe_stocks() -> bool:
    if not SUBSCRIBE_CODES:
        print(f"\n[{now()}] 无已订阅股票,跳过取消")
        return False
    print(f"\n[{now()}] 批量取消订阅({len(SUBSCRIBE_CODES)} 只)")
    total_ok = True
    for i in range(0, len(SUBSCRIBE_CODES), BATCH_SUBSCRIBE_SIZE):
        batch = SUBSCRIBE_CODES[i:i + BATCH_SUBSCRIBE_SIZE]
        try:
            print(f"[{now()}] 取消第 {i // BATCH_SUBSCRIBE_SIZE + 1} 批:{batch[:5]}...")
            if not tq.unsubscribe_hq(stock_list=batch):
                print(f"[{now()}] 第 {i // BATCH_SUBSCRIBE_SIZE + 1} 批取消失败")
                total_ok = False
        except Exception as e:  # noqa: BLE001
            print(f"[{now()}] 第 {i // BATCH_SUBSCRIBE_SIZE + 1} 批取消异常:{e}")
            total_ok = False
    return total_ok


# ===================== 主程序 =====================
def main() -> int:
    signal.signal(signal.SIGINT, signal_handler)

    banner("initialize")
    try:
        tq.initialize(__file__)
        print(f"[{now()}] TDX 初始化成功")
    except Exception as e:  # noqa: BLE001
        print(f"TDX 初始化失败:{e}")
        return 1

    banner(f"取板块成分股 {SECTOR_NAMES}")
    global SUBSCRIBE_CODES
    SUBSCRIBE_CODES = get_valid_stock_codes(SECTOR_NAMES)
    if not SUBSCRIBE_CODES:
        print("未获取到任何有效股票,程序退出")
        return 1
    if len(SUBSCRIBE_CODES) > MAX_SUBSCRIBE:
        print(f"[{now()}] 成分股 {len(SUBSCRIBE_CODES)} 只 > 上限 {MAX_SUBSCRIBE},"
              f"切片监控前 {MAX_SUBSCRIBE} 只(其余 subscribe_hq 会抛 ValueError)")
        SUBSCRIBE_CODES = SUBSCRIBE_CODES[:MAX_SUBSCRIBE]

    banner(f"订阅 {len(SUBSCRIBE_CODES)} 只(DRY_RUN={DRY_RUN})")
    subscribe_stocks()

    print(f"\n=== 涨幅监控启动 ===")
    print(f"板块:{SECTOR_NAMES} | 监控:{len(SUBSCRIBE_CODES)} 只 | 阈值:>{PRICE_RISE_THRESHOLD}%")
    print(f"防抖:{ANTI_SHAKE_SECONDS}s | 分批:{BATCH_SUBSCRIBE_SIZE} 只/批 | DRY_RUN:{DRY_RUN}")
    print("按 Ctrl+C 退出程序...\n")

    try:
        while not EXIT_FLAG:
            time.sleep(0.1)
    except Exception as e:  # noqa: BLE001
        print(f"主循环异常:{e}")
    finally:
        try:
            unsubscribe_stocks()
        except Exception as e:  # noqa: BLE001
            print(f"清理取消订阅失败:{e}")
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass
        print(f"[{now()}] 资源清理完成,程序退出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
