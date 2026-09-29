import SwiftUI

/// 临摹底图：画布 ZStack 下层的半透明参考图。
/// ⚠️ 底图不进入 PKCanvasView.drawing，批改上传的 PNG 只含学生笔迹。
struct TracingLayer: View {
    @Bindable var store: ReviewStore

    var body: some View {
        if store.tracingVisible, let url = store.tracingURL {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image
                        .resizable()
                        .scaledToFit()
                        .opacity(store.tracingOpacity)
                        .allowsHitTesting(false)
                }
            }
        }
    }
}
