import Foundation
import CryptoKit

/// 上传闸门（seam）：裁决"这份画布内容现在该不该发"。
/// 接口只有三条：submit（裁决）/ markSent（成功后记账）/ reset（清空画布时重置）。
/// 藏在里面的实现：SHA256 内容指纹、与上次已发送内容的比对（去重）、
/// 20 秒节流窗口、以及"内容变了但还在窗口内 → 挂起 20s 自动重试"。
///
/// 纯 Foundation + CryptoKit，不碰 SwiftUI/PencilKit —— 测试面就是这条接口。
@MainActor
final class UploadGate {

    enum Decision: Equatable {
        case send       // 内容变了且已出节流窗口 → 现在发
        case dedupe     // 内容与上次成功发送相同 → 不发
        case retryLater // 内容变了但距上次发送 <20s → 闸门已自动挂起重试，调用方什么都不用做
    }

    @ObservationIgnored private var lastSentHash: String?
    @ObservationIgnored private var lastSentAt: Date?
    private let throttleWindow: TimeInterval
    private let retryScheduler: ReviewScheduler
    private let onRetry: () -> Void

    /// - Parameters:
    ///   - throttleWindow: 两次成功发送的最小间隔（默认 20s）
    ///   - retryDelay: 窗口内命中时节流重试的等待时长
    ///   - onRetry: 等待期满后回调（主线程），通常重新走一遍 submit
    init(
        throttleWindow: TimeInterval = 20,
        retryDelay: TimeInterval = 20,
        onRetry: @escaping () -> Void
    ) {
        self.throttleWindow = throttleWindow
        self.retryScheduler = ReviewScheduler(delay: retryDelay)
        self.onRetry = onRetry
    }

    func submit(_ data: Data) async -> Decision {
        let hash = await Self.sha256(data)
        guard hash != lastSentHash else { return .dedupe }
        if let last = lastSentAt, Date().timeIntervalSince(last) < throttleWindow {
            retryScheduler.schedule { [onRetry] in onRetry() }
            return .retryLater
        }
        return .send
    }

    /// 只在发送**成功**后记账；失败不记（下次会再发）。
    /// 记账的是本次实际发送的那份 Data（快照），不是"此刻画布"——
    /// 否则批改期间新画的笔画会被误判为已发送。
    func markSent(_ sentData: Data) async {
        lastSentAt = Date()
        lastSentHash = await Self.sha256(sentData)
    }

    func reset() {
        lastSentHash = nil
        lastSentAt = nil
        retryScheduler.cancel()
    }

    /// 内容指纹，utility 优先级后台算，不占主线程
    static func sha256(_ data: Data) async -> String {
        await Task.detached(priority: .utility) {
            SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }.value
    }
}
