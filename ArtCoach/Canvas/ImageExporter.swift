import UIKit
import PencilKit

/// 画布导出为白底 PNG；长边限制 maxEdge 像素（默认 2048），避免上传过大。
/// ⚠️ CPU 密集：必须在后台队列调用（Task.detached / DispatchQueue.global），不要在按钮同步路径做。
enum ImageExporter {
    static func png(from drawing: PKDrawing, canvasSize: CGSize, scale: CGFloat = 2, maxEdge: CGFloat = 2048) -> Data? {
        var bounds = drawing.bounds.isEmpty
            ? CGRect(origin: .zero, size: canvasSize)
            : drawing.bounds.insetBy(dx: -24, dy: -24)
        if bounds.width <= 0 || bounds.height <= 0 { bounds = CGRect(origin: .zero, size: canvasSize) }

        // 限制长边
        var effScale = scale
        let longEdge = max(bounds.width, bounds.height) * scale
        if longEdge > maxEdge {
            effScale = maxEdge / max(bounds.width, bounds.height)
        }

        let raster = drawing.image(from: bounds, scale: effScale) // 透明底
        let outSize = CGSize(width: bounds.width * effScale, height: bounds.height * effScale)
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
