import SwiftUI

/// 薄弱点 Top3 条形图（数据来自本地缓存的历史批改 weaknesses 词频，不是模型现编）
struct WeaknessChart: View {
    var store: ReviewStore

    var body: some View {
        let stats = store.topWeaknesses
        VStack(alignment: .leading, spacing: 8) {
            if stats.isEmpty {
                Text("批改积累后，这里会显示最常被指出的 3 个问题。")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                ForEach(stats) { stat in
                    HStack(spacing: 8) {
                        Text(stat.name)
                            .font(.footnote)
                            .frame(width: 110, alignment: .leading)
                            .lineLimit(1)
                        GeometryReader { geo in
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.orange.opacity(0.75))
                                .frame(width: geo.size.width * barFraction(stat.count, max: stats.first?.count ?? 1))
                                .frame(maxHeight: .infinity, alignment: .center)
                                .frame(height: 10)
                        }
                        Text("\(stat.count) 次")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 46, alignment: .trailing)
                    }
                    .frame(height: 18)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func barFraction(_ count: Int, max: Int) -> CGFloat {
        guard max > 0 else { return 0 }
        return CGFloat(count) / CGFloat(max)
    }
}
