import SwiftUI

/// 历史作业列表 + 详情回看
struct ArchiveView: View {
    @Bindable var store: ReviewStore

    var body: some View {
        NavigationStack {
            List {
                Section {
                    WeaknessChart(store: store)
                } header: {
                    Text("最近薄弱点（本地缓存词频统计）")
                }

                Section {
                    ForEach(store.history) { item in
                        NavigationLink {
                            ReviewDetailView(store: store, reviewId: item.reviewId)
                        } label: {
                            HistoryRow(item: item)
                        }
                    }
                    if store.historyNextCursor != nil {
                        Button("加载更多") {
                            Task { await store.loadMoreHistory() }
                        }
                    }
                    if store.history.isEmpty && !store.isLoadingHistory {
                        Text("还没有批改记录。去「练习」页画一张吧。")
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("历史作业")
                }
            }
            .refreshable { await store.loadHistory() }
            .task { await store.loadHistory() }
            .navigationTitle("学习档案")
        }
    }
}

private struct HistoryRow: View {
    var item: HistoryItem

    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: URL(string: item.thumbUrl)) { phase in
                if let img = phase.image {
                    img.resizable().scaledToFill()
                } else {
                    Color.gray.opacity(0.15)
                }
            }
            .frame(width: 64, height: 48)
            .cornerRadius(6)
            .clipped()

            VStack(alignment: .leading, spacing: 3) {
                Text(shortDate(item.createdAt)).font(.caption).foregroundStyle(.secondary)
                Text(item.summary).font(.footnote).lineLimit(2)
                HStack(spacing: 6) {
                    miniScore("造", item.scores.shape)
                    miniScore("明", item.scores.value)
                    miniScore("线", item.scores.line)
                    miniScore("完", item.scores.completeness)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func miniScore(_ label: String, _ v: Int) -> some View {
        Text("\(label)\(v)")
            .font(.caption2.monospacedDigit())
            .foregroundStyle(v >= 80 ? .green : (v >= 60 ? .accentColor : .orange))
    }

    private func shortDate(_ iso: String) -> String {
        String(iso.prefix(16).replacingOccurrences(of: "T", with: " "))
    }
}

// MARK: - 详情回看

struct ReviewDetailView: View {
    var store: ReviewStore
    let reviewId: String

    @State private var detail: ReviewResponse?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let d = detail {
                    if let urlStr = d.imageUrl, let url = URL(string: urlStr) {
                        AsyncImage(url: url) { phase in
                            if let img = phase.image {
                                img.resizable().scaledToFit().cornerRadius(8)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Text(d.summary).font(.body.bold())

                    HStack(spacing: 8) {
                        score("造型", d.scores.shape)
                        score("明暗", d.scores.value)
                        score("排线", d.scores.line)
                        score("完成", d.scores.completeness)
                    }

                    ForEach(d.sections) { s in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(s.title).font(.subheadline.bold())
                            Text(s.comment).font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(8)
                        .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                    }

                    if d.degraded {
                        Text("该次批改为纯规则降级版（当时未配置视觉模型）")
                            .font(.caption2).foregroundStyle(.orange)
                    }
                } else {
                    ProgressView("加载批改详情…").frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding()
        }
        .navigationTitle("作业回看")
        .navigationBarTitleDisplayMode(.inline)
        .task { detail = await store.reviewDetail(id: reviewId) }
    }

    private func score(_ label: String, _ v: Int) -> some View {
        VStack {
            Text("\(v)").font(.title2.monospacedDigit().bold())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color.gray.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}
