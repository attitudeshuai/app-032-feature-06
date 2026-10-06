/**
 * 统一构件位置模型（表、预览图、备料、导出、本机存档共用同一份位置）
 *
 * 位置编号约定（同一套编号，不许断号、不许重号）：
 *  - 层 layer：截面（圈）自底向上 0..L 编号——底盘圈是第 0 层（底口），
 *    中间横篾圈是第 1..L-1 层，上口圈是第 L 层（上口，L = 分段数 = 最高截面）；
 *    竖篾/母线沿第 1..L 段全长。
 *  - 棱 edge：绕灯体一周自正北（俯视图 12 点钟方向）起顺时针 1..N；
 *    竖篾/母线篾 j 位于第 j 号棱上；横篾圈第 j 根是第 j 号棱与第 j+1 号棱之间那一段
 *   （第 N 根接回第 1 号棱，首尾相接）。
 *  - 旋转体母线根数 = 等分数 divisions，等分序号 1..N 绕一圈首尾相接。
 *
 * 无层无棱构件的定位策略（写进本机存档，改策略即旧位置作废）：
 *  - tier（本工具选定的默认路线）：统一归到「无层无棱档」，表与图都好认；
 *    代价：这几根在图上描不进具体层棱，只能整体示意。
 *  - nearest（另一条路线）：按灯体上最靠近的层与棱折算，图上能落到位置；
 *    代价：层数或棱数一改，这几根的位置会跟着挪，旧存档/已发单据/已裁料全部作废重出。
 */
import type { Lantern } from './types'
import type { Geometry } from './geometry'

/** 无层无棱构件的定位路线 */
export type PositionPolicy = 'tier' | 'nearest'

/** 无层无棱档的固定档名（表与导出里原样出现） */
export const NO_TIER = '无层无棱档'

/** 构件在灯体上的角色（比 MemberKind 更细，位置按角色解释） */
export type MemberRole =
  | 'vertical' // 竖篾 / 母线篾（沿棱全长）
  | 'ring_segment' // 多边形横篾的一根（某层、两棱之间）
  | 'ring_full' // 旋转体整圈横篾
  | 'mouth_segment' // 上口圈的一根（多边形）
  | 'mouth_full' // 上口整圈（旋转体）
  | 'base_segment' // 底盘圈的一根（多边形）
  | 'base_full' // 底盘整圈（旋转体）
  | 'support_full' // 收口支撑篾（整圈，无固定棱；层可能折算）
  | 'axis' // 中轴（贯穿中心，层棱均无）
  | 'spoke' // 辐条（中心到某棱，顶口/底盘各一组）
  | 'poly_edge' // 正多面体棱篾（无层无棱，稳定棱序）

export interface MemberPosition {
  /** 稳定身份键：同一根篾跨视图/导出/存档永远一致；策略切换不改身份键 */
  key: string
  role: MemberRole
  /** 所在层号；无层（上口第 L 层 / 底盘第 0 层 / 档内件 null） */
  layer: number | null
  /** 层范围（贯穿件，如中轴）；仅 layer 为 null 且贯穿时给出 1..L */
  layerFrom?: number
  layerTo?: number
  /** 所在棱号 1..N；横篾段给出两棱；整圈/无棱件 null */
  edge: number | null
  edgeFrom?: number
  edgeTo?: number
  /** 上口圈 / 底盘圈标记 */
  rim?: 'mouth' | 'base'
  /** 顶/底组（辐条用） */
  end?: 'top' | 'bottom'
  /** 是否落在无层无棱档（tier 策略下为真） */
  inNoTier: boolean
  /** 是否为就近折算出来的位置（nearest 策略下为真，层棱一改会挪动） */
  nearestDerived: boolean
  /** 表/导出直接可用的位置文字（同一套位置的唯一文本） */
  layerText: string
  edgeText: string
  positionText: string
  /** 图上定位锚点（mm 整数，坐标原点：灯轴为 x=z=0，底盘为 y=0）；档内件可能为 null */
  anchorMm: { x: number; y: number; z: number } | null
}

/** 存档里没有该字段时的默认策略：本工具选定路线一 */
export function positionPolicyOf(l: Pick<Lantern, 'positionPolicy'>): PositionPolicy {
  return l.positionPolicy === 'nearest' ? 'nearest' : 'tier'
}

/** 旋转体的棱/等分总数 = 母线根数 = 等分数 */
export function edgeCountOf(l: Lantern, g: Geometry): number {
  return l.kind === 'revolution' ? Math.max(3, Math.round(l.divisions)) : g.n
}

const mmInt = (v: number) => Math.round(v)

function anchor(x: number, y: number, z: number) {
  return { x: mmInt(x), y: mmInt(y), z: mmInt(z) }
}

/** 第 j 号棱在高度 y、半径 r 处的空间坐标（j 从 1 起，正北起顺时针） */
export function edgePoint(r: number, y: number, n: number, j1: number) {
  const a = -Math.PI / 2 + (2 * Math.PI * (j1 - 1)) / n
  return anchor(r * Math.cos(a), y, r * Math.sin(a))
}

/** 两棱之间横篾段的中点锚点（圈上这一段弧/边的中点，落在此段正中） */
function segmentAnchor(r: number, y: number, n: number, j1: number) {
  // 第 j 根段 = 棱 j 与棱 j+1 之间，中点角在 j-1 与 j 之间（即 j-0.5 号方向）
  const a = -Math.PI / 2 + (2 * Math.PI * (j1 - 0.5)) / n
  return anchor(r * Math.cos(a), y, r * Math.sin(a))
}

interface PosArgs {
  l: Lantern
  g: Geometry
  policy: PositionPolicy
  n: number
}

function verticalPos(a: PosArgs, j: number): MemberPosition {
  const L = a.l.layers.length
  const key = `V${j}`
  const layerText = `第1–${L}层（全长）`
  const edgeText = `第${j}棱`
  // 锚点取中段（全长竖篾的中点高度）
  const midY = a.g.heightMm / 2
  const r = radiusAtSectionMid(a.g)
  return {
    key,
    role: 'vertical',
    layer: null,
    layerFrom: 1,
    layerTo: L,
    edge: j,
    inNoTier: false,
    nearestDerived: false,
    layerText,
    edgeText,
    positionText: `${layerText} · ${edgeText}`,
    anchorMm: edgePoint(r, midY, a.n, j)
  }
}

function radiusAtSectionMid(g: Geometry): number {
  const ys = g.sections.map((s) => s.radiusMm)
  return ys[Math.floor((ys.length - 1) / 2)]
}

function ringSegmentPos(a: PosArgs, layer: number, r: number, y: number, j: number): MemberPosition {
  const key = `R-L${layer}-E${j}`
  const j2 = j % a.n
  const layerText = `第${layer}层`
  const edgeText = `第${j}–${j2 + 1}棱之间`
  return {
    key,
    role: 'ring_segment',
    layer,
    edge: null,
    edgeFrom: j,
    edgeTo: j2 + 1,
    inNoTier: false,
    nearestDerived: false,
    layerText,
    edgeText,
    positionText: `${layerText} · ${edgeText}`,
    anchorMm: segmentAnchor(r, y, a.n, j)
  }
}

function ringFullPos(a: PosArgs, layer: number, r: number, y: number): MemberPosition {
  const key = `R-L${layer}`
  const layerText = `第${layer}层`
  return {
    key,
    role: 'ring_full',
    layer,
    edge: null,
    inNoTier: false,
    nearestDerived: false,
    layerText,
    edgeText: `整圈（${a.n} 等分）`,
    positionText: `${layerText} · 整圈`,
    anchorMm: anchor(r, y, 0)
  }
}

function rimSegmentPos(
  a: PosArgs,
  rim: 'mouth' | 'base',
  r: number,
  y: number,
  j: number
): MemberPosition {
  const L = a.l.layers.length
  const layer = rim === "base" ? 0 : L
  const key = `${rim === 'base' ? 'B' : 'M'}-E${j}`
  const j2 = j % a.n
  const layerText = rim === 'base' ? '底盘圈（第0层·底口）' : `上口圈（第${L}层·上口）`
  const edgeText = `第${j}–${j2 + 1}棱之间`
  return {
    key,
    role: rim === 'base' ? 'base_segment' : 'mouth_segment',
    layer,
    rim,
    edge: null,
    edgeFrom: j,
    edgeTo: j2 + 1,
    inNoTier: false,
    nearestDerived: false,
    layerText,
    edgeText,
    positionText: `${layerText} · ${edgeText}`,
    anchorMm: segmentAnchor(r, y, a.n, j)
  }
}

function rimFullPos(a: PosArgs, rim: 'mouth' | 'base', r: number, y: number): MemberPosition {
  const L = a.l.layers.length
  const layer = rim === "base" ? 0 : L
  const key = rim === 'base' ? 'B' : 'M'
  const layerText = rim === 'base' ? '底盘圈（第0层·底口）' : `上口圈（第${L}层·上口）`
  return {
    key,
    role: rim === 'base' ? 'base_full' : 'mouth_full',
    layer,
    rim,
    edge: null,
    inNoTier: false,
    nearestDerived: false,
    layerText,
    edgeText: `整圈（${a.n} 等分）`,
    positionText: `${layerText} · 整圈`,
    anchorMm: anchor(r, y, 0)
  }
}

/** 收口支撑篾：tier 策略归无层无棱档；nearest 策略折算到最接近的一层（整圈仍无棱） */
function supportPos(a: PosArgs, r: number, y: number): MemberPosition {
  // 找高度最接近的真实层
  let nearestLayer = 1
  let best = Infinity
  a.g.sections.forEach((s) => {
    if (s.index === 0 || s.index === a.g.sections.length - 1) return
    const d = Math.abs(s.yMm - y)
    if (d < best) {
      best = d
      nearestLayer = s.index
    }
  })
  const tier = a.policy === 'tier'
  const layerText = tier ? NO_TIER : `第${nearestLayer}层（就近折算）`
  return {
    key: 'SUP',
    role: 'support_full',
    layer: tier ? null : nearestLayer,
    edge: null,
    inNoTier: tier,
    nearestDerived: !tier,
    layerText,
    edgeText: tier ? '无棱（整圈支撑篾）' : '整圈（无棱，层为就近折算）',
    positionText: tier ? `${NO_TIER} · 收口支撑篾（整圈）` : `第${nearestLayer}层 · 收口支撑篾（就近折算）`,
    anchorMm: tier ? null : anchor(r, y, 0)
  }
}

/** 中轴：tier 归档；nearest 折算为第 1 棱、贯穿 1..L 层 */
function axisPos(a: PosArgs): MemberPosition {
  const L = a.l.layers.length
  const tier = a.policy === 'tier'
  return {
    key: 'AXIS',
    role: 'axis',
    layer: null,
    layerFrom: 1,
    layerTo: L,
    edge: tier ? null : 1,
    inNoTier: tier,
    nearestDerived: !tier,
    layerText: tier ? NO_TIER : `第1–${L}层（就近折算）`,
    edgeText: tier ? '无棱（贯穿灯轴）' : '第1棱（就近折算）',
    positionText: tier
      ? `${NO_TIER} · 中轴（贯穿中心）`
      : `第1–${L}层 · 第1棱（中轴就近折算）`,
    anchorMm: anchor(0, a.g.heightMm / 2, 0)
  }
}

/** 辐条：tier 归档；nearest 折算到它实际支撑的那一号棱（顶口/底盘处） */
function spokePos(a: PosArgs, end: 'top' | 'bottom', j: number, r: number, y: number): MemberPosition {
  const tier = a.policy === 'tier'
  const L = a.l.layers.length
  const layer = end === 'bottom' ? 0 : L
  const where = end === 'bottom' ? '底盘' : '上口'
  return {
    key: `SPK-${end === 'bottom' ? 'B' : 'T'}-${j}`,
    role: 'spoke',
    layer: tier ? null : layer,
    rim: end === 'bottom' ? 'base' : 'mouth',
    end,
    edge: tier ? null : j,
    inNoTier: tier,
    nearestDerived: !tier,
    layerText: tier ? NO_TIER : `${where}（第${layer}层·就近折算）`,
    edgeText: tier ? `第${j}棱（档内不定位）` : `第${j}棱`,
    positionText: tier
      ? `${NO_TIER} · ${where}辐条 第${j}根（朝第${j}棱）`
      : `${where} · 第${j}棱（辐条就近折算）`,
    anchorMm: edgePoint(r / 2, y, a.n, j)
  }
}

/** 正多面体棱篾：棱序按稳定几何枚举（不随层数/棱数参数变） */
function polyEdgePos(a: PosArgs, edgeSeq: number): MemberPosition {
  const total = a.g.n <= 4 ? 6 : 12
  return {
    key: `PE${String(edgeSeq).padStart(2, '0')}`,
    role: 'poly_edge',
    layer: null,
    edge: null,
    inNoTier: true, // 多面体没有层也没有棱柱意义上的棱，始终在档
    nearestDerived: false,
    layerText: NO_TIER,
    edgeText: `棱序${edgeSeq}/${total}（稳定编号）`,
    positionText: `${NO_TIER} · 棱篈第 ${edgeSeq}/${total} 根`,
    anchorMm: null
  }
}

export interface PositionBuilders {
  vertical: (j: number) => MemberPosition
  ringSegment: (layer: number, r: number, y: number, j: number) => MemberPosition
  ringFull: (layer: number, r: number, y: number) => MemberPosition
  rimSegment: (rim: 'mouth' | 'base', r: number, y: number, j: number) => MemberPosition
  rimFull: (rim: 'mouth' | 'base', r: number, y: number) => MemberPosition
  support: (r: number, y: number) => MemberPosition
  axis: () => MemberPosition
  spoke: (end: 'top' | 'bottom', j: number, r: number, y: number) => MemberPosition
  polyEdge: (edgeSeq: number) => MemberPosition
}

/** 一套位置构造器（同一根篾在表/图/料/单/存档都从这里取位置） */
export function makePositions(l: Lantern, g: Geometry): PositionBuilders {
  const policy = positionPolicyOf(l)
  const n = edgeCountOf(l, g)
  const a: PosArgs = { l, g, policy, n }
  return {
    vertical: (j) => verticalPos(a, j),
    ringSegment: (layer, r, y, j) => ringSegmentPos(a, layer, r, y, j),
    ringFull: (layer, r, y) => ringFullPos(a, layer, r, y),
    rimSegment: (rim, r, y, j) => rimSegmentPos(a, rim, r, y, j),
    rimFull: (rim, r, y) => rimFullPos(a, rim, r, y),
    support: (r, y) => supportPos(a, r, y),
    axis: () => axisPos(a),
    spoke: (end, j, r, y) => spokePos(a, end, j, r, y),
    polyEdge: (edgeSeq) => polyEdgePos(a, edgeSeq)
  }
}

/**
 * 位置指纹：影响"哪根篾在哪个位置"的参数摘要。
 * 存进本机存档；导出时一并记录。指纹变了而还挂着老指纹的导出/存档，必须标为作废。
 * 注意：长度类参数（直径/总高/余量）只改尺寸不改位置身份，不进指纹。
 */
export function positionFingerprint(l: Lantern): string {
  const parts = [
    l.kind,
    l.layers.length,
    l.kind === 'revolution' ? Math.max(3, Math.round(l.divisions)) : Math.max(3, Math.round(l.sides)),
    positionPolicyOf(l)
  ]
  return parts.join('|')
}

/** 位置连续性自检：竖篾/横篈棱号 1..N 首尾相接，无断号重号；层号 0..L+1 不缺不重 */
export function checkPositionNumbering(
  positions: MemberPosition[],
  n: number,
  layerCount: number,
  isPolyhedron = false
): { pass: boolean; detail: string } {
  const problems: string[] = []

  // 身份键唯一（所有灯型都查；多面体只查这一项，因为它无层无棱）
  const keys = positions.map((p) => p.key)
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dup.length) problems.push(`位置身份键重号：${[...new Set(dup)].join('、')}`)

  if (isPolyhedron) {
    const poly = positions.filter((p) => p.role === 'poly_edge')
    const seqOk = poly.length === new Set(poly.map((p) => p.key)).size
    return {
      pass: problems.length === 0 && seqOk && poly.length === positions.length,
      detail:
        problems.length === 0 && seqOk
          ? `正多面体 ${poly.length} 根棱篈全部在无层无棱档，棱序 1..${poly.length} 为稳定编号，身份键无重号`
          : `多面体棱篈棱序异常或身份键重号：${problems.join('；')}`
    }
  }

  // 竖篈棱号
  const vertEdges = positions.filter((p) => p.role === 'vertical').map((p) => p.edge)
  const expectedVert = Array.from({ length: n }, (_, i) => i + 1)
  if (vertEdges.length !== n || vertEdges.some((e, i) => e !== expectedVert[i])) {
    problems.push(`竖篾棱号应为 1..${n} 首尾相接，实际 ${vertEdges.sort((x, y) => (x ?? 0) - (y ?? 0)).join('、') || '空'}`)
  }

  // 每层横篈段棱号
  const byLayer = new Map<number, number[]>()
  for (const p of positions) {
    if (p.role !== 'ring_segment' && p.role !== 'mouth_segment' && p.role !== 'base_segment') continue
    if (p.edgeFrom == null) continue
    const arr = byLayer.get(p.layer ?? -1) || []
    arr.push(p.edgeFrom)
    byLayer.set(p.layer ?? -1, arr)
  }
  for (const [layer, edges] of byLayer) {
    const sorted = [...edges].sort((x, y) => x - y)
    const expect = Array.from({ length: n }, (_, i) => i + 1)
    if (sorted.length !== n || sorted.some((e, i) => e !== expect[i])) {
      const name = layer === 0 ? '底盘圈' : layer === layerCount ? '上口圈' : `第${layer}层横篾`
      problems.push(`${name}应有 ${n} 段且段号 1..${n} 不断不重，实际 ${sorted.join('、') || '空'}`)
    }
  }

  // 层号范围（整圈/单段件覆盖 0..L：底盘 0、上口 L、中间 1..L-1）
  const layers = new Set(positions.map((p) => p.layer).filter((v): v is number => v != null))
  for (let i = 0; i <= layerCount; i++) {
    if (!layers.has(i)) problems.push(`缺少第 ${i === 0 ? '0（底盘）' : i === layerCount ? `${i}（上口）` : i} 层的构件`)
  }

  return {
    pass: problems.length === 0,
    detail:
      problems.length === 0
        ? `竖篈 ${n} 根棱号 1..${n}、各层横篈段号 1..${n} 首尾相接不断不重，层号 0..${layerCount}（底盘 0 / 上口 ${layerCount}）齐备，身份键无重号`
        : problems.join('；')
  }
}

/** 位置的厘米显示（保留一位小数）；输入为 mm 整数坐标 */
export function cm1(mm: number): string {
  return (mm / 10).toFixed(1)
}
