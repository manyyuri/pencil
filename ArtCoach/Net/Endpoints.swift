import Foundation

/// 接口地址（契约见 spec 第 5 节）
enum Endpoints {
    static func review() -> URL { Config.baseURL.appendingPathComponent("api/critic/review") }
    static func history(limit: Int, cursor: String?) -> URL {
        var comp = URLComponents(
            url: Config.baseURL.appendingPathComponent("api/critic/history"),
            resolvingAgainstBaseURL: false
        )!
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let c = cursor, !c.isEmpty { items.append(URLQueryItem(name: "cursor", value: c)) }
        comp.queryItems = items
        return comp.url!
    }
    static func reviewDetail(id: String) -> URL {
        Config.baseURL.appendingPathComponent("api/critic/review/\(id)")
    }
    static func assignment(id: String) -> URL {
        Config.baseURL.appendingPathComponent("api/critic/assignment/\(id)")
    }
}
