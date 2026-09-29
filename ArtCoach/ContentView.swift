import SwiftUI

struct ContentView: View {
    @State private var store = ReviewStore()

    var body: some View {
        TabView {
            PracticeView(store: store)
                .tabItem { Label("练习", systemImage: "pencil.tip.crop.circle") }
            ArchiveView(store: store)
                .tabItem { Label("档案", systemImage: "folder") }
        }
    }
}

// MARK: - 练习页：工具栏 + 任务条 + 画布 + 批语面板

struct PracticeView: View {
    @Bindable var store: ReviewStore

    var body: some View {
        VStack(spacing: 0) {
            CanvasToolbar(store: store)

            if let assignment = store.currentAssignment {
                AssignmentBanner(store: store, assignment: assignment)
            }

            ZStack {
                Color.white
                TracingLayer(store: store)
                GeometryReader { geo in
                    CanvasView(
                        drawing: $store.drawing,
                        store: store,
                        tool: store.currentTool
                    )
                    .onAppear { store.canvasSize = geo.size }
                    .onChange(of: geo.size) { _, newSize in
                        store.canvasSize = newSize
                    }
                }
            }
            .clipped()

            CritiquePanel(store: store)
        }
    }
}

// MARK: - 任务条：当前练习 + 临摹底图透明度

private struct AssignmentBanner: View {
    @Bindable var store: ReviewStore
    var assignment: AssignmentDetail

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "graduationcap.fill").foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 1) {
                    Text(assignment.title).font(.footnote.bold()).lineLimit(1)
                    Text(assignment.goal).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text("\(assignment.durationMin) 分钟").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Button("结束练习") { store.finishAssignment() }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
            }

            if store.tracingURL != nil {
                HStack(spacing: 8) {
                    Toggle("临摹底图", isOn: $store.tracingVisible)
                        .font(.caption)
                        .fixedSize()
                    Slider(value: $store.tracingOpacity, in: 0.1...0.8)
                    Text(String(format: "%.0f%%", store.tracingOpacity * 100))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 40, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(Color.accentColor.opacity(0.07))
    }
}
