"""01实盘监控 — 飞书推送 + 频控

复用竞价监控的 urllib POST 实现(标准库, 无新依赖)。
webhook 在 config.CONFIG.feishu_webhook, None 则跳过。

频控(Deduper): key=(code, type), N 秒内同 key 跳过;
              LABELS[type].dedup=False 的类型(封板/炸板)豁免去重。
批量推送: critical(炸板) 立即单推, 其余合并一条(避免轰炸)。
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from loguru import logger

from config import LABELS, label_cn


def _fmt_ts(ts) -> str:
    if isinstance(ts, str):
        return ts
    try:
        return ts.strftime("%H:%M:%S")
    except AttributeError:
        return str(ts)


def _format_event(ev: dict) -> str:
    """单条异动 → 飞书一行文本"""
    lab = LABELS.get(ev["type"])
    emoji = lab.emoji if lab else ""
    name = ev.get("name") or ""
    return (f"{emoji}[{label_cn(ev['type'])}] {ev['code']} {name} "
            f"{_fmt_ts(ev.get('ts'))} 现价{ev['price']:.2f} ({ev['pct']:+.2f}%) {ev.get('detail', '')}")


def _build_text(events: list[dict], title: str) -> str:
    lines = [f"【{title}】{time.strftime('%H:%M:%S')} 共 {len(events)} 条"]
    for ev in events:
        lines.append(_format_event(ev))
    return "\n".join(lines)


def push_feishu(events: list[dict], webhook_url: str | None,
                title: str = "实盘异动", max_retry: int = 3) -> bool:
    """推送事件列表到飞书。True=成功; False=跳过/失败。"""
    if not webhook_url:
        logger.info("未配置飞书 webhook, 跳过推送(本地终端/parquet 已留存)")
        return False
    if not events:
        return False

    text = _build_text(events, title)
    payload = {"msg_type": "text", "content": {"text": text}}

    for attempt in range(1, max_retry + 1):
        try:
            req = urllib.request.Request(
                webhook_url,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            if result.get("StatusCode") == 0 or result.get("code") == 0:
                logger.success(f"飞书推送成功({len(events)} 条) {title}")
                return True
            logger.warning(f"飞书返回非0: {result}")
        except (urllib.error.URLError, TimeoutError) as e:
            logger.warning(f"飞书推送第{attempt}/{max_retry}次失败: {e}")
            time.sleep(1.0)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"飞书推送异常第{attempt}/{max_retry}: {e}")
            time.sleep(1.0)
    logger.error(f"飞书推送 {max_retry} 次均失败")
    return False


class Deduper:
    """同股同类型 N 秒去重; LABELS[type].dedup=False 的类型豁免。"""

    def __init__(self, window: int):
        self.window = window
        self._last: dict[tuple, float] = {}

    def should_push(self, ev: dict, now_ts: float | None = None) -> bool:
        now_ts = time.time() if now_ts is None else now_ts
        lab = LABELS.get(ev["type"])
        if lab and not lab.dedup:
            return True  # 封板/炸板 豁免去重
        key = (ev["code"], ev["type"])
        last = self._last.get(key)
        if last is not None and (now_ts - last) < self.window:
            return False
        self._last[key] = now_ts
        return True

    def reset(self) -> None:
        self._last.clear()


def batch_push(events: list[dict], webhook_url: str | None, deduper: Deduper,
               title: str = "实盘异动") -> tuple[bool, int, int]:
    """按频控过滤后推送: critical 立即推, 其余合并。

    Returns: (是否至少推送成功一次, 实际推送条数, 被去重条数)
    """
    now_ts = time.time()
    to_push = [ev for ev in events if deduper.should_push(ev, now_ts)]
    deduped = len(events) - len(to_push)
    if deduped:
        logger.info(f"频控去重 {deduped} 条(同股同类型{deduper.window}s 内)")

    critical = [ev for ev in to_push if ev["severity"] == "critical"]
    normal = [ev for ev in to_push if ev["severity"] != "critical"]

    ok = False
    if critical:
        ok = push_feishu(critical, webhook_url, title=f"{title}·紧急") or ok
    if normal:
        ok = push_feishu(normal, webhook_url, title=title) or ok
    return ok, len(to_push), deduped
