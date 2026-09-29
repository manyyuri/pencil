# 第三方依赖

## iOS 端

零第三方依赖。仅使用系统框架：SwiftUI / PencilKit / UIKit / CryptoKit / CoreGraphics / ImageIO。

## 服务端（server/package.json）

| 包 | 用途 |
|---|---|
| express@5 | HTTP 服务 |
| multer | multipart/form-data 解析（图片上传） |
| sharp | 参考 SVG 光栅化为 PNG |
| zod | 请求校验 |
| openai | 视觉模型调用（OpenAI 兼容协议） |

开发依赖：typescript / tsx / @types/* / vitest。

## 模型服务

- 视觉模型经 OpenAI 兼容网关调用（key 从本机 `~/.pi/agent/models.json` 读取，不入库）
- 未配置时自动降级为纯规则批改，无任何外部依赖
