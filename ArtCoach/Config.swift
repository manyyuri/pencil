import Foundation

/// 后端地址：跑 server 后把这里改成启动日志里打印的局域网地址（或 Tailscale 地址）
enum Config {
    static let appVersion = "0.1.0"

    #if DEBUG
    static let baseURL = URL(string: "http://192.168.1.23:4292")!
    #else
    static let baseURL = URL(string: "https://example.ts.net:4292")!
    #endif
}
