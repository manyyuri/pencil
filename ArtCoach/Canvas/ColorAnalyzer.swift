import Foundation
import CoreGraphics
import ImageIO
import UIKit

/// 画布像素色彩量化（spec 8.2，CoreGraphics 后台队列）。
/// 口径与服务端 colorAnalyzer.ts 完全一致：
///   64×64 采样 / HSV / 跳过纸面白（v>0.92 && s<0.10）/ 色相桶只统计 s≥0.15 /
///   暖色 h≥0.917||h≤0.25 / 近灰 s<0.10 / 主色 3bit 每通道量化取 Top3。
/// 说明：栅格化后的内存行序与显示方向可能上下翻转，但所有指标都是聚合统计，不受方向影响。
struct ColorStats: Codable {
    var version = 1
    var sampleSize = 64
    var hueBuckets: [Int] // 12 桶
    var avgSaturation: Double
    var avgValue: Double
    var warmRatio: Double
    var neutralRatio: Double
    var dominantColors: [Dominant]

    struct Dominant: Codable {
        var hex: String
        var ratio: Double
    }
}

enum ColorAnalyzer {
    static func analyze(png: Data, n: Int = 64) -> ColorStats? {
        guard let src = CGImageSourceCreateWithData(png as CFData, nil),
              let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }

        var buf = [UInt8](repeating: 0, count: n * n * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: &buf,
            width: n,
            height: n,
            bitsPerComponent: 8,
            bytesPerRow: n * 4,
            space: cs,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))

        var hue = [Int](repeating: 0, count: 12)
        var sSum = 0.0, vSum = 0.0
        var warm = 0, neutral = 0, total = 0

        // 主色量化：3bit/通道（8³=512 桶）
        var bins = [Int: (count: Int, r: Double, g: Double, b: Double)]()
        var nonWhite = 0

        for i in stride(from: 0, to: buf.count, by: 4) {
            let r = Double(buf[i]) / 255
            let g = Double(buf[i + 1]) / 255
            let b = Double(buf[i + 2]) / 255
            let c = classifyPixel(r, g, b)
            if c.paperWhite { continue } // 纸面白
            total += 1
            sSum += c.s
            vSum += c.v
            if c.chromatic {
                let idx = min(11, Int(c.h * 12))
                hue[idx] += 1
            }
            if c.neutral { neutral += 1 }
            if c.warm { warm += 1 }
            // 能走到这里的必是非纸白像素 → 直接计入主色
            nonWhite += 1
            let q = { (x: Double) -> Int in min(7, Int(x * 8)) }
            let key = (q(r) << 6) | (q(g) << 3) | q(b)
            var cur = bins[key] ?? (0, 0, 0, 0)
            cur.count += 1
            cur.r += r
            cur.g += g
            cur.b += b
            bins[key] = cur
        }
        guard total > 0 else { return nil }

        let dominant = bins.values
            .sorted { $0.count > $1.count }
            .prefix(3)
            .map { c -> ColorStats.Dominant in
                let r = Int((c.r / Double(c.count)) * 255)
                let g = Int((c.g / Double(c.count)) * 255)
                let b = Int((c.b / Double(c.count)) * 255)
                let hexStr = String(format: "#%02X%02X%02X", r, g, b)
                return .init(hex: hexStr, ratio: (Double(c.count) / Double(max(1, nonWhite))))
            }

        return ColorStats(
            hueBuckets: hue,
            avgSaturation: sSum / Double(total),
            avgValue: vSum / Double(total),
            warmRatio: Double(warm) / Double(total),
            neutralRatio: Double(neutral) / Double(total),
            dominantColors: Array(dominant)
        )
    }

    /// 单像素分类：全部阈值口径集中在此，与服务端 colorAnalyzer.ts classifyPixel 保持一致。
    private struct PixelClass {
        let h: Double, s: Double, v: Double
        let paperWhite: Bool // v>0.92 && s<0.10：纸面白，跳过
        let chromatic: Bool // s≥0.15：计入色相桶（灰像素色相无意义）
        let neutral: Bool // s<0.10：近灰
        let warm: Bool // h≥0.917 || h≤0.25：暖色
    }

    private static func classifyPixel(_ r: Double, _ g: Double, _ b: Double) -> PixelClass {
        let (h, s, v) = rgb2hsv(r, g, b)
        return PixelClass(
            h: h, s: s, v: v,
            paperWhite: v > 0.92 && s < 0.1,
            chromatic: s >= 0.15,
            neutral: s < 0.10,
            warm: h >= 0.917 || h <= 0.25
        )
    }

    private static func rgb2hsv(_ r: Double, _ g: Double, _ b: Double) -> (h: Double, s: Double, v: Double) {
        let maxC = max(r, g, b)
        let minC = min(r, g, b)
        let d = maxC - minC
        var h = 0.0
        if d > 0 {
            if maxC == r { h = ((g - b) / d).truncatingRemainder(dividingBy: 6) }
            else if maxC == g { h = (b - r) / d + 2 }
            else { h = (r - g) / d + 4 }
            if h < 0 { h += 6 }
            h /= 6
        }
        let s = maxC == 0 ? 0 : d / maxC
        return (h, s, maxC)
    }
}
