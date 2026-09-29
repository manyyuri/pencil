import Foundation

enum APIError: LocalizedError {
    case badStatus(Int)
    case decode(String)

    var errorDescription: String? {
        switch self {
        case .badStatus(let code): return "服务返回错误状态码 \(code)"
        case .decode(let msg): return "响应解析失败：\(msg)"
        }
    }
}

/// 网络层（actor：全部 async/await，绝不在主线程做重活）
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession

    init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 150 // VL 模型推理可能要几十秒
        cfg.timeoutIntervalForResource = 300
        session = URLSession(configuration: cfg)
    }

    // MARK: POST /api/critic/review（multipart）

    func review(image: Data, strokes: Data?, colorStats: Data?, meta: Meta) async throws -> ReviewResponse {
        var req = URLRequest(url: Endpoints.review())
        req.httpMethod = "POST"
        let boundary = "Boundary-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let metaJSON: String
        do {
            metaJSON = String(data: try JSONEncoder().encode(meta), encoding: .utf8) ?? "{}"
        } catch {
            throw APIError.decode("meta 编码失败: \(error.localizedDescription)")
        }

        req.httpBody = Multipart.build(boundary: boundary) { m in
            m.file(name: "image", filename: "canvas.png", mime: "image/png", data: image)
            if let s = strokes {
                m.file(name: "strokes", filename: "strokes.json", mime: "application/json", data: s)
            }
            if let c = colorStats {
                m.file(name: "colorStats", filename: "color.json", mime: "application/json", data: c)
            }
            m.text(name: "meta", value: metaJSON)
        }

        return try await send(req, as: ReviewResponse.self)
    }

    // MARK: GET 档案类接口

    func history(limit: Int = 20, cursor: String? = nil) async throws -> HistoryResponse {
        try await send(URLRequest(url: Endpoints.history(limit: limit, cursor: cursor)), as: HistoryResponse.self)
    }

    func reviewDetail(id: String) async throws -> ReviewResponse {
        try await send(URLRequest(url: Endpoints.reviewDetail(id: id)), as: ReviewResponse.self)
    }

    func assignment(id: String) async throws -> AssignmentDetail {
        try await send(URLRequest(url: Endpoints.assignment(id: id)), as: AssignmentDetail.self)
    }

    // MARK: 底层

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError.badStatus(code)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decode("\(type)：\(error.localizedDescription)")
        }
    }
}
