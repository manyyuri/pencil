/**
 * toInkML —— 笔迹 JSON → W3C InkML（开发期调试用，语义对齐 spec 5.4）。
 * 暴露为 GET /api/critic/review/:id/inkml，便于将来接标注工具 / 换客户端零迁移。
 * 转换字段口径参考 npm 包 neo-inkml（MIT）的 trace 通道写法。
 */
import type { StrokesPayload } from './strokeAnalyzer.ts';

export function toInkML(payload: StrokesPayload): string {
  const traces = payload.strokes
    .map((s) => {
      const pts = s.pts
        .map((p) => `${p.t.toFixed(3)},${p.x.toFixed(1)},${p.y.toFixed(1)},${p.f.toFixed(3)},${p.az.toFixed(4)},${p.al.toFixed(4)}`)
        .join(', ');
      return `    <trace id="${s.i}" type="pen" contextRef="#ctx">${pts}</trace>`;
    })
    .join('\n');

  const channels = 'time, X, Y, F, azimuth, altitude';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ink xmlns="http://www.w3.org/2003/InkML">
  <annotation type="source">art-coach-pencil</annotation>
  <annotationXML type="canvas" xml:id="canvas" x="${payload.canvas.width}" y="${payload.canvas.height}" scale="${payload.canvas.scale}"/>
  <traceFormat>
${channels
  .split(', ')
  .map((c) => `    <channel name="${c}" type="${c === 'time' || c === 'X' || c === 'Y' ? 'decimal' : 'decimal'}"/>`)
  .join('\n')}
  </traceFormat>
  <inkSource xml:id="src">
    <traceFormat ref="#tf"/>
  </inkSource>
  <context xml:id="ctx" inkSourceRef="#src"/>
${traces}
</ink>
`;
}
