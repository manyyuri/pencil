# 实现提示词：iPad 美术私教 App（SwiftUI + PencilKit + 笔迹过程数据批改）

> 生成日期：2026-09-26
> 目标工程：`/Users/junyingli/project/AI/pencil`（当前为空目录，全新工程）
> 技术栈：macOS + Xcode 16 / SwiftUI / PencilKit / URLSession；后端复用你现有的 Agent 服务（Node 20 + Express 5 + TypeScript，视觉模型走 OpenAI 兼容网关）

---

## 使用说明（给执行实现的 AI）

1. **先读完本文档再动手**，并且**先定接口契约（第 5 节），再写前端 UI**。前后端可以并行开发，契约是唯一事实来源。
2. **严格分阶段**：阶段 1 → 2 → 3 → 4 顺序推进，每个阶段必须能独立跑通、可演示后再进入下一阶段。**不要在阶段 1 就把笔迹采集、色彩量化全部写完。**
3. **不要处理国际化（i18n）**：全部界面文案直接写中文硬编码，不建 `Localizable.strings`，不做多语言。
4. 新增文件一律放在本文档第 11 节给出的目录结构里；不要发明新的顶层目录。
5. 后端**不要**新起一套框架。复用你现有项目已验证的约定：
   - `config.json` 放端口/模型名等配置；`.env` 放密钥（不入库）；
   - Express 5 + `multer` 处理上传（参考 `your-dance-teacher/server/upload.ts`）；
   - 大模型客户端用 `openai` SDK 指向 OpenAI 兼容网关（参考 `stylist-agent/server/llm.ts` / `vision.ts`），视觉模型传 `data:image/png;base64,...`；
   - **确定性规则 + LLM 混合**：所有数值统计（涂改次数、排线角度方差、色相分布）由普通 TypeScript 代码算，**LLM 只负责看图与写批语，绝不让它算数或编造数据**；
   - 未配置 LLM key 时必须有降级路径（纯规则批语 + 固定模板）。
6. 若某个字段在你手上的 PencilKit 版本里不存在，用 `#available` 做保护并降级，**不要崩溃**。
7. **不要重造已经开源的东西**。第 6~9 节每个阶段末尾都有「开源可复用」小节，明确写了本阶段该借哪个项目的哪段代码。动手前**先看那一节**，再决定是自己写还是移植。
8. **遵守许可**：可复制代码的只有 MIT / Apache-2.0，且必须在 `pencil/THIRD_PARTY.md` 保留 LICENSE 与版权声明；**无 License 的仓库默认「保留所有权利」，只能读思路，不得复制代码**。详见第 15 节。

---

## 1. 项目现状与约束

### 1.1 现状

- `pencil/` 为空，**没有任何现存代码**，因此本文档是唯一需求来源，不存在"需要先读懂的旧工程"。
- 后端能力来自你已有的 Agent 服务范式（本项目新建一个 `server/`，不改造其他项目）。

### 1.2 硬约束

| 约束 | 说明 |
| --- | --- |
| 运行设备 | iPad + Apple Pencil 才能拿到真实 `force` / `altitude` / `azimuth`；模拟器只能测 UI 与 HTTP |
| 后端地址 | 内网 HTTP（树莓派/局域网）→ 必须配 ATS + 本地网络权限（见第 10 节） |
| 主线程 | 图片编码、笔迹序列化、色彩统计**必须在后台队列**，否则画布掉帧 |
| 数据隐私 | 作业图与笔迹只上传到你自己的后端，不上传第三方 |
| 版本 | 以 iPadOS 17+ 为基线，`@available` 兜住新 ink 类型 |

---

## 2. 产品概念

一句话：**把素描的"过程"而不仅是"结果"拿去批改。**

传统 AI 看图批改只能看到成品图，看不出：

- 你是不是**过早抠细节**（大量细小笔画堆在局部，明暗大关系还没铺）；
- 你**反复涂改了多少次**（同一区域反复重画说明造型没吃准）；
- 你的**排线方向是否杂乱**（排线角度方差大 = 手腕不稳/没理解结构）；
- 你**下笔轻重有没有层次**（亮部该轻、暗部该重，`force` 曲线能直接看出来）。

PencilKit 把这些数据全都留在了 `PKDrawing.strokes` 里，本项目就是把它们挖出来，和后端 VL 视觉分析合并成一份批改。

产品闭环：

```
画画 → 停笔 3 秒 → 自动上传【PNG + 笔迹JSON + 色彩统计】
      → Agent 批改（VL 看图造型/明暗 + 规则算过程指标）
      → iPad 展示批语 + 下一节练习任务 → 存进学习档案
```

**不做**：不做自由聊天框、不做社交、不做云端账号体系、不做付费。

---

## 3. 范围与非目标

### 3.1 本期要做

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **阶段 1** | PencilKit 画布 + 工具切换 + 清空 + 导出 PNG + 上传 + 展示批改文本 | iPad/模拟器上画一张，点按钮，下方出现后端返回的中文批语 |
| **阶段 2** | 采集完整笔迹数据（force/时间/坐标/倾角），PNG+JSON 一次上传；后端新增笔迹分析 | 后端日志能打印出「笔数、平均压感、涂改区域数、排线角度方差」 |
| **阶段 3** | 彩色墨水 + 画布像素色彩量化 + 停笔 3 秒自动上传 | 停笔后无需点按钮，自动出批语；请求体里有 colorStats |
| **阶段 4** | 学习档案（历史作业、薄弱点、下一节任务、临摹底图） | 历史列表可点开回看；可把参考图导入为半透明底图临摹 |

### 3.2 明确不做

- 不做 i18n、不做暗色主题适配之外的皮肤系统；
- 不做账号登录、不做云同步、不做多人协作；
- 不在前端做 AI 推理（模型推理全在后端）；
- 不逐笔上传（**只在停笔后聚合上传一次**，避免打爆 VL 模型）；
- 不实现"实时评分"（那是另一个产品）；
- 不让 LLM 生成可执行代码或调用外部网络（后端 Agent 只做分析与出题）。

---

## 4. 总体架构与数据流

```
┌────────────────────────── iPad (SwiftUI) ──────────────────────────┐
│  CanvasView (UIViewRepresentable → PKCanvasView)                   │
│      │ drawingDidChange / didEndUsingTool                          │
│      ▼                                                             │
│  StrokeCollector ──► [StrokePayload]（force/azimuth/altitude/…）    │
│  ImageExporter   ──► PNG (白底、2x)                                 │
│  ColorAnalyzer   ──► ColorStats（色相直方图/冷暖占比/平均饱和度）      │
│      └────────► ReviewScheduler（停笔 debounce 3s）                 │
│                      │ URLSession multipart/form-data              │
│                      ▼                                             │
│  ReviewStore (@Observable) ◄── ReviewResponse JSON                 │
│      ├─ 批语面板（分段展示）                                        │
│      └─ 学习档案（历史/薄弱点/下一课/临摹底图下载）                   │
└────────────────────────────────────────────────────────────────────┘
                             │ HTTP
                             ▼
┌──────────────────── Agent 后端 (Express 5 + TS) ────────────────────┐
│  POST /api/critic/review   (multipart: image + strokes + colorStats)│
│     ├─ 校验 & 落盘（dataDir/workspace/<id>/）                       │
│     ├─ strokeAnalyzer.ts   确定性：涂改/起稿顺序/压感层次/排线方差     │
│     ├─ colorAnalyzer.ts    确定性：色相/饱和度/冷暖（前端也算一份互证）│
│     ├─ vision.ts           VL 模型看图：造型比例/明暗关系/透视/完成度  │
│     └─ critique.ts         合并 + 出批语 + 生成下一节练习任务         │
│  GET  /api/critic/history           历史作业列表                    │
│  GET  /api/critic/review/:id        单次批改详情                    │
│  GET  /api/critic/assignment/:id    下一课任务 + 参考图 URL         │
│  GET  /assets/<file>                静图/参考图静态服务             │
└────────────────────────────────────────────────────────────────────┘
```

**关键设计原则**：所有"可被算出来的东西"都在确定性代码里算，VL 只输出它擅长的主观评价（造型、明暗、结构）。这样即使视觉模型不稳定，批改也永远有个可信骨架。

---

## 5. 接口契约（先定死，前后端并行）

> 所有接口前缀 `/api`，返回统一 JSON，`Content-Type: application/json; charset=utf-8`。

### 5.1 上传批改请求

`POST /api/critic/review`
`Content-Type: multipart/form-data`

| part | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `image` | file (image/png) | ✅ | 白底画布截图，长边 ≤ 2048px |
| `strokes` | file (application/json) | 阶段2起 | 笔迹 JSON（见 5.4），阶段1允许缺省 |
| `colorStats` | file (application/json) | 阶段3起 | 色彩统计（见 5.5），可缺省 |
| `meta` | text (JSON 字符串) | ✅ | 见下 |

`meta` 字段：

```jsonc
{
  "appVersion": "0.1.0",
  "deviceModel": "iPad14,3",
  "systemVersion": "17.5",
  "canvasSize": { "width": 1024, "height": 768 },   // 点，非像素
  "scale": 2,
  "taskId": "still-life-apple-01",                  // 当前练习任务，可为 null
  "durationSec": 1834,                               // 本次作画总时长
  "startedAt": "2026-09-26T10:00:00Z",
  "finishedAt": "2026-09-26T10:30:34Z"
}
```

### 5.2 上传响应

```jsonc
{
  "ok": true,
  "reviewId": "rv_20260926_1031_a1b2",
  "createdAt": "2026-09-26T10:31:02Z",
  "summary": "整体造型比例已经站住，明暗大关系偏灰，暗部压得还不够。",
  "scores": {
    "shape": 78,        // 造型/比例
    "value": 62,        // 明暗层次
    "line": 71,         // 排线
    "completeness": 80  // 完成度
  },
  "sections": [
    {
      "key": "shape",
      "title": "造型与比例",
      "verdict": "good",
      "comment": "苹果的宽高比接近正确，明暗交界线位置基本合理。",
      "evidence": ["VL:wide-ratio-ok"]        // 证据 tag，便于前端溯源
    },
    {
      "key": "value",
      "title": "明暗层次",
      "verdict": "needs-work",
      "comment": "亮部平均压感 0.41、暗部 0.47，差距太小，画面整体发灰。",
      "evidence": ["stroke:force-contrast-low", "vl:value-compressed"]
    }
  ],
  "metrics": {                                 // 确定性指标，原样回给前端做图表
    "strokeCount": 214,
    "avgForce": 0.44,
    "forceContrast": 0.06,
    "hatchAngleStdDeg": 34.2,
    "reworkRegions": 5,
    "earlyDetailRatio": 0.61,
    "hueBuckets": [ /* 12 个桶计数 */ ],
    "warmCoolRatio": 0.72,
    "avgSaturation": 0.31
  },
  "weaknesses": ["明暗对比不足", "过早抠细节"],
  "nextAssignment": {
    "id": "value-bar-02",
    "title": "单球体明暗：只用三根铅笔排线，先铺大调子",
    "goal": "把亮部与暗部的压感差拉到 0.25 以上",
    "durationMin": 25,
    "referenceImageUrl": "http://192.168.1.23:4292/assets/ref/value-bar-02.png"
  },
  "degraded": false    // true = 未配 LLM，仅规则批语
}
```

### 5.3 档案类接口

```
GET /api/critic/history?limit=20&cursor=<reviewId>
→ { "ok": true, "items": [ { reviewId, createdAt, summary, scores, thumbUrl } ], "nextCursor": "..." }

GET /api/critic/review/:id
→ 返回与 5.2 相同结构 + { "imageUrl": "http://.../assets/works/<id>.png" }

GET /api/critic/assignment/:id
→ { "ok": true, "id", "title", "goal", "steps": ["..."], "durationMin", "referenceImageUrl" }
```

### 5.4 笔迹 JSON（`strokes` part）

```jsonc
{
  "version": 1,
  "canvas": { "width": 1024, "height": 768, "scale": 2 },
  "strokes": [
    {
      "i": 0,                                  // 绘制顺序（起点）
      "ink": "pen",                            // pen | pencil | marker | monoline | other
      "color": "#1A1A1A",
      "bbox": [120.5, 88.0, 260.3, 240.9],     // x,y,w,h（点）
      "startMs": 0,                            // 相对本次作画开始
      "endMs": 420,
      "pts": [
        {
          "t": 0.000,                          // 相对本笔起笔，秒
          "x": 120.5, "y": 88.0,               // 绝对点坐标
          "nx": 0.1177, "ny": 0.1146,          // 归一化坐标（/canvas 宽高）
          "f": 0.32,                           // force 0..1
          "az": 1.5708,                        // azimuth 弧度（笔杆方位）
          "al": 1.0472,                        // altitude 弧度（笔杆与屏夹角）
          "w": 3.5,                            // 笔尖宽度
          "o": 1.0                             // opacity
        }
      ]
    }
  ]
}
```

> **格式对齐**：字段语义应对齐 **W3C InkML** 标准（`trace` 上的 `t / x / y / force / azimuth / altitude` 通道）。同时实现一个 `toInkML()` 导出函数（开发期调试用即可）。理由：将来接标注工具、训练笔迹模型、或换客户端时零迁移成本。转换逻辑可参考 npm 包 `neo-inkml`。

### 5.5 色彩统计（`colorStats` part）

```jsonc
{
  "version": 1,
  "sampleSize": 64,                 // 采样分辨率 N×N
  "hueBuckets": [3,0,0,0,0,0,0,0,0,1,0,0],   // 12 个 30° 色相桶
  "avgSaturation": 0.31,
  "avgValue": 0.58,
  "warmRatio": 0.72,                // 暖色像素占比（hue 在 [-30°,90°] 区间）
  "neutralRatio": 0.18,             // 近灰像素（S<0.1）占比
  "dominantColors": [
    { "hex": "#C24B3A", "ratio": 0.44 },
    { "hex": "#2E4A7D", "ratio": 0.21 }
  ]
}
```

---

## 6. 阶段 1：最小可运行 Demo（最短链路）

**目标**：只上传成品 PNG，先跑通「iPad 画布 ↔ Agent 后端」，验证批改效果。**本阶段不采集笔迹。**

### 6.1 后端（先做，因为前端要打接口）

```
server/
├── index.ts        # Express 5 启动、静态资源、路由挂载
├── config.ts       # 读 config.json（port / dataDir / models）
├── env.ts          # 极简 .env 加载（LLM_API_KEY）
├── store.ts        # 原子写 JSON（tmp + rename），dataDir 下的作业读写
├── upload.ts       # multer 内存/磁盘上传，字段 image/meta
├── vision.ts       # VL 看图（data:image/png;base64），zod 校验输出
├── critique.ts     # 组装批语（阶段1：只用 VL 结果 + 完成度规则）
└── review.ts       # 路由：POST /api/critic/review、GET history/review/:id
```

`config.json`：

```json
{
  "port": 4292,
  "dataDir": "~/art-coach-data",
  "llm": {
    "baseUrl": "https://opencode.ai/zen/go/v1",
    "api": "openai-compatible",
    "textModel": "deepseek-v4-flash",
    "visionModel": "deepseek-v4-flash-vision-exp"
  }
}
```

`vision.ts` 要点（对齐 `stylist-agent/server/vision.ts` 的写法）：

```ts
// 1) 用 openai SDK 指向 config.llm.baseUrl，apiKey 取 env.LLM_API_KEY（或 ~/.pi/agent/models.json 的 opencode-luna）
// 2) 图片以 data URL 传入：{ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }
// 3) 用 zod 定义输出 schema，chatJSON 后校验；失败重试 1 次，再失败就抛错走降级
// 4) system prompt 明确：只做造型/比例/明暗/透视/完成度的主观评价，
//    不得编造线条数量、时间、颜色数值（那些由规则层给）
```

VL system prompt 草案（中文输出）：

```
你是一位素描老师。你会收到一张学生的素描作品。
请只评价你能从图像上看到的：整体造型与比例、明暗大关系、结构/透视、画面完成度。
不要猜测学生的绘画过程，不要编造任何数值。
输出严格 JSON：{ "shape": 0-100, "value": 0-100, "line": 0-100,
"completeness": 0-100, "summary": "...", "sections": [{key,title,verdict,comment}] }
verdict ∈ good | ok | needs-work。
```

### 6.2 前端

```
pencil/
├── ArtCoach.xcodeproj
├── ArtCoach/
│   ├── ArtCoachApp.swift              # @main
│   ├── ContentView.swift              # 主界面：画布 + 工具栏 + 批语面板
│   ├── Canvas/
│   │   ├── CanvasView.swift           # UIViewRepresentable 包 PKCanvasView
│   │   ├── CanvasToolbar.swift        # 铅笔/橡皮/清空/上传 SwiftUI 工具条
│   │   └── ImageExporter.swift        # PKDrawing → 白底 PNG
│   ├── Net/
│   │   ├── APIClient.swift            # URLSession + multipart（actor）
│   │   ├── Endpoints.swift            # baseURL 从 Config 读
│   │   └── Models.swift               # Codable：ReviewResponse / Meta / ...
│   ├── State/
│   │   └── ReviewStore.swift          # @Observable，持有 drawing/批语/加载态
│   ├── UI/
│   │   └── CritiquePanel.swift        # 批语分段卡片
│   ├── Config.swift                   # #if DEBUG baseURL 内网地址
│   └── Info.plist                     # ATS + 本地网络权限
└── .gitignore
```

`CanvasView`（SwiftUI ↔ PencilKit 桥）：

```swift
import SwiftUI
import PencilKit

struct CanvasView: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    var tool: PKTool
    var isEditable: Bool = true

    func makeUIView(context: Context) -> PKCanvasView {
        let v = PKCanvasView()
        v.drawingPolicy = .anyInput          // 手指也能画（调试用）；真机建议 .pencilOnly
        v.tool = tool
        v.backgroundColor = .white           // 阶段1直接白底，省掉合成
        v.isOpaque = true
        v.delegate = context.coordinator
        return v
    }

    func updateUIView(_ v: PKCanvasView, context: Context) {
        context.coordinator.parent = self
        if v.tool != tool { v.tool = tool }
        v.isUserInteractionEnabled = isEditable
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: CanvasView
        init(_ p: CanvasView) { parent = p }
        // 阶段2/3 在这里接笔迹采集与 debounce（见第 7、8 节）
    }
}
```

`ImageExporter`（白底 + 限制长边）：

```swift
import UIKit
import PencilKit

enum ImageExporter {
    /// 画布导出为白底 PNG；长边限制 maxEdge 像素（默认 2048），避免上传过大
    static func png(from drawing: PKDrawing, canvasSize: CGSize, scale: CGFloat = 2, maxEdge: CGFloat = 2048) -> Data? {
        let bounds = drawing.bounds.isEmpty
            ? CGRect(origin: .zero, size: canvasSize)
            : drawing.bounds.insetBy(dx: -24, dy: -24)
        let raster = drawing.image(from: bounds, scale: scale)   // 透明底
        let outSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.opaque = true
        fmt.scale = 1
        let img = UIGraphicsImageRenderer(size: outSize, format: fmt).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: outSize))
            raster.draw(in: CGRect(origin: .zero, size: outSize))
        }
        return img.pngData()
    }
}
```

> 注意：`ImageExporter.png` 属于 CPU 密集，**必须**在 `Task.detached` / `DispatchQueue.global(qos: .userInitiated)` 里调用，不要在按钮点击的同步路径里做。

`APIClient` 用 `URLSession` + 手搓 multipart：

```swift
actor APIClient {
    private let base = Config.baseURL
    func review(image: Data, strokes: Data?, colorStats: Data?, meta: Meta) async throws -> ReviewResponse {
        var req = URLRequest(url: base.appendingPathComponent("api/critic/review"))
        req.httpMethod = "POST"
        let b = "Boundary-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(b)", forHTTPHeaderField: "Content-Type")
        req.httpBody = Multipart.build(boundary: b) { m in
            m.file("image", "canvas.png", "image/png", image)
            if let s = strokes { m.file("strokes", "strokes.json", "application/json", s) }
            if let c = colorStats { m.file("colorStats", "color.json", "application/json", c) }
            m.text("meta", String(data: try! JSONEncoder().encode(meta), encoding: .utf8)!)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(ReviewResponse.self, from: data)
    }
}
```

### 6.3 阶段 1 完成判据

- [ ] Mac 模拟器 `Cmd+R` 能画、能清空、能切铅笔/橡皮；
- [ ] 点「请老师批改」后，后台能看到 multipart 收包日志；
- [ ] 后端返回 JSON，iPad 下方渲染出中文批语卡片；
- [ ] 关掉 LLM key，接口仍返回 `degraded: true` 的规则批语而不是 500。

### 6.4 开源可复用（本阶段）

本阶段只需要「画布 + 导出 + 上传」，**不需要移植任何项目**，但工程骨架可以对着别人写好的抄分层：

| 项目 | 许可 | 借什么 / 不要借什么 |
| --- | --- | --- |
| **[venkatasg/DeTeXt](https://github.com/venkatasg/DeTeXt)** (180★) | MIT ✅ | PencilKit ↔ SwiftUI 桥接、工具条、`PKToolPicker` 与 `PKCanvasViewDelegate` 的组织方式。**最佳架构参考** |
| **[alfredang/notepadapp](https://github.com/alfredang/notepadapp)** (7★) | ⚠️ 无 License | 只看它的 MVVM / SwiftData 目录分层。**代码一律不要复制** |
| **[simonbs/InfiniteCanvas](https://github.com/simonbs/InfiniteCanvas)** (107★) | MIT ✅ | 若想一步到位支持缩放/平移画布 |
| **[horita-yuya/Draw](https://github.com/horita-yuya/Draw)** (63★) | MIT ✅ | 需要兼容低版本 iPadOS 时的 PencilKit 回移层 |

> ❌ 本阶段**不要**引入 CoreML / 分割模型。那是阶段 4 参照 Repaint 时再考虑的事。

---

## 7. 阶段 2：完整笔迹采集（核心亮点）

### 7.1 提取 `PKStrokePoint` 全字段

> PencilKit 的坐标是**点（point）**、原点在左上、y 轴向下。跨设备可比必须同时存归一化坐标。

```swift
import PencilKit
import UIKit

struct StrokePayload: Codable {
    var version = 1
    var canvas: CanvasInfo
    var strokes: [Stroke]
    struct CanvasInfo: Codable { var width: Double; var height: Double; var scale: Double }
    struct Stroke: Codable {
        var i: Int
        var ink: String
        var color: String
        var bbox: [Double]        // x,y,w,h
        var startMs: Int
        var endMs: Int
        var pts: [Point]
    }
    struct Point: Codable {
        var t: Double             // 秒
        var x: Double; var y: Double
        var nx: Double; var ny: Double
        var f: Double             // force 0..1
        var az: Double            // azimuth 弧度
        var al: Double            // altitude 弧度
        var w: Double; var o: Double
    }
}

enum StrokeCollector {

    static func collect(_ drawing: PKDrawing, canvas: CGSize, inkStartMs: [Int: Int]) -> StrokePayload {
        var out: [StrokePayload.Stroke] = []
        var cursorMs = 0

        // strokes 数组本身就是绘制顺序（PencilKit 保证），i 直接用作起稿顺序
        for (idx, stroke) in drawing.strokes.enumerated() {
            let path = stroke.path
            guard path.count > 0 else { continue }

            var pts: [StrokePayload.Point] = []
            pts.reserveCapacity(path.count)
            var minX = Double.greatestFiniteMagnitude, minY = Double.greatestFiniteMagnitude
            var maxX = -Double.greatestFiniteMagnitude, maxY = -Double.greatestFiniteMagnitude

            for k in 0..<path.count {
                let p = path[k]                       // PKStrokePoint
                let loc = p.location
                let x = Double(loc.x), y = Double(loc.y)
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
                pts.append(.init(
                    t: round(p.timeOffset * 1000) / 1000,
                    x: round(x * 10) / 10,  y: round(y * 10) / 10,
                    nx: x / Double(canvas.width), ny: y / Double(canvas.height),
                    f: Double(p.force),
                    az: Double(p.azimuth),
                    al: Double(p.altitude),
                    w: Double(p.size.width),
                    o: Double(p.opacity)
                ))
            }

            let durMs = Int(((path[path.count - 1].timeOffset) - (path[0].timeOffset)) * 1000)
            let startMs = inkStartMs[idx] ?? cursorMs
            cursorMs = startMs + durMs

            out.append(.init(
                i: idx,
                ink: inkName(stroke.ink.inkType),
                color: hex(stroke.ink.color),
                bbox: [minX, minY, maxX - minX, maxY - minY],
                startMs: startMs, endMs: startMs + durMs,
                pts: pts
            ))
        }
        return .init(canvas: .init(width: Double(canvas.width),
                                  height: Double(canvas.height),
                                  scale: UIScreen.main.scale),
                     strokes: out)
    }

    /// 用「第一次见到该笔」的墙钟时间近似起笔时刻，用于算真实作画节奏
    static func noteStartIfNeeded(_ drawing: PKDrawing, into map: inout [Int: Int], since: Date) {
        let now = Int(Date().timeIntervalSince(since) * 1000)
        for idx in 0..<drawing.strokes.count where map[idx] == nil { map[idx] = now }
    }

    private static func inkName(_ t: PKInk.InkType) -> String {
        switch t {
        case .pen: return "pen"
        case .pencil: return "pencil"
        case .marker: return "marker"
        case .monoline: return "monoline"
        default: return t.rawValue   // iOS 17+ 新增 crayon/fountainPen/watercolor 等
        }
    }

    private static func hex(_ c: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r*255), Int(g*255), Int(b*255))
    }
}
```

**实现要点 / 坑**：

1. `PKStrokePoint.force` 在**手指或无压感笔**上恒为固定值（通常 1.0 或 0），所以后端必须判断"本次是否真的有压感"：若所有 `f` 完全相同 → 标记 `forceAvailable: false`，不要基于它出结论。
2. `path.count` 可能很大（长笔画几百点），序列化前**抽稀**：保留首尾 + 每 3 个采样点 1 个；`t` 用 `timeOffset` 保留相对时间，抽稀不影响时间信息。
3. `PKStrokePath.timeOffset` 是相对**该笔**起笔的偏移，不是全局时间。全局节奏要在采集时用墙钟打点（见 `noteStartIfNeeded`）。
4. 序列化在后台队列执行（`Task.detached(priority: .utility)`），完成后回主线程。

### 7.2 后端笔迹分析（确定性，不交给 LLM）

`server/strokeAnalyzer.ts` 输出：

| 指标 | 算法 |
| --- | --- |
| `strokeCount` | `strokes.length` |
| `earlyDetailRatio` | 按 `startMs` 排序后取前 30% 时间的笔画，若其笔画的平均 `bbox 对角线 < 全画布对角线 8%` 且数量占比 > 50% → 判定"过早抠细节" |
| `reworkRegions` | 把画布切成 8×8 网格，统计每个网格被覆盖的不同笔画数；覆盖 ≥ 4 笔且总路径长度/覆盖笔画数 比值高 → 计一次"反复涂改" |
| `hatchAngleStdDeg` | 对每条笔画用首尾点算方向角，按笔画长度加权，求加权角度标准差（注意角度跨 180° 需用圆统计/双倍角法） |
| `avgForce` / `forceContrast` | 全局平均 `f`；亮部（用 PNG 灰度图取上四分位区域）与暗部（下四分位区域）的 `f` 均值差 |
| `forceAvailable` | `new Set(f).size > 3` |
| `rhythmPauses` | `startMs` 相邻间隔 > 8s 的停顿次数（>5 次提示注意力涣散） |
| `completion` | 画布非白像素覆盖率 + 笔迹覆盖密度 |

> 亮暗部与压感的对应关系需要把**笔迹坐标**投到 **PNG 灰度图**上：把 `nx*width, ny*height` 映射到降采样灰度图（如 64×64），取该位置灰度，聚合成亮部/暗部集合。这段逻辑是后端最核心的新增代码，写成纯函数便于单测。

**单测要求**（`server/*.test.ts`，用 `node:test` 零依赖）：

- 构造一段"只在小区域画很多短笔"的假笔迹 → `earlyDetailRatio` 高；
- 同一网格反复重画 → `reworkRegions ≥ 1`；
- 排线角度完全一致 → `hatchAngleStdDeg ≈ 0`；
- `strokes` 为空 → 所有指标返回 `null` 或 0，**不抛异常**。

### 7.3 LLM 与规则的合并

`critique.ts` 里：

```ts
const rule = analyzeStrokes(strokes, grayHistogram);   // 确定性
const vl   = await safeVisionCall(png);               // 可能失败 → null
const sections = mergeSections(vl?.sections ?? [], rule);
// 规则层拥有数值解释权：force-contrast-low 这类 evidence 只能由 rule 产生
```

对 VL 结果做**证据校验**：若 VL 说"明暗对比不足"，但规则算出的 `forceContrast` 很高，则以规则为准并在批语里改写措辞（或标 `verdict: ok`）。禁止把 VL 的数值直接塞进 `scores`。

### 7.4 开源可复用（本阶段）

| 来源 | 类型 | 借什么 |
| --- | --- | --- |
| **W3C InkML** | 标准 | 5.4 的字段语义与 `toInkML()` 导出的对齐依据；转换参考 npm `neo-inkml`（MIT） |
| **[DifferSketching](https://arxiv.org/abs/2209.08791)** | 论文 | 「不同人画同一 3D 物体的过程差异」——`earlyDetailRatio` / `reworkRegions` / `hatchAngleStdDeg` 这类过程特征该怎么定义的学术依据 |
| **[Simulating Validity](https://arxiv.org/abs/2604.26957)** | 论文 | MLLM 对学生画作给反馈的**效度问题**——直接支撑 7.3「规则层拥有数值解释权」的设计 |
| **[quickdraw-dataset](https://github.com/googlecreativelab/quickdraw-dataset)** (6805★) | 数据集 (CC BY 4.0) | 逐笔向量 + 时间戳。将来若要训练「新手笔迹」分类器，这是现成起步数据（需署名） |
| **[sketch-rnn](https://github.com/hardmaru/sketch-rnn)** (816★) | 模型 | ⚠️ **无 License**：只读其逐笔序列建模思路，代码不要抄 |

> 🔑 **本阶段最值钱的部分没有任何开源实现可抄**：`strokeAnalyzer.ts` 的 7 个指标（过早抠细节 / 涂改区域 / 排线角度方差 / 压感对比 / 节奏停顿 / 完成度 / forceAvailable）是**项目核心资产**，必须自己写 + 按 7.2 的单测覆盖。这也正是本项目与所有现存开源项目的分界线。

---

## 8. 阶段 3：彩色墨水 + 色彩量化 + 停笔 3 秒自动批改

### 8.1 彩色墨水

用到彩色时用 `PKInkingTool(.pen, color: .systemRed, width: 6)`；从 `PKToolPicker` 取色时同步自己的色板状态（用自建工具栏更可控）。导出 PNG 与 `ColorAnalyzer` 都基于**渲染后的位图**，因此天然支持任意颜色。

### 8.2 前端色彩量化（CoreGraphics，后台队列）

```swift
struct ColorStats: Codable {
    var version = 1
    var sampleSize = 64
    var hueBuckets: [Int]     // 12 桶
    var avgSaturation: Double
    var avgValue: Double
    var warmRatio: Double
    var neutralRatio: Double
    var dominantColors: [Dominant]
    struct Dominant: Codable { var hex: String; var ratio: Double }
}

enum ColorAnalyzer {
    static func analyze(png: Data, n: Int = 64) -> ColorStats? {
        guard let src = CGImageSourceCreateWithData(png as CFData, nil),
              let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        var buf = [UInt8](repeating: 0, count: n * n * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: &buf, width: n, height: n, bitsPerComponent: 8,
                                  bytesPerRow: n * 4, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))

        var hue = [Int](repeating: 0, count: 12)
        var sSum = 0.0, vSum = 0.0, warm = 0, neutral = 0, total = 0
        for i in stride(from: 0, to: buf.count, by: 4) {
            let r = Double(buf[i])/255, g = Double(buf[i+1])/255, b = Double(buf[i+2])/255
            let (h, s, v) = rgb2hsv(r, g, b)
            if v < 0.05 { continue }              // 跳过纯白/极暗
            total += 1; sSum += s; vSum += v
            hue[min(11, Int(h * 12))] += 1
            if s < 0.10 { neutral += 1 }
            if h >= 0.917 || h <= 0.25 { warm += 1 }   // 红→黄 区间
        }
        guard total > 0 else { return nil }
        return ColorStats(hueBuckets: hue,
                          avgSaturation: sSum/Double(total),
                          avgValue: vSum/Double(total),
                          warmRatio: Double(warm)/Double(total),
                          neutralRatio: Double(neutral)/Double(total),
                          dominantColors: topColors(buf, n: n))
    }
}
```

**注意**：前端算一遍、后端也可用 `sharp` 再算一遍（对齐 `stylist-agent` 的 sharp 用法），两者差异 > 5% 时以后端为准并记日志——这是排查"前端色彩统计 bug"的廉价手段。

### 8.3 停笔 3 秒自动上传

```swift
final class ReviewScheduler {
    private var work: DispatchWorkItem?
    private let delay: TimeInterval = 3.0
    func schedule(_ action: @escaping () async -> Void) {
        work?.cancel()
        let item = DispatchWorkItem { Task { await action() } }
        work = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }
    func cancel() { work?.cancel(); work = nil }
}
```

在 `PKCanvasViewDelegate`：

```swift
func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    parent.drawing = canvasView.drawing
    StrokeCollector.noteStartIfNeeded(canvasView.drawing, into: &inkStartMs, since: sessionStart)
    guard autoReviewEnabled else { return }
    scheduler.schedule { [weak self] in
        guard let self else { return }
        await self.uploadIfChanged()      // 内容 hash 未变则跳过，避免重复请求
    }
}
```

**节流规则**：距上次请求 < 20 秒 → 只挂起定时器，不发；`drawing.dataRepresentation()` 的 SHA256 未变 → 不发。这样既"准实时"又不会把 VL 打爆。

### 8.4 手动 vs 自动

保留「请老师批改」按钮（阶段 1 产物）作为兜底；自动批改可用开关关闭（默认开）。自动批改期间在批语面板顶部显示"老师正在看…"，用**同一个 `reviewId` 覆盖更新**，不要无限追加卡片。

### 8.5 开源可复用（本阶段）

| 项目 | 许可 | 借什么 |
| --- | --- | --- |
| **[jongwoo108/Repaint](https://github.com/jongwoo108/Repaint)** | MIT ✅ | 本阶段最有用：`CoverageCalculator.swift` 提供了「**PKDrawing → CGImage → 降采样 → 逐像素统计**」的完整可读管线。8.2 的 `ColorAnalyzer` 栅格化部分照这个写法即可 |
| **[DannyRuchtie/Pencil](https://github.com/DannyRuchtie/Pencil)** (10★) / **[Juanjozepeda/overink](https://github.com/Juanjozepeda/overink)** | 混合 | 浏览器端的压感 / 倾角处理。可用来**对照检查**你归一化后的 `force / azimuth / altitude` 范围是否合理。⚠️ Web 的 `pressure` 与 PencilKit `force` 标定不同，**只作对照，不可直接换算** |

> 停笔 debounce + 内容哈希去重 + 20 秒节流（8.3）**没有现成开源可抄**，按文档自己实现。

---

## 9. 阶段 4：学习档案 UI

- **历史作业**：`GET /api/critic/history` 分页列表，每项显示缩略图 + 日期 + 四个分数 + 一句 summary；点开 `GET /api/critic/review/:id` 回看大图与批语。
- **薄弱点聚合**：把历史里 `weaknesses` 做词频统计，展示"最近 10 次最常被指出的 3 个问题"，并附每个问题的历史评分趋势。
- **下一课**：`nextAssignment` 展示标题、目标、步骤、时长；按钮「开始练习」把参考图下载为临摹底图。
- **临摹底图**：画布 ZStack 下层放 `AsyncImage`（半透明 0.35），提供透明度滑块。**底图不进入 `PKCanvasView.drawing`**，放在 SwiftUI 层，导出 PNG 与上传时**是否包含底图**要明确：批改上传**不含底图**（否则批改组看不懂），只上传学生笔迹渲染图。
- **数据落盘**：`ReviewStore` 用 `FileManager` 把最近 50 次批改 JSON 缓存到 `Caches/reviews/`，离线时也能看历史。

### 9.1 开源可复用（本阶段）

| 项目 | 许可 | 借什么 |
| --- | --- | --- |
| **[jongwoo108/Repaint](https://github.com/jongwoo108/Repaint)** | MIT ✅ | **阶段 4 的完整参照，可整体移植**：`SegmentationService`（参考图分割成区域）、`GuideGeneratorService`（生成分阶段引导）、`GuideOverlayView`（引导层叠加）、`ComparisonView`（原图/作业对比）、`StyleRecipeLoader`（JSON 配方加载）。注意它是「按区域涂色引导」，与你的「笔迹过程批改」互补，可直接吸收 |
| **[collisionspace/SVGToPKDrawingCLI](https://github.com/collisionspace/SVGToPKDrawingCLI)** (4★) | ⚠️ 无 License | **SVG → PKDrawing**。若「临摹底图」要走「可编辑笔迹」路线（而非静态图片层），看它的转换逻辑；无 License，**只看思路，自己用 PKDrawing 公开 API 实现** |
| **[How2Sketch](https://arxiv.org/abs/1607.07980)** | 论文 | 「把 3D 物体自动拆成易跟的分步素描教程」的笔画分解 + 难度排序算法 → `nextAssignment` 出题逻辑的设计依据 |
| **[SketchAgent](https://arxiv.org/abs/2411.17673)** | 论文 | 语言驱动的**逐笔顺序**草图生成 → 做「示范笔顺动画」而非静态参考图时参考 |
| **[draw_fun](https://github.com/angiegh2002/draw_fun)** / **[Mathi](https://github.com/25cse126-afk/Mathi)** | 玩具项目 | 图片→编号引导点 / 四阶段（轮廓→素描→明暗）的**产品思路**。工程价值低，别抄代码 |

**生成临摹线稿的建议**：照片 → 线稿在服务端用 OpenCV 风格化（`pencilSketch` / `stylize`）或边缘/骨架化即可产出静态 PNG，**不要为此上模型**。参考 [Arshath015/skeleton-furniture](https://github.com/Arshath015/skeleton-furniture-oz95) 的骨架化阈值参数。

---

## 10. 调试指南

### 10.1 模式 A：iPad 模拟器（改 UI / 改上传逻辑）

1. Xcode → New Project → iOS → App，Interface 选 **SwiftUI**，Language **Swift**；
2. 顶部设备选 `iPad Pro 13-inch (M4)`；
3. `Cmd+R`，Mac 上弹出模拟器窗口，鼠标当笔；
4. 断点、`print`、LLDB 全可用（`po canvasView.drawing.strokes.count`）。

> ⚠️ 模拟器**无法模拟真实 Pencil 的 force / altitude / azimuth**：`force` 基本恒定。所以模拟器**不能**用来验收阶段 2 的笔迹指标，只能验证"字段能取到、JSON 能上传"。

### 10.2 模式 B：iPad 真机（推荐，唯一能验收笔迹）

1. Mac 数据线连 iPad，iPad 弹「信任此电脑」→ 信任并输密码；
2. iPad 需先开 **设置 → 隐私与安全性 → 开发者模式**（iPadOS 16+），**重启后**才生效；
3. Xcode 顶部设备切到真机 → 左侧项目 → **Signing & Capabilities** → Team 选免费 Apple ID（自动生成免费证书，无需 99 美元账号，仅本机调试够用）；
4. `Cmd+R` 安装；首次运行 iPad 需「设置 → 通用 → VPN与设备管理」信任该开发者证书；
5. 无线调试：数据线配对一次后勾选 Xcode 的「Connect via network」，之后同一 Wi-Fi 下拔线也能 `Cmd+R`。

真机调试能力：

| 手段 | 用途 |
| --- | --- |
| 断点 | 停在 `canvasViewDrawingDidChange`，查看 `strokes` 数组 |
| LLDB | `po canvasView.drawing.strokes[0].path[0]` 看 force/azimuth/altitude 原始值 |
| 控制台 | 打印上传耗时、后端响应 JSON |
| Instruments（`Cmd+I`） | Time Profiler 抓"画多了之后掉帧"、Network 抓上传阻塞 |

### 10.3 必踩的坑

**① ATS：内网 HTTP 被拦。** `Info.plist`：

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>192.168.1.23</key>            <!-- 换成你树莓派的真实 IP -->
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key><true/>
            <key>NSIncludesSubdomains</key><true/>
        </dict>
    </dict>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>需要连接局域网内的美术批改服务</string>
```

> 注意两条都必要：ATS 例外放行 http；iOS 14+ 还有**本地网络隐私权限**，访问内网 IP 会弹窗，缺 `NSLocalNetworkUsageDescription` 会直接连不上。最省事的替代方案：用 **Tailscale** 给后端一个 https 地址（`https://<mac>.ts.net:4292`），ATS 不用配。

**② 主线程阻塞。** 图片编码（2x 画布 PNG 可能几 MB）、笔迹 JSON 序列化、色彩统计，全部后台队列；`URLSession.shared.data(for:)` 是 async 的不要包 `DispatchQueue.main.sync`。UI 状态更新用 `@MainActor` 的 `ReviewStore`。

**③ `PKStrokePath` 版本差异。** iPadOS 14 起 `stroke.path` 是 `PKStrokePath`（点式访问）；不同版本新增 ink 类型与字段（如 iOS 17 的 `crayon` 等）。策略：`@available` 分支 + `default:` 兜底 + 固定测试机 iPadOS 版本。

**④ 上传体积。** 画布全尺寸 + 笔迹 JSON 可能几 MB；PNG 长边限 2048、笔迹抽稀、`URLSessionConfiguration.timeoutIntervalForRequest = 30`。大图上传统一在后台，UI 显示进度。

**⑤ `drawingPolicy`。** 调试期 `.anyInput`（手指可画），正式期 `.pencilOnly`，避免手掌误触。

**⑥ 撤销/重做会让 `strokes` 索引变化。** `i` 是**当前数组顺序**，撤销会整体前移。若需要跨撤销追踪起稿顺序，用 `inkStartMs` 墙钟打点为准（阶段 2 的 `noteStartIfNeeded` 已处理）；同时撤销/重做要重建 `inkStartMs` 映射。

---

## 11. 目录结构（最终形态）

```
pencil/
├── ArtCoach.xcodeproj
├── ArtCoach/
│   ├── ArtCoachApp.swift
│   ├── ContentView.swift              # 顶部工具栏 + 画布 + 底部批语面板（TabView: 练习/档案）
│   ├── Config.swift
│   ├── Info.plist
│   ├── Canvas/
│   │   ├── CanvasView.swift
│   │   ├── CanvasToolbar.swift
│   │   ├── ImageExporter.swift
│   │   ├── StrokeCollector.swift      # 阶段2
│   │   ├── ColorAnalyzer.swift        # 阶段3
│   │   └── ReviewScheduler.swift      # 阶段3
│   ├── Net/
│   │   ├── APIClient.swift
│   │   ├── Multipart.swift
│   │   ├── Models.swift
│   │   └── Endpoints.swift
│   ├── State/
│   │   └── ReviewStore.swift
│   └── UI/
│       ├── CritiquePanel.swift
│       ├── HistoryList.swift          # 阶段4
│       ├── WeaknessChart.swift        # 阶段4
│       └── TracingLayer.swift         # 阶段4
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── config.json
│   ├── .env.example
│   ├── index.ts
│   ├── config.ts
│   ├── env.ts
│   ├── store.ts
│   ├── upload.ts
│   ├── vision.ts
│   ├── strokeAnalyzer.ts              # 阶段2
│   ├── strokeAnalyzer.test.ts
│   ├── colorAnalyzer.ts               # 阶段3
│   ├── critique.ts
│   ├── assignments.ts                 # 下一课任务库（纯数据 + 选择规则）
│   └── review.ts
├── THIRD_PARTY.md                     # 复用开源项目的许可证与版权声明（见第 15.4 节）
└── README.md
```

---

## 12. 验收标准

### 阶段 1
- [ ] 模拟器可画可清可导出；上传成功返回批语；LLM 未配置时降级不报错。
- [ ] 后端 `POST /api/critic/review` 有 curl 可复现示例（写进 README）。

### 阶段 2
- [ ] 真机上 `po` 能看到真实 `force` 分布（不是恒定值）。
- [ ] 后端日志打印 `strokeCount / avgForce / hatchAngleStdDeg / reworkRegions / earlyDetailRatio`。
- [ ] `node --test` 四个单测全绿；空 strokes 不崩。
- [ ] 同一张图连发两次，批语稳定（不出现随机数值）。

### 阶段 3
- [ ] 停笔 3 秒自动触发一次上传；连画 5 笔只发 1 次。
- [ ] 20 秒内重复停笔不重复请求（内容未变则跳过）。
- [ ] `colorStats.warmRatio` 与后端 sharp 复算差异 < 5%。

### 阶段 4
- [ ] 历史列表可翻页、可点开回看。
- [ ] 薄弱点 Top3 来自历史词频，不是模型现编。
- [ ] 参考图能导入为半透明底图，透明度可调，且**不进上传图**。

### 全局
- [ ] 无 i18n 相关文件；全部中文硬编码。
- [ ] 网络层全部 async/await，无线程阻塞告警（Instruments 无主线程长任务）。
- [ ] 无任何密钥进仓库（`.env` 在 `.gitignore`）。
- [ ] `THIRD_PARTY.md` 已登记每个复用项目的 链接/许可/复用内容/版权声明，无 License 的仓库没有代码被复制。

---

## 13. 风险与待决策

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| VL 模型对素描的造型评价不稳定 | 批语前后矛盾 | 规则层拥有数值解释权；批语只引用规则数值；VL 仅做定性描述 |
| 真机 force 数据在部分笔/贴膜下失真 | 压感指标无意义 | 用 `forceAvailable` 判定，失真时隐藏压感维度并只给造型建议 |
| 内网 HTTP + 本地网络权限 | 真机连不上后端 | 优先 Tailscale https；否则 ATS + `NSLocalNetworkUsageDescription` 双配 |
| 大画布上传慢 | 自动批改卡顿 | 长边 2048 + 笔迹抽稀 + 后台队列 + 请求去重 |
| 免费 Apple ID 证书 7 天过期 | 真机 App 失效 | 每周重连 Mac 重新 `Cmd+R`；或购买开发者账号（非必须） |

**需要用户拍板的点**：

1. 后端部署位置：树莓派常驻 vs 云服务器？（影响 baseURL 与是否能用 Tailscale）
2. 自动批改默认开还是关？（默认开，可能更"AI 感"，但更费 token）
3. 临摹底图是否要在导出作业图时可选包含？（默认不含）
4. 练习任务库（`assignments.ts`）先手写 10 条，还是让 Agent 动态生成？（建议先手写，可解释、可测试）

---

## 14. 推荐实施顺序（给执行 AI 的 checklist）

```
[ ] 1. 建 Xcode 工程 + server 骨架，写死 baseURL 与 /api/critic/review 契约
[ ] 2. 阶段1：CanvasView + 导出PNG + 上传 + 批语面板
[ ] 3. 后端：vision.ts + 降级路径 + store 落盘
[ ] 4. 真机跑通阶段1，确认 ATS / 本地网络权限 OK
[ ] 5. 阶段2：StrokeCollector + strokeAnalyzer + 单测
[ ] 6. 真机验证 force 非恒定，联调 metrics
[ ] 7. 阶段3：ColorAnalyzer + ReviewScheduler 去重
[ ] 8. 阶段4：历史/薄弱点/下一课/临摹底图
[ ] [ ] 0. 先读第 15 节开源参考总表，确定哪些直接移植 / 哪些只看思路
[ ] 1. 建 Xcode 工程 + server 骨架，写死 baseURL 与 /api/critic/review 契约
[ ] 2. 阶段1：CanvasView + 导出PNG + 上传 + 批语面板
[ ] 3. 后端：vision.ts + 降级路径 + store 落盘
[ ] 4. 真机跑通阶段1，确认 ATS / 本地网络权限 OK
[ ] 5. 阶段2：StrokeCollector + strokeAnalyzer + 单测
[ ] 6. 真机验证 force 非恒定，联调 metrics
[ ] 7. 阶段3：ColorAnalyzer + ReviewScheduler 去重
[ ] 8. 阶段4：历史/薄弱点/下一课/临摹底图
[ ] 9. README 补齐 curl 示例、调试步骤、降级说明
[ ] 10. 新建 THIRD_PARTY.md，登记所有复用的开源项目与许可证
```

> 每个 `[ ]` 完成后停下来演示一次，不要一路写到底再调。

---

## 15. 附录：开源参考总表与许可合规

### 15.1 结论：这是开源空白区

按「PencilKit 笔迹过程数据 + 后端 VL/规则批改」检索全 GitHub，**没有任何项目把 `PKStrokePoint` 的 `force / azimuth / altitude / timeOffset` 序列拿来做教学分析**。现存项目分两派，都不覆盖你的核心：

- **几何派**（如 Repaint）：只看**画布像素覆盖率**，不看笔怎么下；
- **视觉派**（如各类 `ai-art-critique`、`ArtCritiqueTool`）：只看**成品图**，连笔顺都不知道。

你的方案是第三派——**基于笔迹过程数据的过程性批改**。结论：**基础工程 70% 可复用，核心 30%（以及全部产品差异化）必须自研**。

### 15.2 总表（按可复用价值排序）

| # | 项目 | 星级 | 许可 | 用途 | 建议动作 |
| --- | --- | --- | --- | --- | --- |
| 1 | [jongwoo108/Repaint](https://github.com/jongwoo108/Repaint) | 0★ | **MIT ✅** | iPad AI 绘画教练（SwiftUI+PencilKit+CoreML 分割+区域覆盖率引导） | **主力参考，阶段 3/4 可移植代码** |
| 2 | [venkatasg/DeTeXt](https://github.com/venkatasg/DeTeXt) | 180★ | **MIT ✅** | PencilKit+SwiftUI+CoreML 识别手写 LaTeX | 阶段 1 架构范式 |
| 3 | [simonbs/InfiniteCanvas](https://github.com/simonbs/InfiniteCanvas) | 107★ | MIT ✅ | PencilKit 无限画布 | 需要缩放/平移时 |
| 4 | [SpectralDragon/Minimap](https://github.com/SpectralDragon/Minimap) | 66★ | MIT ✅ | PKCanvasView 缩略导航图 | 大画布导航 |
| 5 | [horita-yuya/Draw](https://github.com/horita-yuya/Draw) | 63★ | MIT ✅ | PencilKit 回移层 | 需兼容低版本时 |
| 6 | [can1357/libfreeform](https://github.com/can1357/libfreeform) | 7★ | Apache-2.0 ✅ | 解析 Apple Freeform 墨迹二进制 | 想逆 PencilKit 存储格式时 |
| 7 | [W3C InkML](https://www.w3.org/TR/InkML/) + [neo-inkml](https://www.npmjs.com/package/neo-inkml) | — | 标准 / MIT ✅ | 数字墨水标准与转换 | **5.4 字段语义对齐 + `toInkML()` 导出** |
| 8 | [quickdraw-dataset](https://github.com/googlecreativelab/quickdraw-dataset) | 6805★ | CC BY 4.0 | 逐笔向量+时间戳草图数据 | 将来训练笔迹分类器的数据源 |
| 9 | [sketch-rnn](https://github.com/hardmaru/sketch-rnn) | 816★ | ⚠️ 无 | 逐笔序列生成模型 | 只读思路 |
| 10 | [SVGToPKDrawingCLI](https://github.com/collisionspace/SVGToPKDrawingCLI) | 4★ | ⚠️ 无 | SVG→PKDrawing | 只读思路 |
| 11 | [alfredang/notepadapp](https://github.com/alfredang/notepadapp) | 7★ | ⚠️ 无 | SwiftUI+PencilKit+SwiftData 工程结构 | 只看分层 |
| 12 | [jennnniferkuang/picasso](https://github.com/jennnniferkuang/picasso) | 5★ | ⚠️ 无 | 实时 art critique（Web/Python） | 产品对照 |

### 15.3 学术参考

| 论文 | arXiv | 用途 |
| --- | --- | --- |
| How2Sketch | [1607.07980](https://arxiv.org/abs/1607.07980) | 自动生成分步素描教程（笔画分解 + 难度排序）→ `nextAssignment` |
| SketchAgent | [2411.17673](https://arxiv.org/abs/2411.17673) | 语言驱动逐笔草图生成 → 示范笔顺 |
| Simulating Validity | [2604.26957](https://arxiv.org/abs/2604.26957) | MLLM 对学生画作反馈的效度 → **支撑「规则层拥有数值解释权」** |
| DifferSketching | [2209.08791](https://arxiv.org/abs/2209.08791) | 绘画过程的个体差异 → 过程特征定义依据 |
| Interactive Sketchpad | [2503.16434](https://arxiv.org/abs/2503.16434) | 多模态协作视觉解题导师 → 交互形态参考 |

### 15.4 许可红线（必须遵守）

| 许可 | 能不能复制代码 | 要求 |
| --- | --- | --- |
| MIT / Apache-2.0 | ✅ 可以 | 必须在 `pencil/THIRD_PARTY.md` 保留原 LICENSE 与版权声明 |
| CC BY 4.0（数据集） | ✅ 可用数据 | 必须署名 |
| **无 License** | ❌ **不可以** | 默认「保留所有权利」。只能读思路、自己实现 |
| GPL | ⚠️ 慎用 | 传染性，本 App 若不分发可内部用，分发需开源 |

> 建议阶段 4 结束后做一次「许可证巡检」：`pencil/THIRD_PARTY.md` 里每条都要有 `项目名 / 链接 / 许可 / 复用了什么 / 版权声明原文`。

### 15.5 搬运时的两个坑

1. **别把 Repaint 的 CoreML 分割模型整个搬进来**——它是特定 5 类风景（sky/water/vegetation/flower/ground）训练的，素描静物用不上。只借它的**流程与覆盖率算法**，不要借模型权重。
2. **别把 Web 端（Pencil / overink）的压感标定换算套到 PencilKit 上**——两者的 `pressure` 取值范围与曲线不同，跨端只能对照趋势，不能直接换算数值。
