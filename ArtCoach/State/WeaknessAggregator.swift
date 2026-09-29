import Foundation

/// 薄弱点聚合（纯函数）：从历史批改里数 weaknesses 词频，取 Top N。
/// 返回结果、不产生副作用；输入只是 [ReviewResponse]，fixture JSON 即可测。
/// 注意：词频来自规则层产出的 weaknesses，不是模型现编。
enum WeaknessAggregator {

    struct Stat: Identifiable, Equatable {
        let name: String
        let count: Int
        var id: String { name }
    }

    static func aggregate(_ reviews: [ReviewResponse], top: Int = 3) -> [Stat] {
        var counts = [String: Int]()
        for r in reviews {
            for w in r.weaknesses { counts[w, default: 0] += 1 }
        }
        return counts
            .map { Stat(name: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count }
            .prefix(top)
            .map { $0 }
    }
}
