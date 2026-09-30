# TradeBo · 证据驱动的美股研究台

TradeBo 是一个用于 GitHub 展示的可运行原型。它把**日线行情、资讯相关性、买卖条件、仓位预算和组合规划**放在同一条可追溯的决策链上。系统只生成“买入复核 / 卖出复核 / 保持观望”三类研究结果；模拟计划不会向券商提交订单，也不假设成交。

![TradeBo dashboard](docs/dashboard.jpg)

## 运行

需要 Python 3.10+、Node.js 22.12+（或 20.19+）。无需数据库。

```bash
npm install
python3 -m backend.server
```

另开终端：

```bash
npm run dev
```

浏览器打开 Vite 输出的本地地址（通常为 `http://127.0.0.1:5173`）。默认数据为**完全合成**的美股风格示例，公司、价格和资讯均不代表真实市场。生产式静态启动可运行 `npm run build`，然后打开 `http://127.0.0.1:8765`。

## 接入真实美股数据

服务端设置环境变量后，点击页面的“真实数据”。API 密钥不会进入前端代码或 Git：

```bash
export ALPHA_VANTAGE_API_KEY="your_key_here"
export TRADEBOT_SYMBOLS="AAPL,MSFT,NVDA"
python3 -m backend.server
```

`TRADEBOT_SYMBOLS` 最多取前三个 1–5 位字母的代码，使用 [Alpha Vantage Symbol Search](https://www.alphavantage.co/documentation/) 核验 `United States / Equity` 后才加载。日线和资讯也来自 Alpha Vantage；其免费请求额度和接口权限可能变化，请查看[官方额度说明](https://www.alphavantage.co/support/)。每个标的首次加载最多用 3 次请求；标的核验缓存 24 小时，日线缓存 6 小时，资讯缓存 1 小时。额度不足、接口报错、价格过期、资讯不足都会产生可见提示或观望结论，不会回退成伪装的真实数据。真实数据模式仍使用**示例的 10 万美元空仓组合**，用户应在加入实际持仓输入前把它视作假设。

## 决策规则

| 层级 | 买入复核条件 | 未满足时 |
| --- | --- | --- |
| 数据 | 最近日线不超过 5 天，至少 50 个收盘价 | 观望 / 数据错误 |
| 趋势 | 收盘价 > 20 日均线 > 50 日均线 | 观望 |
| 资讯 | 72 小时内明确标记该股票代码；至少两个不同来源、两条正向标签、没有负向标签 | 观望 |
| 风险 | 有可买入股数；单标的 ≤ 12% NAV，现金 ≥ 20% NAV，计划风险 ≤ 1% NAV | 观望 |

卖出复核只针对已有持仓：收盘价跌破 20 日均线且 20 日均线低于 50 日均线，或该持仓超过 12% NAV。数据过期时，买卖候选都被阻断。买卖候选均需人工读原文和确认实际账户条件。`planning_stop_pct=8%` 仅用于计算计划股数；止损触发价不保证成交价，[FINRA 对止损单的说明](https://www.finra.org/investors/insights/stop-orders-factors-consider-during-volatile-markets)解释了跳空与成交价风险。

资讯的“正向/负向”是提供方的标签，不是事实核验或独立预测。相关性评分只检查明确的股票代码标签、72 小时时间窗和重复 URL；缺少公司代码标签的文章不会被推断为相关。两家来源只构成初步交叉检查，**不代表来源独立性已得到充分验证**。

## 项目结构

```text
backend/engine.py   可复现的相关性、趋势、仓位与决策规则
backend/data.py     合成样例与可选 Alpha Vantage 适配器
backend/server.py   本地 JSON API、静态文件与纸面计划
src/                React + TypeScript 展示界面
tests/              关键阻断条件测试
```

运行测试：

```bash
python3 -m unittest discover -s tests -v
npm run build
```

## 安全边界与下一步

- 当前仅研究美股股票；无券商连接、真实下单、收益承诺、回测或自动再平衡。
- 模拟计划只保存在服务内存中，服务重启即消失，且没有模拟成交引擎。
- 当前真实接口使用未复权日线；拆股/派息跨越均线窗口时，需要改接复权数据并加入公司行动校验后才可用于严肃评估。
- 下一阶段应加入可编辑账户目标与持仓、数据许可与来源审计、时间点回测（含交易费用和滑点）、事件去重、券商模拟账户适配，并对资讯模型做误报评估。
- 资产配置应依据个人目标、投资期限与风险承受能力设定。[FINRA 的投资者材料](https://www.finra.org/investors/insights/know-your-risk-tolerance)提供了这些维度的说明。

这不是个性化投资建议。任何实盘决策都应核验数据和个人适配性。
