import SwiftUI
import PencilKit

/// 自建工具条：铅笔/钢笔/马克笔、色板、笔宽、橡皮、撤销/重做/清空、自动批改开关、手动批改
struct CanvasToolbar: View {
    @Bindable var store: ReviewStore

    private static let palette: [(name: String, color: Color)] = [
        ("石墨", Color(red: 0.1, green: 0.1, blue: 0.1)),
        ("深灰", Color(red: 0.35, green: 0.35, blue: 0.35)),
        ("赭石", Color(red: 0.62, green: 0.32, blue: 0.18)),
        ("群青", Color(red: 0.15, green: 0.27, blue: 0.55)),
        ("深绿", Color(red: 0.12, green: 0.4, blue: 0.24)),
        ("洋红", Color(red: 0.65, green: 0.12, blue: 0.35)),
    ]

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                toolButton(.pencil, label: "铅笔", icon: "pencil.tip")
                toolButton(.pen, label: "钢笔", icon: "pen")
                toolButton(.marker, label: "马克", icon: "highlighter")
                Divider().frame(height: 26)
                Button {
                    store.setErasing(!store.isErasing)
                } label: {
                    Image(systemName: store.isErasing ? "eraser.fill" : "eraser")
                        .font(.system(size: 17))
                        .frame(width: 34, height: 34)
                        .background(store.isErasing ? Color.orange.opacity(0.25) : Color.clear)
                        .cornerRadius(8)
                }
                Divider().frame(height: 26)
                Button { store.undo() } label: { Image(systemName: "arrow.uturn.backward") }
                    .disabled(store.canvasView?.undoManager?.canUndo != true)
                Button { store.redo() } label: { Image(systemName: "arrow.uturn.forward") }
                    .disabled(store.canvasView?.undoManager?.canRedo != true)
                Button(role: .destructive) { store.showingClearConfirm = true } label: {
                    Image(systemName: "trash")
                }
                Spacer()
                Toggle(isOn: $store.autoReviewEnabled) {
                    Text("自动批改").font(.footnote)
                }
                .toggleStyle(.switch)
                .fixedSize()
                Button {
                    Task { await store.requestReview(manual: true) }
                } label: {
                    if store.isUploading {
                        ProgressView().frame(width: 24, height: 24)
                    } else {
                        Text("请老师批改").font(.subheadline.bold())
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isUploading)
            }

            HStack(spacing: 10) {
                ForEach(Self.palette, id: \.name) { item in
                    Button {
                        store.setInkColor(item.color)
                    } label: {
                        Circle()
                            .fill(item.color)
                            .frame(width: 22, height: 22)
                            .overlay(
                                Circle().stroke(
                                    store.inkColorHex == hexString(item.color) ? Color.accentColor : Color.clear,
                                    lineWidth: 3
                                )
                            )
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                Text("笔宽").font(.caption).foregroundStyle(.secondary)
                Slider(value: $store.inkWidth, in: 2...24, step: 1) {
                    Text("笔宽")
                }
                .frame(maxWidth: 220)
                Text(String(format: "%.0f", store.inkWidth))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: 24, alignment: .trailing)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
        .confirmationDialog("清空画布？本次作画数据将一并清除", isPresented: $store.showingClearConfirm) {
            Button("清空", role: .destructive) { store.clearCanvas() }
            Button("取消", role: .cancel) {}
        }
    }

    private func toolButton(_ kind: InkKind, label: String, icon: String) -> some View {
        Button {
            store.setInkKind(kind)
        } label: {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.system(size: 16))
                Text(label).font(.system(size: 9))
            }
            .frame(width: 44, height: 40)
            .background(
                (!store.isErasing && store.inkKind == kind)
                    ? Color.accentColor.opacity(0.2)
                    : Color.clear
            )
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    private func hexString(_ c: Color) -> String {
        ReviewStore.hexString(c)
    }
}
