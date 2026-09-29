# 美术私教 iPad App（PencilKit + Express）

批改「过程」而不只是结果的素描私教：iPad 端用 PencilKit 采集每一笔的
压感 / 角度 / 时序，服务端规则层算确定性指标，视觉模型只负责定性批语；
未配置 LLM 时自动降级为纯规则批改（`degraded: true`），App 功能完整可用。

实现依据：[`iPad美术私教App-PencilKit-实现提示词.md`](./iPad美术私教App-PencilKit-实现提示词.md)

## 架构

```
┌─ iPad (SwiftUI + PencilKit) ─────────────┐
│ PKCanvasView → 笔迹采集(t/x/y/f/az/al)    │
│   停笔3s debounce → SHA256 去重 → 20s 节流 │
│   PNG(≤2048) + strokes.json + color.json  │
│        │ multipart POST                   │
│        ▼                                  │
│ Express 5 + TS (端口 4292)                │
│   multer → strokeAnalyzer(规则指标)       │
│          → colorAnalyzer(色彩统计)        │
│          → VL 模型(仅定性批语, 可降级)     │
│          → critique(50/50 融合+证据校验)   │
│   JSON store(原子写) + InkML 导出         │
└───────────────────────────────────────────┘
```

## 快速开始

### 1. 起服务端

```bash
cd server
npm install --legacy-peer-deps   # zod4 + openai5 peer 冲突，必须带此参数
cp .env.example .env             # 按需修改；LLM key 默认从 ~/.pi/agent/models.json 读取
npm run dev
# 启动日志会打印局域网地址，如 http://192.168.1.23:4292
```

- 未配置 LLM key 时自动进入降级模式（纯规则批改，响应 `degraded: true`）
- 强制降级：`PENCIL_NO_LLM=1 npm run dev`

### 2. 跑测试

```bash
cd server && npm test            # 14 个用例（stroke/color/critique）
npx tsc --noEmit                 # 类型检查
```

### 3. iPad 端

1. 用 Xcode 打开 `ArtCoach.xcodeproj`（iPadOS 17+，仅 iPad）
2. 把 `ArtCoach/Config.swift` 里的 `baseURL` 改成上一步启动日志打印的局域网地址
3. 真机运行（PencilKit 压感需要 Apple Pencil；模拟器可画但无压感数据）

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/critic/review` | multipart：`image`(png) + `strokes?`(json) + `colorStats?`(json) + `meta`(json) |
| GET | `/api/critic/history?limit&cursor` | 分页历史 |
| GET | `/api/critic/review/:id` | 批改详情 |
| GET | `/api/critic/review/:id/inkml` | 笔迹 InkML 导出 |
| GET | `/api/critic/assignment/:id` / `/assignments` | 任务详情 / 列表 |
| GET | `/assets/*`、`/api/health` | 静态资源 / 健康检查 |

### curl 示例

```bash
# 上传批改（strokes/colorStats 可选，缺了服务端会用图片兜底）
curl -s http://localhost:4292/api/critic/review \
  -F "image=@drawing.png" \
  -F "strokes=@strokes.json;type=application/json" \
  -F "colorStats=@color.json;type=application/json" \
  -F 'meta={"appVersion":"0.1.0","deviceModel":"iPad14,3","systemVersion":"17.0","canvasSize":{"width":1024,"height":768},"scale":2,"durationSec":600,"startedAt":"2025-01-01T10:00:00Z","finishedAt":"2025-01-01T10:10:00Z"}'

# 历史 / 详情 / InkML / 任务
curl -s 'http://localhost:4292/api/critic/history?limit=5'
curl -s http://localhost:4292/api/critic/review/rv_20250101_1000_ab12cd34
curl -s http://localhost:4292/api/critic/review/rv_20250101_1000_ab12cd34/inkml
curl -s http://localhost:4292/api/critic/assignments
```

## 过程指标（规则层，确定性计算）

| 指标 | 含义 |
|---|---|
| `strokeCount` / `avgForce` | 笔数 / 平均压感 |
| `forceContrast` | 暗区 vs 亮区压感差（明暗对比意识） |
| `hatchAngleStdDeg` | 排线角度方差（交叉双倍角加权圆标准差） |
| `reworkRegions` | 8×8 网格涂改热区数（≥4 笔 + 短笔 + 弱压） |
| `earlyDetailRatio` | 前 30% 时间里小笔画占比（是否过早抠细节） |
| `rhythmPauses` | >8 秒停顿次数（卡壳/观察节奏） |
| `completion` | 画面覆盖率（非白像素比例） |
| 色彩 | 色相 12 桶 / 暖冷比 / 近灰比 / 主色 Top3（3bit 量化） |

色彩口径（iOS 与服务端必须一致）：64×64 采样、跳过纸面白 `v>0.92 && s<0.10`、
色相桶仅计 `s≥0.15`、暖色 `h≥0.917||h≤0.25`、近灰 `s<0.10`、比率分母为非白像素。

## 目录结构

```
pencil/
├── ArtCoach.xcodeproj/        # 手写工程（iPadOS 17, iPad only）
├── ArtCoach/
│   ├── ArtCoachApp.swift / ContentView.swift   # 入口 + TabView(练习/档案)
│   ├── Config.swift           # 后端地址
│   ├── Canvas/                # PKCanvasView 桥/工具栏/导出/笔迹采集/色彩量化/防抖
│   ├── Net/                   # APIClient(actor) / multipart / 模型 / 端点
│   ├── State/                 # ReviewStore(@MainActor @Observable 状态中枢)
│   └── UI/                    # 批语面板 / 历史列表 / 薄弱点图 / 临摹底图
├── server/                    # Express 5 + TS 后端（详见 server/README 见本文件 API 节）
└── iPad美术私教App-PencilKit-实现提示词.md   # 实现提示词（spec）
```

## 硬约束回顾

- 中文硬编码，无 i18n
- 未配 LLM 必须可降级（纯规则），App 全功能可用
- VL 模型只写定性批语，不产生数值；数值全部来自规则层
- iOS 重活（PNG 导出/色彩统计/SHA256）全部后台队列，主线程只碰 UI
- 图片上传长边 ≤ 2048
