"""Local research API and static server. No broker or live order endpoint exists."""
from __future__ import annotations

import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit

from .data import default_model, demo_assets, live_assets, validate_symbol
from .engine import answer_question, build_dashboard

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PAPER_ORDERS: list[dict] = []
PAPER_LOCK = Lock()


def _assets(mode: str, symbols: list[str] | None = None) -> list[dict]:
    if mode == "demo":
        return demo_assets()
    if mode == "live":
        return live_assets(symbols)
    raise ValueError("Mode must be demo or live.")


def _fingerprint(model: dict) -> str:
    packed = json.dumps(model, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(packed.encode()).hexdigest()[:16]


def _board(mode: str, model: dict | None = None, symbols: list[str] | None = None) -> dict:
    assets = _assets(mode, symbols)
    model = model if model is not None else default_model(assets)
    board = build_dashboard(assets, model)
    fingerprint = _fingerprint(model)
    with PAPER_LOCK:
        board["paper_orders"] = [{**order, "matches_model": order["model_fingerprint"] == fingerprint}
                                  for order in PAPER_ORDERS if order["mode"] == mode]
    board["symbols"] = [asset["symbol"] for asset in assets]
    return board


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, value: dict | list) -> None:
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if not 1 <= length <= 65536:
            raise ValueError("Request body must be between 1 and 65536 bytes.")
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            raise ValueError("Content-Type must be application/json.")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object.")
        return body

    def do_GET(self) -> None:
        path = urlsplit(self.path)
        if path.path == "/api/dashboard":
            try:
                mode = parse_qs(path.query).get("mode", ["demo"])[0]
                return self._json(200, _board(mode))
            except (ValueError, RuntimeError) as exc:
                return self._json(400 if isinstance(exc, ValueError) else 503, {"error": str(exc)})
        if path.path == "/api/health":
            return self._json(200, {"ok": True})
        file = (DIST / path.path.lstrip("/")).resolve()
        if path.path == "/" or not file.is_file():
            file = DIST / "index.html"
        if not file.is_relative_to(DIST) or not file.is_file():
            return self.send_error(404)
        mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".svg": "image/svg+xml"}.get(file.suffix, "application/octet-stream")
        content = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        try:
            body = self._body()
            mode = body.get("mode", "demo")
            symbols = body.get("symbols")
            if symbols is not None and (not isinstance(symbols, list) or len(symbols) > 8
                                        or any(not isinstance(s, str) for s in symbols)):
                raise ValueError("symbols must be a list of up to 8 tickers.")
            if self.path == "/api/dashboard":
                return self._json(200, _board(mode, body.get("model"), symbols))
            if self.path == "/api/ask":
                board = _board(mode, body.get("model"), symbols)
                symbol = validate_symbol(str(body.get("symbol", "")))
                analysis = next((row for row in board["analyses"] if row["symbol"] == symbol), None)
                if analysis is None:
                    raise ValueError("Load the ticker into the research universe first.")
                return self._json(200, answer_question(str(body.get("question", "")), analysis, board["portfolio"]))
            if self.path == "/api/paper/orders":
                board = _board(mode, body.get("model"), symbols)
                symbol = validate_symbol(str(body.get("symbol", "")))
                side = body.get("side")
                quantity = body.get("quantity")
                if side not in ("BUY", "SELL") or type(quantity) is not int or quantity < 1:
                    raise ValueError("A paper order requires BUY or SELL and a positive whole-share quantity.")
                analysis = next((row for row in board["analyses"] if row["symbol"] == symbol), None)
                if analysis is None:
                    raise ValueError("Ticker is not in the loaded universe.")
                expected = "REVIEW_ADD" if side == "BUY" else "REVIEW_REDUCE"
                ceiling = (analysis["suggested_max_add_shares"] if side == "BUY"
                           else analysis["review_reduce_shares"])
                if analysis["action"] != expected:
                    return self._json(409, {"error": "Current research rules do not permit that paper plan."})
                fingerprint = _fingerprint(board["portfolio"]["model"])
                with PAPER_LOCK:
                    planned = sum(order["quantity"] for order in PAPER_ORDERS
                                  if order["model_fingerprint"] == fingerprint and order["mode"] == mode
                                  and order["symbol"] == symbol and order["side"] == side)
                    if quantity + planned > ceiling:
                        return self._json(409, {"error": "Quantity exceeds the remaining paper-review ceiling."})
                    order = {"id": len(PAPER_ORDERS) + 1, "mode": mode, "symbol": symbol,
                             "side": side, "quantity": quantity, "reference_close": analysis["market"]["price"],
                             "price_date": analysis["market"]["as_of"], "status": "DRAFT",
                             "model_fingerprint": fingerprint,
                             "execution_checks": ["Verify source documents and account suitability",
                                                  "Refresh market data and portfolio constraints",
                                                  "Choose an explicit limit price and expiry",
                                                  "Review market session, fees, taxes, and slippage"],
                             "note": "Draft only; no broker submission or assumed fill."}
                    PAPER_ORDERS.append(order)
                return self._json(201, order)
            return self._json(404, {"error": "Unknown API route."})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        except RuntimeError as exc:
            return self._json(503, {"error": str(exc)})


def main() -> None:
    port = int(os.environ.get("TRADEBOT_PORT", "8765"))
    print(f"TradeBo listening at http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
