import Foundation

// MARK: - 上传 meta（spec 5.1）

struct Meta: Codable {
    var appVersion: String
    var deviceModel: String
    var systemVersion: String
    var canvasSize: CanvasSize
    var scale: Double
    var taskId: String?
    var durationSec: Int
    var startedAt: String
    var finishedAt: String

    struct CanvasSize: Codable {
        var width: Double
        var height: Double
    }
}

// MARK: - 批改响应（spec 5.2）

struct ReviewResponse: Codable {
    var ok: Bool?
    var reviewId: String
    var createdAt: String
    var imageUrl: String?
    var summary: String
    var scores: Scores
    var sections: [Section]
    var metrics: Metrics
    var weaknesses: [String]
    var nextAssignment: NextAssignment
    var degraded: Bool

    struct Scores: Codable {
        var shape: Int
        var value: Int
        var line: Int
        var completeness: Int
    }

    struct Section: Codable, Identifiable {
        var key: String
        var title: String
        var verdict: String
        var comment: String
        var evidence: [String]
        var id: String { key + "-" + title }
    }

    struct Metrics: Codable {
        var strokeCount: Int?
        var forceAvailable: Bool?
        var avgForce: Double?
        var forceContrast: Double?
        var hatchAngleStdDeg: Double?
        var reworkRegions: Int?
        var earlyDetailRatio: Double?
        var rhythmPauses: Int?
        var completion: Double?
        var hueBuckets: [Int]?
        var avgSaturation: Double?
        var avgValue: Double?
        var warmRatio: Double?
        var neutralRatio: Double?
        var dominantColors: [DominantColor]?
    }

    struct DominantColor: Codable {
        var hex: String
        var ratio: Double
    }

    struct NextAssignment: Codable {
        var id: String
        var title: String
        var goal: String
        var durationMin: Int
        var referenceImageUrl: String?
    }
}

// MARK: - 历史列表（spec 5.3）

struct HistoryResponse: Codable {
    var ok: Bool
    var items: [HistoryItem]
    var nextCursor: String?
}

struct HistoryItem: Codable, Identifiable, Hashable {
    var reviewId: String
    var createdAt: String
    var summary: String
    var scores: ReviewResponse.Scores
    var thumbUrl: String
    var id: String { reviewId }
}

// MARK: - 任务详情（spec 5.3）

struct AssignmentDetail: Codable, Identifiable {
    var ok: Bool
    var id: String
    var title: String
    var goal: String
    var steps: [String]
    var durationMin: Int
    var referenceImageUrl: String?
}

// MARK: - 工具

enum DeviceInfo {
    /// 例如 "iPad14,3"
    static var model: String {
        var sys = utsname()
        uname(&sys)
        let mirror = Mirror(reflecting: sys.machine)
        return mirror.children.reduce(into: "") { acc, child in
            guard let value = child.value as? Int8, value != 0 else { return }
            acc.append(Character(UnicodeScalar(UInt8(value))))
        }
    }
}
