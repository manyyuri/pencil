import SwiftUI
import PencilKit

/// SwiftUI ↔ PencilKit 桥。
/// tool 由父视图在 body 里读取（store.currentTool），保证工具切换必然触发 updateUIView。
/// Coordinator 负责：笔迹起笔打点、停笔 debounce、canvas 注册（供撤销/重做/清空）。
struct CanvasView: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    var store: ReviewStore
    var tool: PKTool
    var isEditable: Bool = true

    func makeUIView(context: Context) -> PKCanvasView {
        let v = PKCanvasView()
        v.backgroundColor = .white // 白底：导出省合成
        v.isOpaque = true
        v.delegate = context.coordinator
        v.tool = tool
        store.canvasView = v

        #if DEBUG
        v.drawingPolicy = .anyInput // 模拟器/手指可画（调试）
        #else
        v.drawingPolicy = .pencilOnly // 正式：防手掌误触
        #endif

        // 撤销/重做 → 重建 inkStartMs 映射（索引整体前移，只能近似截断）
        let center = NotificationCenter.default
        context.coordinator.undoTokens = [
            center.addObserver(forName: .NSUndoManagerDidUndoChange, object: v.undoManager, queue: .main) { [weak store] _ in
                store?.rebuildInkMapAfterUndo()
            },
            center.addObserver(forName: .NSUndoManagerDidRedoChange, object: v.undoManager, queue: .main) { [weak store] _ in
                store?.rebuildInkMapAfterUndo()
            },
        ]
        return v
    }

    func updateUIView(_ v: PKCanvasView, context: Context) {
        context.coordinator.parent = self
        // PKTool 跨实例 isEqual 不可靠，直接赋值（PencilKit 内部开销极小）
        v.tool = tool
        v.isUserInteractionEnabled = isEditable
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: CanvasView
        var undoTokens: [NSObjectProtocol] = []

        init(_ p: CanvasView) { parent = p }

        deinit {
            for t in undoTokens { NotificationCenter.default.removeObserver(t) }
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            parent.drawing = canvasView.drawing
            StrokeCollector.noteStartIfNeeded(
                canvasView.drawing,
                into: &parent.store.inkStartMs,
                since: parent.store.sessionStart
            )
            guard parent.store.autoReviewEnabled else { return }
            parent.store.scheduler.schedule { [weak store = parent.store] in
                guard let store else { return }
                Task { @MainActor in await store.uploadIfChanged() }
            }
        }
    }
}
