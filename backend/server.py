"""Small local HTTP API. No broker credentials or real-money order endpoint."""

from __future__ import annotations

import json
import os
from threading import Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .data import DEMO_PORTFOLIO, LIVE_PORTFOLIO, POLICY, demo_assets, live_assets
from .engine import build_dashboard

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PAPER_ORDERS: list[dict] = []
PAPER_LOCK = Lock()


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, value: dict | list) -> None:
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/api/dashboard":
            mode = parse_qs(parsed.query).get("mode", ["demo"])[0]
            try:
                if mode == "demo":
                    result = build_dashboard(demo_assets(), DEMO_PORTFOLIO, POLICY)
                elif mode == "live":
                    result = build_dashboard(live_assets(), LIVE_PORTFOLIO, POLICY)
                else:
                    return self._json(400, {"error": "无效的数据模式。"})
                with PAPER_LOCK:
                    result["paper_orders"] = PAPER_ORDERS.copy()
                return self._json(200, result)
            except (RuntimeError, ValueError, KeyError, OSError) as exc:
                return self._json(503, {"error": str(exc)})
        if parsed.path == "/api/health":
            return self._json(200, {"ok": True})
        path = (DIST / parsed.path.lstrip("/")).resolve()
        if parsed.path == "/" or not path.is_file():
            path = DIST / "index.html"
        if not path.is_relative_to(DIST) or not path.is_file():
            return self.send_error(404)
        mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}.get(path.suffix, "application/octet-stream")
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path != "/api/paper/orders":
            return self._json(404, {"error": "未知接口。"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4096:
                return self._json(400, {"error": "请求大小无效。"})
            body = json.loads(self.rfile.read(length))
            mode, symbol, qty = body.get("mode"), body.get("symbol"), body.get("quantity")
            if mode not in ("demo", "live") or type(qty) is not int or qty < 1:
                return self._json(400, {"error": "订单参数无效。"})
            board = build_dashboard(demo_assets() if mode == "demo" else live_assets(),
                                    DEMO_PORTFOLIO if mode == "demo" else LIVE_PORTFOLIO, POLICY)
            candidate = next((a for a in board["analyses"] if a["symbol"] == symbol), None)
            if not candidate or candidate["action"] not in ("REVIEW_BUY", "REVIEW_SELL"):
                return self._json(409, {"error": "当前没有可加入模拟计划的买卖候选。"})
            side = "BUY" if candidate["action"] == "REVIEW_BUY" else "SELL"
            with PAPER_LOCK:
                planned = sum(o["quantity"] for o in PAPER_ORDERS if o["mode"] == mode and o["symbol"] == symbol and o["side"] == side)
                allowed = candidate["suggested_max_shares"] if side == "BUY" else int(candidate["position_shares"])
                if qty + planned > allowed:
                    return self._json(409, {"error": "当前规则不允许该数量进入模拟计划，请刷新研究结果。"})
                order = {"id": len(PAPER_ORDERS) + 1, "mode": mode, "symbol": symbol,
                         "side": side, "quantity": qty, "reference_price": candidate["market"]["price"],
                         "status": "PLANNED", "execution_checks": ["人工核验资讯原文与账户目标", "交易前刷新行情及仓位约束", "确认市场交易时段与限价", "检查费用与滑点"],
                         "note": "仅为纸面计划；参考价不是限价、未提交券商，也未假设成交。"}
                PAPER_ORDERS.append(order)
            return self._json(201, order)
        except (ValueError, TypeError, KeyError, RuntimeError, OSError) as exc:
            return self._json(400, {"error": str(exc)})


def main() -> None:
    port = int(os.environ.get("TRADEBOT_PORT", "8765"))
    print(f"TradeBo API listening at http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
