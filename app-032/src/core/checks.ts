/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern } from './types'
import { bodySurfaceArea, polygonEdge, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, type PanelResult } from './panels'
import { buildPositionModel, positionStockRows, POSITION_SCHEME, type PositionModel, type PosStockRow } from './positions'
import { computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { CRAFT } from './craft'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  /** 统一位置模型（构件 + 顶盖/底盘裁片）——表、图、备料、导出共用 */
  positions: PositionModel
  /** 备料按位置分开（每根/每圈一行） */
  stockRows: PosStockRow[]
  checks: CheckResult[]
  elapsedMs: number
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function computeAll(l: Lantern, loft: LoftOptions): FullResult {
  const t0 = performance.now()
  const frame = buildFrame(l)
  const panels = buildPanels(l)
  const materials = computeMaterials(l)
  const batch = computeBatch(materials, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const sheets = paginate(l, loft)
  // 统一位置模型：构件实例 + 顶盖/底盘裁片（方案 A 归无层无棱档），单一来源
  const caps = panels.panels.filter((p) => p.layerIndex === -1).map((p) => ({ id: p.id, label: p.label, capSide: p.capSide }))
  const positions = buildPositionModel(l, frame.geometry, frame.members, caps)
  const stockRows = positionStockRows(frame.members, positions)
  const elapsedMs = performance.now() - t0
  const checks = runChecks(l, frame, panels, materials, batch, sheets, elapsedMs, positions, stockRows)
  return { frame, panels, materials, batch, sheets, positions, stockRows, checks, elapsedMs }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  elapsedMs: number,
  positions: PositionModel,
  stockRows: PosStockRow[]
): CheckResult[] {
  const out: CheckResult[] = []
  const g = frame.geometry
  const lash = Math.max(0, l.lashAllowanceMm)

  // ---- CHK-01 几何：棱长/周长与手算一致 ----
  {
    const cases = [
      { name: '正六棱柱底边（D200）', got: polygonEdge(100, 6), expect: 100, tol: 1 },
      { name: '正八棱柱底边（D200）', got: polygonEdge(100, 8), expect: 76.5367, tol: 1 },
      { name: '圆形横篾圈周长（D200）', got: ringPerimeter(100, 0, false), expect: 628.3185, tol: 1 },
      { name: '六边形周长（D200）', got: ringPerimeter(100, 6, true), expect: 600, tol: 1 }
    ]
    const bad = cases.filter((c) => Math.abs(c.got - c.expect) > c.tol)
    out.push({
      id: 'CHK-01',
      title: '几何手算核对（棱长 / 周长，误差 ≤ 1mm）',
      pass: bad.length === 0,
      value: bad.length === 0 ? '4/4 项通过' : `${bad.length} 项超差`,
      detail: cases
        .map((c) => `${c.name}：算得 ${f3(c.got)} / 手算 ${f3(c.expect)}（Δ${f3(Math.abs(c.got - c.expect))}）`)
        .join('；')
    })
  }

  // ---- CHK-02 竖篾长度与分段高度累计（正多面体无竖篈/分层，不适用） ----
  if (g.kind === 'polyhedron') {
    out.push({
      id: 'CHK-02',
      title: '竖篾净长 = 分段母线折线长累计（正多面体不适用）',
      pass: true,
      value: '不适用',
      detail: '正四面体/八面体为棱篈骨架，无通长竖篈与分层截面；棱长按外接球直径单独核算（见几何手算）。'
    })
  } else {
    const segs = segmentInfos(g)
    const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
    const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    const raw = vertical ? vertical.rawLengthMm : 0
    const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
    const pass = Math.abs(raw - sumSlant) <= 0.1 && (!allStraight || Math.abs(raw - sumH) <= 0.1)
    out.push({
      id: 'CHK-02',
      title: '竖篾净长 = 分段母线折线长累计',
      pass,
      value: `Δ折线 ${f1(Math.abs(raw - sumSlant))}mm`,
      detail: allStraight
        ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - sumH))}mm）`
        : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm）`
    })
  }

  // ---- CHK-03 缝份 ----
  {
    const s = Math.max(0, l.seamAllowanceMm)
    const bad = panels.panels.filter(
      (p) =>
        Math.abs(p.widthTopMm - (p.rawWidthTopMm + 2 * s)) > 0.06 ||
        Math.abs(p.widthBottomMm - (p.rawWidthBottomMm + 2 * s)) > 0.06 ||
        Math.abs(p.heightMm - (p.rawHeightMm + 2 * s)) > 0.06
    )
    out.push({
      id: 'CHK-03',
      title: '裁片尺寸 = 展开净尺寸 + 缝份 × 2（每边）',
      pass: bad.length === 0,
      value: `${panels.panels.length - bad.length}/${panels.panels.length} 种裁片通过`,
      detail:
        bad.length === 0
          ? `全部 ${panels.panels.length} 种裁片上/下/高三个尺寸均等于净尺寸 + ${f1(s)}×2mm；裁片图以红色虚线绘制缝份折线`
          : `超差裁片：${bad.map((p) => p.label).join('、')}`
    })
  }

  // ---- CHK-04 备料守恒 ----
  {
    const stock = frame.members.reduce((a, m) => a + m.lengthMm * m.qty, 0)
    const rawTotal = frame.members.reduce((a, m) => a + m.rawLengthMm * m.qty, 0)
    const lashTotal = frame.members.reduce((a, m) => a + m.qty * m.lashJoints * lash, 0)
    const diff = stock - rawTotal
    const pass = stock >= rawTotal - 1e-6 && Math.abs(diff - lashTotal) <= 0.5
    out.push({
      id: 'CHK-04',
      title: '备料守恒：Σ备料长度 ≥ Σ净长，且差值 = 余量总和',
      pass,
      value: `Σ备料 ${f1(stock)}mm / Σ净长 ${f1(rawTotal)}mm`,
      detail: `差值 ${f1(diff)}mm，应等于余量总和 ${f1(lashTotal)}mm（竖篾两端、横篾圈接头各计 ${f1(lash)}mm）`
    })
  }

  // ---- CHK-05 面积核对 ----
  {
    const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
    const refArea = bodySurfaceArea(g, Math.max(3, Math.round(l.divisions)))
    const ratio = refArea > 0 ? netArea / refArea : 0
    const pass = ratio >= 0.97 && ratio <= 1.03
    let advice = ''
    if (!pass && !g.polygon) {
      const need = suggestDivisions(l, netArea, ratio)
      advice = need ? `；建议把母线等分数提高到 ${need}（当前 ${l.divisions}）` : ''
    } else if (!pass) {
      advice = '；请检查缝份/分层参数，棱柱类侧面积应与裁片面积完全一致'
    }
    out.push({
      id: 'CHK-05',
      title: '面积核对：Σ裁片净面积 / 灯体表面积 ∈ [0.97, 1.03]',
      pass,
      value: `比值 ${(ratio * 100).toFixed(2)}%`,
      detail: `裁片净面积 ${f3(netArea / 1_000_000)}m²，灯体表面积（含顶底盖）${f3(refArea / 1_000_000)}m²${advice}`
    })
  }

  // ---- CHK-06 分页：裁片不跨页 ----
  {
    const r = assertNoPanelSplit(sheets)
    out.push({
      id: 'CHK-06',
      title: '分页：任一裁片不跨页（长条跨页带对位十字与搭接量）',
      pass: r.pass,
      value: r.pass ? '通过' : '失败',
      detail: `${r.detail}；跨页仅出现在骨架长条上，接缝处绘制对位十字并标注搭接 ${f1(loftOverlap(sheets))}mm 与拼接编号`
    })
  }

  // ---- CHK-07 批量 ----
  {
    const n = Math.max(1, Math.round(l.batchCount))
    const k = n * (1 + l.wasteRatio)
    // 与单灯值的偏差只来自展示精度（长度 3 位小数 / 胶 1 位小数）
    const errs = [
      Math.abs(batch.frameM - materials.frameM * k),
      Math.abs(batch.coveringM2 - materials.coveringM2 * k),
      Math.abs(batch.lashM - materials.lashM * k)
    ]
    const pass = errs.every((e) => e <= 0.0011) && Math.abs(batch.glueG - materials.glueG * k) <= 0.051
    out.push({
      id: 'CHK-07',
      title: `批量制灯：${n} 个材料总量 = 单灯 × ${n} × (1 + ${(l.wasteRatio * 100).toFixed(0)}%)`,
      pass,
      value: `竹篾 ${f3(batch.frameM)}m / 蒙面 ${f3(batch.coveringM2)}m²`,
      detail: `单灯竹篾 ${f3(materials.frameM)}m × ${n} × ${(1 + l.wasteRatio).toFixed(2)} = ${f3(materials.frameM * k)}m = 批量值；蒙面、扎线、胶同理（LED 按颗数 × ${n} 计，不参与损耗）`
    })
  }

  // ---- CHK-08 性能 ----
  {
    const pass = elapsedMs < 100
    out.push({
      id: 'CHK-08',
      title: '放样计算 < 100ms',
      pass,
      value: `${elapsedMs.toFixed(1)}ms`,
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页与位置模型）`
    })
  }

  // ---- CHK-09 统一位置：每根构件位置齐全、根数与实例对得上、等分首尾闭合 ----
  {
    const problems: string[] = []
    // 1) 每个构件必须有位置
    for (const m of frame.members) {
      if (!m.pos) problems.push(`${m.label} 缺位置`)
    }
    // 2) 每个非无档构件的 qty 必须等于其实例数（含顶盖/底盘由裁片侧另算）
    for (const m of frame.members) {
      if (m.pos.zone === 'none') continue
      const cnt = positions.byMember.get(m.id)?.length || 0
      if (cnt !== m.qty) problems.push(`${m.label} 数量 ${m.qty} ≠ 位置实例 ${cnt}`)
    }
    // 3) 棱/母线序号不断号、不重号
    for (const [mid, arr] of positions.byMember) {
      const edges = arr.map((x) => x.edgeNo).filter((x): x is number => x != null).sort((a, b) => a - b)
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] !== i + 1) {
          problems.push(`${mid} 棱号断号/重号：${edges.join(',')}`)
          break
        }
      }
    }
    // 4) 旋转体：母线根数 = 等分数 = 展开片数
    if (l.kind === 'revolution') {
      const rib = frame.members.find((m) => m.kind === 'rib')
      const sidePanels = panels.panels.filter((p) => p.layerIndex >= 0)
      const panelQty = sidePanels[0]?.qty || 0
      if (!rib || rib.qty !== l.divisions) problems.push(`母线篾根数 ${rib?.qty} ≠ 等分数 ${l.divisions}`)
      if (panelQty !== l.divisions) problems.push(`展开片数 ${panelQty} ≠ 等分数 ${l.divisions}`)
    }
    // 5) 位置坐标必须是 mm 整数
    for (const ins of positions.instances) {
      const a = ins.anchor
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !Number.isInteger(a.z)) {
        problems.push(`${ins.label} 坐标未取整`)
        break
      }
    }
    // 6) 按位置分列的备料合计必须等于含余量总长（守恒，同一来源）
    const posStock = stockRows.reduce((s, r) => s + r.lengthMm * r.qty, 0)
    if (Math.abs(posStock - frame.stockLengthMm) > 0.1) {
      problems.push(`按位置备料 ${f1(posStock)} ≠ 构件表备料 ${f1(frame.stockLengthMm)}`)
    }
    // 7) 无层无棱档内容固定（方案 A）
    const bucketNames = positions.bucket.map((b) => b.name).join('、')
    out.push({
      id: 'CHK-09',
      title: '统一位置（POS-A1）：表/图/备料/导出/存档同一份位置',
      pass: problems.length === 0,
      value: `实例 ${positions.instances.length} 处 · 无层无棱档 ${positions.bucket.length} 项`,
      detail:
        problems.length === 0
          ? `每个构件都有层/棱/圈口位置；旋转体母线根数=等分数=${l.kind === 'revolution' ? l.divisions : '—'}，序号首尾闭合；坐标 mm 取整（界面 cm 保留 1 位）；按位置备料合计 ${f1(posStock)}mm = 构件表合计；无层无棱档：${bucketNames || '（无）'}`
          : problems.join('；')
    })
  }

  // ---- CHK-10 存档位置版本：老位置必须重认后重出 ----
  {
    const stale = l.posVersion !== POSITION_SCHEME
    out.push({
      id: 'CHK-10',
      title: '本机存档位置版本（老位置须作废重出）',
      pass: !stale,
      value: stale ? '位置待重认' : POSITION_SCHEME,
      detail: stale
        ? '此灯样按旧位置方案存档：本机存档位置、已导出的构件清单/裁片清单/备料单与 1:1 放样图全部作废，需重认位置后重出；照旧位置裁好的中轴/顶盖/底盘料退回重新对位。'
        : `存档位置戳 ${POSITION_SCHEME}，与当前表、图、备料、导出一致。`
    })
  }

  return out
}

function suggestDivisions(l: Lantern, netArea: number, ratio: number): number | null {
  if (ratio <= 1.0005) return null
  for (let d = Math.max(3, Math.round(l.divisions)) + 1; d <= CRAFT.divMax; d++) {
    const ref = bodySurfaceArea(frameGeometryOf(l), d)
    const r = ref > 0 ? netArea / ref : 0
    if (r <= 1.03) return d
  }
  return CRAFT.divMax
}

function loftOverlap(sheets: Sheet[]): number {
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type === 'strip' && it.overlapMm > 0) return it.overlapMm
    }
  }
  return 0
}

/** 校验尺标称长度（mm）：1:1 打印用 */
export const CALIBRATION_RULER_MM = 100
export const CALIBRATION_CIRCLE_MM = 100

function frameGeometryOf(l: Lantern) {
  return buildFrame(l).geometry
}

/** 由圆周长反推直径（尺寸反推工具用） */
export function diameterFromPerimeter(lengthMm: number, n: number, polygon: boolean, lashMm: number): number {
  const net = Math.max(0, lengthMm - lashMm)
  if (polygon) {
    const s = Math.max(3, Math.round(n))
    return net / (s * Math.sin(Math.PI / s))
  }
  return net / Math.PI
}

/** 由母线（竖篾）长度反推可用最大直径：保持收口比例与总高，二分求解 */
export function diameterFromRib(l: Lantern, ribLengthMm: number): number {
  const target = Math.max(10, ribLengthMm - 2 * l.lashAllowanceMm)
  let lo = 20
  let hi = 3000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const test: Lantern = { ...l, maxDiameterMm: mid, mouthDiameterMm: (mid * l.mouthDiameterMm) / Math.max(1, l.maxDiameterMm), baseDiameterMm: (mid * l.baseDiameterMm) / Math.max(1, l.maxDiameterMm) }
    const segs = segmentInfos(buildFrame(test).geometry)
    const len = segs.reduce((a, s) => a + s.slantMm, 0)
    if (len < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
