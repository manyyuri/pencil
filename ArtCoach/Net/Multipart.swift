import Foundation

/// 手搓 multipart/form-data（只服务本项目三个 part，够小够透明）
enum Multipart {
    final class Builder {
        private let boundary: String
        private var body = Data()
        private let crlf = Data("\r\n".utf8)

        init(boundary: String) {
            self.boundary = boundary
        }

        func file(name: String, filename: String, mime: String, data: Data) {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
            append("Content-Type: \(mime)\r\n\r\n")
            body.append(data)
            append("\r\n")
        }

        func text(name: String, value: String) {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            append(value)
            append("\r\n")
        }

        func finalize() -> Data {
            append("--\(boundary)--\r\n")
            return body
        }

        private func append(_ s: String) {
            body.append(Data(s.utf8))
        }
    }

    static func build(boundary: String, fill: (Builder) -> Void) -> Data {
        let b = Builder(boundary: boundary)
        fill(b)
        return b.finalize()
    }
}
