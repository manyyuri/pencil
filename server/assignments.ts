/**
 * 下一课任务库 —— 手写 10 条（可解释、可测试；不靠模型现编）。
 * pickAssignment 按"薄弱点 → 训练目标"的确定性映射选题，并避开刚做完的任务。
 * 部分任务带程序生成的参考底图（refs/<id>.png，由 index.ts 启动时用 sharp 光栅化 SVG 生成）。
 */

export interface Assignment {
  id: string;
  title: string;
  goal: string;
  steps: string[];
  durationMin: number;
  trains: ('shape' | 'value' | 'line' | 'completeness' | 'process')[];
  /** 需要生成参考底图（refs/<id>.png） */
  refSvg?: string;
}

const sphereSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs>
    <radialGradient id="b" cx="0.36" cy="0.32" r="0.9">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.28" stop-color="#d8d8d8"/>
      <stop offset="0.55" stop-color="#8a8a8a"/><stop offset="0.78" stop-color="#3c3c3c"/><stop offset="1" stop-color="#141414"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="#ffffff"/>
  <ellipse cx="512" cy="820" rx="300" ry="60" fill="#000000" opacity="0.25"/>
  <circle cx="512" cy="470" r="330" fill="url(#b)" stroke="#111" stroke-width="3"/>
</svg>`;

const hatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#ffffff"/>
  ${Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => `<rect x="${24 + c * 122}" y="${24 + r * 122}" width="110" height="110" fill="none" stroke="#999" stroke-width="2"/>`)
  ).join('')}
  ${Array.from({ length: 40 }, (_, k) => {
    const x = 24 + (k % 8) * 122;
    const y = 24 + Math.floor(k / 8) * 122;
    return Array.from({ length: 6 }, (_, i) => {
      const off = i * 18;
      return `<line x1="${x + off}" y1="${y}" x2="${x}" y2="${y + off}" stroke="#333" stroke-width="4"/>`;
    }).join('');
  }).join('')}
</svg>`;

const cubeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#ffffff"/>
  <polygon points="512,180 830,400 830,760 512,980 194,760 194,400" fill="#f2f2f2" stroke="#111" stroke-width="4"/>
  <polygon points="512,180 830,400 512,620 194,400" fill="#ffffff" stroke="#111" stroke-width="4"/>
  <polygon points="194,400 512,620 512,980 194,760" fill="#c9c9c9" stroke="#111" stroke-width="4"/>
  <polygon points="512,620 830,400 830,760 512,980" fill="#5e5e5e" stroke="#111" stroke-width="4"/>
  <ellipse cx="512" cy="1000" rx="330" ry="26" fill="#000" opacity="0.2"/>
</svg>`;

const twoValueSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#ffffff"/>
  <circle cx="380" cy="420" r="230" fill="#111"/>
  <rect x="560" y="560" width="300" height="240" fill="#111"/>
  <text x="512" y="950" font-size="34" fill="#666" text-anchor="middle" font-family="sans-serif">只分黑白两个值，不许排中间调</text>
</svg>`;

export const ASSIGNMENTS: Assignment[] = [
  {
    id: 'blockin-first-01',
    title: '起稿纪律：15 分钟只画大外形',
    goal: '治"过早抠细节"——前 15 分钟只允许画长直线大形，禁止任何细节',
    steps: [
      '整组静物用 5-7 条长直线框出外轮廓（每条线一笔到位，不描）',
      '标出每个物体的最高/最低/最左/最右点',
      '比较物体之间的比例关系，允许修改但只擦大形',
      '15 分钟一到立刻停笔拍照上传',
    ],
    durationMin: 15,
    trains: ['process', 'shape'],
  },
  {
    id: 'still-life-apple-01',
    title: '单个苹果全因素素描',
    goal: '综合练习：把造型、明暗、投影一次画完整',
    steps: [
      '先用 4 条直线切出苹果的外形（宁方勿圆）',
      '定明暗交界线位置，从交界线开始铺暗部',
      '画出投影方向与形状',
      '最后 5 分钟再刻画果柄与高光',
    ],
    durationMin: 30,
    trains: ['shape', 'value', 'completeness'],
  },
  {
    id: 'value-sphere-02',
    title: '单球体明暗：三调子排线',
    goal: '把亮部与暗部的压感差拉到 0.25 以上',
    steps: [
      '起稿画出球体轮廓与投影方向',
      '亮部：笔尖轻、排线稀（压感 <0.3）',
      '明暗交界线到暗部：加重下笔（压感 >0.5）',
      '反光留一口气，不要画死黑',
    ],
    durationMin: 25,
    trains: ['value'],
    refSvg: sphereSvg,
  },
  {
    id: 'hatch-grid-03',
    title: '排线格子：同一方向排满 64 格',
    goal: '把排线角度方差压到 12° 以内',
    steps: [
      '按参考图 8×8 格子，每格只朝一个方向排线',
      '手腕锁定，用手臂带动，一笔一笔排满',
      '整张所有格子保持约 30° 同一方向',
      '换方向再做一张（-30°）',
    ],
    durationMin: 20,
    trains: ['line'],
    refSvg: hatchSvg,
  },
  {
    id: 'two-value-study-04',
    title: '黑白两值剪影练习',
    goal: '先敢把暗部压黑——治"画面发灰"',
    steps: [
      '把参考的两个图形看作剪影，直接涂满纯黑',
      '只允许黑和白两个值，不许排中间调',
      '检查边缘是否果断、形状是否准确',
    ],
    durationMin: 15,
    trains: ['value'],
    refSvg: twoValueSvg,
  },
  {
    id: 'gesture-light-05',
    title: '五分钟动势速写 × 6',
    goal: '治"反复涂改"——每张只画 5 分钟，不许修改',
    steps: [
      '任意物体/人物，5 分钟一张，共 6 张',
      '只抓动势与比例，禁止橡皮',
      '画错就留着，下一张更准',
    ],
    durationMin: 30,
    trains: ['process'],
  },
  {
    id: 'timed-gesture-06',
    title: '限时节奏：25 分钟三张速写',
    goal: '建立"观察-落笔-推进"的节奏，减少长时间停顿纠结',
    steps: [
      '每张 8 分钟，闹钟一响立刻换纸',
      '第一张抓大形，第二张加明暗，第三张加一点细节',
      '全程不许停下来超过 30 秒',
    ],
    durationMin: 25,
    trains: ['process', 'completeness'],
  },
  {
    id: 'cube-perspective-07',
    title: '立方体两点透视',
    goal: '建立体积意识：三个面的透视与明暗拉开',
    steps: [
      '按参考图起稿，两个消失方向保持一致',
      '亮/灰/暗三个面明度差拉开（暗面至少比灰面重 2 档）',
      '投影方向与光源一致',
    ],
    durationMin: 25,
    trains: ['shape', 'value'],
    refSvg: cubeSvg,
  },
  {
    id: 'edge-control-08',
    title: '软硬边练习：明暗交界线过渡',
    goal: '控制边缘虚实——交界线实、反光虚、投影前实后虚',
    steps: [
      '画一个球加一个方体组合',
      '明暗交界线用清晰的硬边',
      '反光与远处投影用侧锋虚化',
      '对比参考图检查三处虚实',
    ],
    durationMin: 30,
    trains: ['value', 'line'],
    refSvg: sphereSvg,
  },
  {
    id: 'portrait-blockin-09',
    title: '头像大形起稿（不画五官）',
    goal: '头骨大形与三庭比例，忍住不画细节',
    steps: [
      '只画头型、发际线、下颌结构',
      '标记三庭五眼位置线，不画具体五官',
      '整体检查头颈肩关系',
    ],
    durationMin: 20,
    trains: ['shape', 'process'],
  },
  {
    id: 'warm-cool-pair-10',
    title: '冷暖对比：两色静物',
    goal: '用互补色拉开冷暖（如橙子 + 蓝衬布）',
    steps: [
      '主体用暖色（橙红），衬布用冷色（蓝绿）',
      '先铺大面积色块，不留白',
      '检查暖色占比是否 > 50%',
      '最后点少量环境色',
    ],
    durationMin: 30,
    trains: ['value', 'completeness'],
  },
];

/** 薄弱点（evidence tag 或弱点文案）→ 任务的确定性映射 */
const WEAKNESS_MAP: { match: RegExp; id: string }[] = [
  { match: /force-contrast-low|明暗对比不足|画面发灰|value-compressed/, id: 'value-sphere-02' },
  { match: /hatch-angle-scatter|排线|线条杂乱/, id: 'hatch-grid-03' },
  { match: /early-detail|过早抠细节/, id: 'blockin-first-01' },
  { match: /rework-many|反复涂改/, id: 'gesture-light-05' },
  { match: /rhythm-scattered|节奏/, id: 'timed-gesture-06' },
  { match: /coverage-low|完成度低|构图偏小/, id: 'still-life-apple-01' },
  { match: /造型|比例|shape/, id: 'cube-perspective-07' },
  { match: /冷暖|色彩|warm/, id: 'warm-cool-pair-10' },
];

export function getAssignment(id: string): Assignment | undefined {
  return ASSIGNMENTS.find((a) => a.id === id);
}

/** 按薄弱点选下一课（确定性；避开刚做完的任务） */
export function pickAssignment(weaknesses: string[], lastTaskId: string | null): Assignment {
  const ranked: string[] = [];
  for (const w of weaknesses) {
    for (const { match, id } of WEAKNESS_MAP) {
      if (match.test(w) && !ranked.includes(id)) ranked.push(id);
    }
  }
  const fallback = ['value-sphere-02', 'blockin-first-01', 'still-life-apple-01', 'hatch-grid-03'];
  for (const f of fallback) if (!ranked.includes(f)) ranked.push(f);
  const pick = ranked.find((id) => id !== lastTaskId) ?? ranked[0]!;
  return getAssignment(pick)!;
}
