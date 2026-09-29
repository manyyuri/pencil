import SwiftUI
import PencilKit
import CryptoKit

// MARK: - 工具状态

enum InkKind: String, CaseIterable {
    case pencil, pen, marker
}

enum ExportError: LocalizedError {
    case pngFailed

    var errorDescription: String? {
        switch self {
        case .pngFailed: return "画布导出失败"
        }
    }
}

// MARK: - 颜色小工具

extension UIColor {
    convenience init(hex: String) {
        var value: UInt64 = 0
        Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}

extension Color {
    init(hex: String) {
        self.init(UIColor(hex: hex))
    }
}

// MARK: - ReviewStore（@MainActor 状态中枢）

/// 持有画布/工具/上传/批语/档案全部状态。
/// 重活（PNG 导出、笔迹序列化、色彩统计、SHA256）全部丢后台队列，主线程只碰 UI 状态。
@MainActor
@Observable
final class ReviewStore {

    // ---------- 画布 ----------
    var drawing = PKDrawing()
    var canvasSize = CGSize(width: 1024, height: 768)

    @ObservationIgnored weak var canvasView: PKCanvasView?
    @ObservationIgnored var inkStartMs: [Int: Int] = [:] // 每笔首次见到的墙钟偏移
    @ObservationIgnored var sessionStart = Date()
    @ObservationIgnored let scheduler = ReviewScheduler(delay: 3.0)          // 停笔 debounce
    @ObservationIgnored let throttleScheduler = ReviewScheduler(delay: 20.0) // 节流重试
    @ObservationIgnored private var lastSentHash: String?
    @ObservationIgnored private var lastSentAt: Date?

    // ---------- 工具（toolRevision 变化 → 画布应用新工具） ----------
    var inkKind: InkKind = .pencil { didSet { bumpTool() } }
    var inkColorHex = "#1A1A1A" { didSet { bumpTool() } }
    var inkWidth: Double = 6 { didSet { bumpTool() } }
    var isErasing = false { didSet { bumpTool() } }
    @ObservationIgnored private(set) var toolRevision = 0

    private func bumpTool() { toolRevision &+= 1 }

    var currentTool: PKTool {
        if isErasing { return PKEraserTool(.bitmap) }
        let color = UIColor(hex: inkColorHex)
        switch inkKind {
        case .pencil: return PKInkingTool(.pencil, color: color, width: max(1, inkWidth))
        case .pen: return PKInkingTool(.pen, color: color, width: max(1, inkWidth))
        case .marker: return PKInkingTool(.marker, color: color, width: max(2, inkWidth * 1.5))
        }
    }

    // ---------- 批改 ----------
    var review: ReviewResponse?
    var isUploading = false
    var lastError: String?
    var autoReviewEnabled = true
    var showingClearConfirm = false

    // ---------- 任务与临摹底图 ----------
    var currentAssignment: AssignmentDetail?
    var tracingURL: URL?
    var tracingOpacity = 0.35
    var tracingVisible = true

    // ---------- 档案 ----------
    var history: [HistoryItem] = []
    var historyNextCursor: String?
    var isLoadingHistory = false
    var cachedReviews: [ReviewResponse] = []

    @ObservationIgnored private let api = APIClient.shared
    @ObservationIgnored private let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    init() {
        Task { await loadCachedReviews() }
    }

    // MARK: 工具操作

    func setInkKind(_ kind: InkKind) {
        isErasing = false
        inkKind = kind
    }

    func setInkColor(_ color: Color) {
        isErasing = false
        inkColorHex = ReviewStore.hexString(color)
    }

    func setErasing(_ on: Bool) {
        isErasing = on
    }

    static func hexString(_ c: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }

    // MARK: 画布操作

    func undo() { canvasView?.undoManager?.undo() }
    func redo() { canvasView?.undoManager?.redo() }

    func clearCanvas() {
        canvasView?.drawing = PKDrawing()
        drawing = PKDrawing()
        inkStartMs = [:]
        lastSentHash = nil
        lastSentAt = nil
        sessionStart = Date()
        scheduler.cancel()
        throttleScheduler.cancel()
    }

    /// 撤销/重做后 strokes 索引整体前移 → 截断映射（近似）
    func rebuildInkMapAfterUndo() {
        inkStartMs = StrokeCollector.rebuildAfterUndo(inkStartMs, strokeCount: drawing.strokes.count)
    }

    // MARK: 上传（自动批改入口：去重 + 20s 节流）

    func uploadIfChanged() async {
        guard !isUploading, !drawing.strokes.isEmpty else { return }
        let rep = drawing.dataRepresentation()
        let hash = await Self.sha256(rep)
        guard hash != lastSentHash else { return } // 内容未变 → 不发
        if let last = lastSentAt, Date().timeIntervalSince(last) < 20 {
            // 20 秒节流：挂起 20s 后自动重试
            throttleScheduler.schedule { [weak self] in
                guard let self else { return }
                Task { @MainActor in await self.uploadIfChanged() }
            }
            return
        }
        await requestReview(manual: false, contentHash: hash)
    }

    // MARK: 上传（主流程）

    func requestReview(manual: Bool, contentHash: String? = nil) async {
        guard !isUploading else { return }
        guard !drawing.strokes.isEmpty else {
            lastError = "画布是空的，先画点什么吧"
            return
        }
        isUploading = true
        defer { isUploading = false }

        do {
            let drawing = self.drawing
            let canvas = self.canvasSize
            let scale = self.displayScale
            let inkMap = self.inkStartMs
            let taskId = self.currentAssignment?.id
            let sessionStart = self.sessionStart
            let finishedAt = Date()

            // 后台队列：PNG 导出 + 笔迹序列化 + 色彩统计（全是 CPU 密集）
            let (png, strokes, colorStats) = try await Task.detached(priority: .userInitiated) { () -> (Data, Data?, Data?) in
                guard let png = ImageExporter.png(from: drawing, canvasSize: canvas, scale: scale) else {
                    throw ExportError.pngFailed
                }
                let payload = StrokeCollector.collect(drawing, canvas: canvas, scale: scale, inkStartMs: inkMap)
                let strokes = try? JSONEncoder().encode(payload)
                let color = ColorAnalyzer.analyze(png: png).flatMap { try? JSONEncoder().encode($0) }
                return (png, strokes, color)
            }.value

            let durationSec = max(1, Int(finishedAt.timeIntervalSince(sessionStart)))
            let meta = Meta(
                appVersion: Config.appVersion,
                deviceModel: DeviceInfo.model,
                systemVersion: UIDevice.current.systemVersion,
                canvasSize: .init(width: canvas.width, height: canvas.height),
                scale: scale,
                taskId: taskId,
                durationSec: durationSec,
                startedAt: iso8601.string(from: sessionStart),
                finishedAt: iso8601.string(from: finishedAt)
            )

            let resp = try await api.review(image: png, strokes: strokes, colorStats: colorStats, meta: meta)
            self.review = resp
            self.lastError = nil
            self.lastSentAt = Date()
            if let h = contentHash {
                self.lastSentHash = h
            } else {
                self.lastSentHash = await Self.sha256(drawing.dataRepresentation())
            }
            self.cacheReview(resp)
        } catch {
            self.lastError = "批改失败：\(error.localizedDescription)"
        }
    }

    private var displayScale: Double {
        Double(canvasView?.traitCollection.displayScale ?? 2)
    }

    // MARK: 档案

    func loadHistory() async {
        guard !isLoadingHistory else { return }
        isLoadingHistory = true
        defer { isLoadingHistory = false }
        do {
            let resp = try await api.history(limit: 20, cursor: nil)
            history = resp.items
            historyNextCursor = resp.nextCursor
        } catch {
            lastError = "历史加载失败：\(error.localizedDescription)"
        }
    }

    func loadMoreHistory() async {
        guard let cursor = historyNextCursor else { return }
        do {
            let resp = try await api.history(limit: 20, cursor: cursor)
            history += resp.items
            historyNextCursor = resp.nextCursor
        } catch {
            lastError = "历史加载失败：\(error.localizedDescription)"
        }
    }

    func reviewDetail(id: String) async -> ReviewResponse? {
        try? await api.reviewDetail(id: id)
    }

    func startAssignment(_ id: String) async {
        guard let detail = try? await api.assignment(id: id) else {
            lastError = "任务加载失败：\(id)"
            return
        }
        currentAssignment = detail
        tracingVisible = true
        tracingOpacity = 0.35
        tracingURL = detail.referenceImageUrl.flatMap(URL.init(string:))
    }

    func finishAssignment() {
        currentAssignment = nil
        tracingURL = nil
    }

    // MARK: 本地缓存（Caches/reviews，最近 50 份，离线可看薄弱点聚合）

    private var cacheDir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("reviews", isDirectory: true)
    }

    private func cacheReview(_ r: ReviewResponse) {
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let url = cacheDir.appendingPathComponent("\(r.reviewId).json")
        if let data = try? JSONEncoder().encode(r) {
            try? data.write(to: url, options: .atomic)
        }
        cachedReviews.removeAll { $0.reviewId == r.reviewId }
        cachedReviews.insert(r, at: 0)
        pruneCache()
    }

    private func pruneCache() {
        guard cachedReviews.count > 50 else { return }
        let removed = cachedReviews.suffix(cachedReviews.count - 50)
        cachedReviews.removeLast(cachedReviews.count - 50)
        for r in removed {
            try? FileManager.default.removeItem(at: cacheDir.appendingPathComponent("\(r.reviewId).json"))
        }
    }

    private func loadCachedReviews() async {
        let dir = cacheDir
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        let loaded: [ReviewResponse] = files
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder().decode(ReviewResponse.self, from: data)
            }
            .sorted { $0.createdAt > $1.createdAt }
        cachedReviews = Array(loaded.prefix(50))
    }

    // MARK: 薄弱点聚合（来自本地缓存批改的词频，不是模型现编）

    struct WeaknessStat: Identifiable {
        var name: String
        var count: Int
        var id: String { name }
    }

    var topWeaknesses: [WeaknessStat] {
        var counts = [String: Int]()
        for r in cachedReviews {
            for w in r.weaknesses { counts[w, default: 0] += 1 }
        }
        return counts
            .map { WeaknessStat(name: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count }
            .prefix(3)
            .map { $0 }
    }

    // MARK: 工具函数

    static func sha256(_ data: Data) async -> String {
        await Task.detached(priority: .utility) {
            SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }.value
    }
}
