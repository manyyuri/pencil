import Foundation

/// 停笔 debounce（spec 8.3）：3 秒无新笔画 → 触发一次上传判定。
/// 去重/节流（内容 SHA256 未变不发、距上次 <20s 不发）由 ReviewStore.uploadIfChanged 负责。
final class ReviewScheduler {
    private var work: DispatchWorkItem?
    private let delay: TimeInterval

    init(delay: TimeInterval = 3.0) {
        self.delay = delay
    }

    func schedule(_ action: @escaping () -> Void) {
        work?.cancel()
        let item = DispatchWorkItem(block: action)
        work = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    func cancel() {
        work?.cancel()
        work = nil
    }
}
