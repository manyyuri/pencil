import UIKit
import PencilKit

/// 笔迹 JSON（spec 5.4，字段语义对齐 W3C InkML 的 t/x/y/force/azimuth/altitude 通道）
struct StrokePayload: Codable {
    var version = 1
    var canvas: CanvasInfo
    var strokes: [Stroke]

    struct CanvasInfo: Codable {
        var width: Double
        var height: Double
        var scale: Double
    }

    struct Stroke: Codable {
        var i: Int
        var ink: String
        var color: String
        var bbox: [Double] // x,y,w,h
        var startMs: Int
        var endMs: Int
        var pts: [Point]
    }

    struct Point: Codable {
        var t: Double // 秒（相对本笔起笔）
        var x: Double
        var y: Double
        var nx: Double
        var ny: Double
        var f: Double
        var az: Double
        var al: Double
        var w: Double
        var o: Double
    }
}

/// 从 PKDrawing 提取全字段笔迹；序列化前抽稀（首尾保留 + 每 3 点取 1）
enum StrokeCollector {

    /// `inkStartMs`：每笔"第一次被见到"的墙钟偏移（撤销会整体前移索引，只能近似）
    static func collect(
        _ drawing: PKDrawing,
        canvas: CGSize,
        scale: Double,
        inkStartMs: [Int: Int]
    ) -> StrokePayload {
        var out: [StrokePayload.Stroke] = []
        var cursorMs = 0

        // strokes 数组本身就是绘制顺序（PencilKit 保证），i 直接用作起稿顺序
        for (idx, stroke) in drawing.strokes.enumerated() {
            let path = stroke.path
            guard path.count > 0 else { continue }

            var pts: [StrokePayload.Point] = []
            var minX = Double.greatestFiniteMagnitude
            var minY = Double.greatestFiniteMagnitude
            var maxX = -Double.greatestFiniteMagnitude
            var maxY = -Double.greatestFiniteMagnitude

            for k in 0..<path.count {
                // 抽稀：保留首尾 + 每 3 个采样点 1 个（时间信息不受影响，t 保留相对值）
                let isEnds = k == 0 || k == path.count - 1
                guard isEnds || k % 3 == 0 else { continue }
                let p = path[k] // PKStrokePoint
                let loc = p.location
                let x = Double(loc.x)
                let y = Double(loc.y)
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
                pts.append(.init(
                    t: (round(p.timeOffset * 1000) / 1000),
                    x: (round(x * 10) / 10),
                    y: (round(y * 10) / 10),
                    nx: x / Double(max(1, canvas.width)),
                    ny: y / Double(max(1, canvas.height)),
                    f: Double(p.force),
                    az: Double(p.azimuth),
                    al: Double(p.altitude),
                    w: Double(p.size.width),
                    o: Double(p.opacity)
                ))
            }

            let firstT = path[0].timeOffset
            let lastT = path[path.count - 1].timeOffset
            let durMs = Int(max(0, (lastT - firstT) * 1000))
            let startMs = inkStartMs[idx] ?? cursorMs
            cursorMs = startMs + durMs

            out.append(.init(
                i: idx,
                ink: inkName(stroke.ink.inkType),
                color: hex(stroke.ink.color),
                bbox: [minX, minY, maxX - minX, maxY - minY],
                startMs: startMs,
                endMs: startMs + durMs,
                pts: pts
            ))
        }
        return .init(
            canvas: .init(
                width: Double(canvas.width),
                height: Double(canvas.height),
                scale: scale
            ),
            strokes: out
        )
    }

    /// 用「第一次见到该笔」的墙钟时间近似起笔时刻（全局节奏的真实依据）
    static func noteStartIfNeeded(_ drawing: PKDrawing, into map: inout [Int: Int], since: Date) {
        let now = Int(Date().timeIntervalSince(since) * 1000)
        for idx in 0..<drawing.strokes.count where map[idx] == nil {
            map[idx] = now
        }
    }

    /// 撤销/重做后 strokes 索引整体前移：截掉越界项保住映射（近似，足够过程分析用）
    static func rebuildAfterUndo(_ map: [Int: Int], strokeCount: Int) -> [Int: Int] {
        map.filter { $0.key < strokeCount }
    }

    /// ink 类型名（未来新增类型走 default 分支兜底，不崩溃）
    private static func inkName(_ t: PKInk.InkType) -> String {
        switch t {
        case .pen: return "pen"
        case .pencil: return "pencil"
        case .marker: return "marker"
        case .monoline: return "monoline"
        default: return t.rawValue // iOS 17+ 的 crayon/fountainPen/watercolor 等
        }
    }

    private static func hex(_ c: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}
