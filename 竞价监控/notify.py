"""竞价监控雷达 v2 — 飞书推送

真实推送(标准库 urllib,无新依赖)。
webhook 在 config.CONFIG.feishu_webhook 配置,None 则跳过。

飞书自定义机器人:msg_type=text。若机器人开了"加签",需补签名(见 TODO)。
"""
from __future__ import annotations

import json
import time
import urllib.request
import urllib.error

from loguru import logger


def _build_text(rows: list[dict], title: str) -> str:
    """rows 每项含 code/label_cn/aux_cn/reason。构造飞书文本"""
    lines = [f"【{title}】{time.strftime('%H:%M')} 共 {len(rows)} 只"]
    for i, r in enumerate(rows, 1):
        tag = r.get("label_cn", "")
        aux = f"[{r['aux_cn']}]" if r.get("aux_cn") else ""
        lines.append(f"{i}. {r['code']} {tag}{aux} {r.get('reason','')}")
    return "\n".join(lines)


def push_feishu(rows: list[dict], webhook_url: str | None,
                title: str = "竞价监控", max_retry: int = 3) -> bool:
    """推送至飞书机器人。

    Args:
        rows: [{code, label_cn, aux_cn, reason}, ...]
        webhook_url: 飞书机器人 webhook;None 跳过
    Returns: True 成功;False 跳过或失败
    """
    if not webhook_url:
        logger.info("未配置飞书 webhook,跳过推送(本地终端/MD 已输出)")
        return False
    if not rows:
        logger.info("无推送内容")
        return False

    text = _build_text(rows, title)
    payload = {"msg_type": "text", "content": {"text": text}}

    # TODO: 若机器人启用"加签(secret),需在此计算 timestamp+sign 并加入 payload

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
            # 飞书成功:StatusCode=0 或 code=0
            if result.get("StatusCode") == 0 or result.get("code") == 0:
                logger.success(f"飞书推送成功({len(rows)} 只)")
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
