import SwiftUI

/// 批语面板：总评 + 四维评分 + 分段卡片 + 过程指标 + 下一课
struct CritiquePanel: View {
    @Bindable var store: ReviewStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header

            if let err = store.lastError {
                Text(err).font(.footnote).foregroundStyle(.red)
            }

            if let review = store.review {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(review.summary)
                            .font(.body.bold())
                            .fixedSize(horizontal: false, vertical: true)

                        scoreRow(review.scores)

                        ForEach(review.sections) { section in
                            sectionCard(section)
                        }

                        metricsGrid(review.metrics)

                        nextAssignmentCard(review.nextAssignment)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Text("画完点「请老师批改」，或停笔 3 秒自动批改。批改 = 视觉模型看图 + 笔迹过程指标。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: 300, alignment: .topLeading)
        .background(.thinMaterial)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("老师批语").font(.headline)
            if store.isUploading {
                HStack(spacing: 4) {
                    ProgressView().controlSize(.small)
                    Text("老师正在看…").font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let review = store.review, review.degraded {
                Text("离线规则版")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.orange.opacity(0.2))
                    .cornerRadius(4)
            }
            Spacer()
            if let review = store.review {
                Text(shortDate(review.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func scoreRow(_ scores: ReviewResponse.Scores) -> some View {
        HStack(spacing: 8) {
            scoreChip("造型", scores.shape)
            scoreChip("明暗", scores.value)
            scoreChip("排线", scores.line)
            scoreChip("完成", scores.completeness)
        }
    }

    private func scoreChip(_ label: String, _ value: Int) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title3.monospacedDigit().bold())
                .foregroundStyle(valueColor(value))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(8)
    }

    private func valueColor(_ v: Int) -> Color {
        switch v {
        case 80...: return .green
        case 60..<80: return .accentColor
        case 40..<60: return .orange
        default: return .red
        }

    }

    private func verdictColor(_ verdict: String) -> Color {
        switch verdict {
        case "good": return .green
        case "ok": return .blue
        default: return .orange
        }
    }

    private func sectionCard(_ s: ReviewResponse.Section) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(s.title).font(.subheadline.bold())
                Spacer()
                Text(verdictLabel(s.verdict))
                    .font(.caption.bold())
                    .foregroundStyle(verdictColor(s.verdict))
            }
            Text(s.comment).font(.footnote).fixedSize(horizontal: false, vertical: true)
            if !s.evidence.isEmpty {
                Text(s.evidence.joined(separator: " · "))
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(10)
        .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func verdictLabel(_ v: String) -> String {
        switch v {
        case "good": return "达标"
        case "ok": return "基本可以"
        default: return "需改进"
        }
    }

    private func metricsGrid(_ m: ReviewResponse.Metrics) -> some View {
        let items: [(String, String)] = [
            m.strokeCount.map { ("笔数", "\($0)") },
            m.avgForce.map { ("平均压感", String(format: "%.2f", $0)) },
            m.forceContrast.map { ("明暗压感差", String(format: "%.2f", $0)) },
            m.hatchAngleStdDeg.map { ("排线方差", String(format: "%.1f°", $0)) },
            m.reworkRegions.map { ("涂改区域", "\($0)") },
            m.earlyDetailRatio.map { ("早期抠细节", String(format: "%.0f%%", $0 * 100)) },
            m.completion.map { ("画面覆盖", String(format: "%.0f%%", $0 * 100)) },
            m.warmRatio.map { ("暖色占比", String(format: "%.0f%%", $0 * 100)) },
        ].compactMap { $0 }
        guard !items.isEmpty else { return AnyView(EmptyView()) }
        return AnyView(
            VStack(alignment: .leading, spacing: 4) {
                Text("过程指标（确定性计算）").font(.caption.bold()).foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))], alignment: .leading, spacing: 4) {
                    ForEach(items, id: \.0) { label, value in
                        VStack(spacing: 1) {
                            Text(value).font(.footnote.monospacedDigit().bold())
                            Text(label).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        )
    }

    private func nextAssignmentCard(_ a: ReviewResponse.NextAssignment) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("下一课", systemImage: "graduationcap.fill").font(.caption.bold()).foregroundStyle(.secondary)
            Text(a.title).font(.subheadline.bold())
            Text(a.goal).font(.footnote).foregroundStyle(.secondary)
            HStack {
                Label("\(a.durationMin) 分钟", systemImage: "clock").font(.caption)
                Spacer()
                Button("开始练习") {
                    Task { await store.startAssignment(a.id) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .padding(10)
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private func shortDate(_ iso: String) -> String {
        String(iso.prefix(10))
    }
}
