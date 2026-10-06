/**
 * 统一位置模型（表 / 预览图 / 备料 / 三份导出单子 / 本机存档共用，唯一来源）。
 *
 * 方案取舍（已定，见 POSITION_POLICY）：选 A 路——顶盖、底盘、中轴统一归入明示的
 * 「无层无棱档」，表与图都好认；认下代价：这几根在预览图上落不到灯体具体位置，
 * 只在灯体旁的档位牌中列出。不选 B 路（按最近层棱折算），避免层/棱一改位置就漂移、
 * 已存档灯样据此导出的单子与图纸整体作废。
 *
 * 编号约定：
 *  - 层号自底向上 1..L；底盘截面 = 0，上口截面 = L；
 *  - 棱/母线序号 1 起：俯视正上方为 1 号，顺时针递增，末号接 1 号，不断号不重号；
 *  - 旋转体母线篾根数 = 母线等分数（buildGeometry 的 n），圈类整圈一根；
 *  - 位置坐标一律 mm 取整（roundMm）；界面换算 cm 时只保留 1 位小数（mmToCm）。
 */
import type { FrameMember, Lantern, MemberPosition, Point3, PosZone } from './types'
import { polyhedronWireframe, r1, type Geometry } from './geometry'

/** 位置方案版本戳（存档与每份导出单都带；对不上即老位置，必须重认重出） */
export const POSITION_SCHEME = 'POS-A1'

/** 无层无棱档的统一档名（表与图同一写法） */
export const NO_BUCKET_ZONE = 'none'

/** 档位牌项（无层无棱档：图上不落到灯体，只在灯体旁列档） */
export interface BucketEntry {
  memberId: string
  kind: FrameMember['kind'] | 'cap'
  name: string
  qty: number
}

export interface PosInstance {
  /** = member.id（含裁片顶盖/底盘用 panel.id） */
  memberId: string
  label: string
  /** 棱/母线序号；整圈为 null；无层无棱档为 null */
  edgeNo: number | null
  pos: MemberPosition
  /** 实例位置文字（含层/棱/圈口） */
  posText: string
  /** 几何：折线/整圈/圆片/无档（无档只进档位牌） */
  geom: PosGeom
  /** 定位点（mm，取整；圈类为最前点），用于提示与核对 */
  anchor: Point3
}

export type PosGeom =
  | { type: 'polyline'; pts: Point3[] }
  | { type: 'hoop'; yMm: number; radiusMm: number; segments: number }
  | { type: 'cap'; side: 'top' | 'bottom'; radiusMm: number; segments: number }
  | { type: 'none' }

export interface PositionModel {
  scheme: string
  layers: number
  n: number
  polygon: boolean
  kind: Lantern['kind']
  heightMm: number
  instances: PosInstance[]
  /** memberId → 该构件的全部实例（含顶盖/底盘裁片） */
  byMember: Map<string, PosInstance[]>
  /** 无层无棱档（方案 A） */
  bucket: BucketEntry[]
  /** 每层截面（自底向上，含 0 底盘与 L 上口），单位 mm 取整 */
  sections: { index: number; yMm: number; radiusMm: number }[]
}

/** mm 取整（位置坐标的唯一取整口径） */
export function roundMm(v: number): number {
  return Math.round(v)
}

/** mm → cm，只保留 1 位小数 */
export function mmToCm(mm: number): number {
  return Math.round(mm / 10) / 10
}

/** 位置文字（mm 数字 + cm 括注），统一写清单位与精度 */
export function mmLabel(mm: number): string {
  return `${roundMm(mm)}mm（${mmToCm(mm).toFixed(1)}cm）`
}

/** 圈序号是否整圈 */
export function isHoop(p: MemberPosition): boolean {
  return p.edgeStart == null
}

/** 构件行位置列文字（聚合成一行） */
export function positionText(p: MemberPosition): string {
  switch (p.zone) {
    case 'none':
      return `无层无棱档 · ${p.bucket || ''}`.trim()
    case 'solid-edge':
      return p.count > 1 ? `无分层 · 棱 ${p.edgeStart}–${p.edgeEnd}（共 ${p.count} 根）` : `无分层 · 棱 ${p.edgeStart}`
    case 'mouth':
      return p.edgeStart == null
        ? `上口圈 · 整圈 1 根（第 ${p.layer} 层顶）`
        : `上口圈 · 棱 ${p.edgeStart}–${p.edgeEnd}（合围 ${p.count} 根）`
    case 'base':
      return p.edgeStart == null
        ? `底盘圈 · 整圈 1 根（0 层）`
        : `底盘圈 · 棱 ${p.edgeStart}–${p.edgeEnd}（合围 ${p.count} 根）`
    case 'shoulder':
      return `收口支撑圈 · 整圈 1 根 · 高 ${mmLabel(p.yMm || 0)}（近第 ${p.layer} 层）`
    case 'spoke':
      return p.layer === 1
        ? `下辐条 · 棱 ${p.edgeStart}–${p.edgeEnd}（${p.count} 根，底盘面中心→棱角）`
        : `上辐条 · 棱 ${p.edgeStart}–${p.edgeEnd}（${p.count} 根，上口面中心→棱角）`
    default:
      if (p.layer === null) {
        return p.edgeStart != null
          ? `竖篾 · 通长（第 1 层→上口） · 棱 ${p.edgeStart}–${p.edgeEnd}（${p.count} 根）`
          : `竖篾 · 通长 · ${p.count} 根`
      }
      if (p.edgeStart == null) return `第 ${p.layer} 层横篾圈 · 整圈 1 根 · 高 ${mmLabel(p.yMm || 0)}`
      return `第 ${p.layer} 层横篾 · 棱 ${p.edgeStart}–${p.edgeEnd}（合围 ${p.count} 根）· 高 ${mmLabel(p.yMm || 0)}`
  }
}

/** 单实例位置文字（点图上一根时用） */
export function instanceText(ins: PosInstance): string {
  const p = ins.pos
  if (p.zone === 'none') return `无层无棱档 · ${p.bucket || ins.label}`
  if (p.zone === 'solid-edge') return `无分层 · 棱 ${ins.edgeNo}（正多面体）`
  if (p.zone === 'mouth') return p.edgeStart == null ? '上口圈 · 整圈' : `上口圈 · 棱 ${ins.edgeNo}`
  if (p.zone === 'base') return p.edgeStart == null ? '底盘圈 · 整圈' : `底盘圈 · 棱 ${ins.edgeNo}`
  if (p.zone === 'shoulder') return `收口支撑圈 · 整圈 · 高 ${mmLabel(p.yMm || 0)}`
  if (p.zone === 'spoke') return p.layer === 1 ? `下辐条 · 棱 ${ins.edgeNo}` : `上辐条 · 棱 ${ins.edgeNo}`
  if (p.layer === null) return `竖篾/母线篾 · 通长 · 棱 ${ins.edgeNo}`
  if (p.edgeStart == null) return `第 ${p.layer} 层横篾圈 · 整圈 · 高 ${mmLabel(p.yMm || 0)}`
  return `第 ${p.layer} 层横篾 · 棱 ${ins.edgeNo} · 高 ${mmLabel(p.yMm || 0)}`
}

/* ---------------- 位置工厂（frame.ts / panels.ts 用，保证同一口径） ---------------- */

export function posVertical(n: number): MemberPosition {
  return { zone: 'body', layer: null, edgeStart: 1, edgeEnd: n, count: n }
}

export function posRib(n: number): MemberPosition {
  return { zone: 'body', layer: null, edgeStart: 1, edgeEnd: n, count: n }
}

export function posLayerRing(layer: number, yMm: number, polygon: boolean, n: number): MemberPosition {
  // 多边形：每层圈由 n 根横篾合围（每根一棱边）；旋转体：整圈 1 根（edgeStart=null）
  return {
    zone: 'body',
    layer,
    edgeStart: polygon ? 1 : null,
    edgeEnd: polygon ? n : null,
    count: polygon ? n : 1,
    yMm: roundMm(yMm)
  }
}

export function posMouth(layerTop: number, yMm: number, polygon: boolean, n: number): MemberPosition {
  return {
    zone: 'mouth',
    layer: layerTop,
    edgeStart: polygon ? 1 : null,
    edgeEnd: polygon ? n : null,
    count: polygon ? n : 1,
    yMm: roundMm(yMm)
  }
}

export function posBase(yMm: number, polygon: boolean, n: number): MemberPosition {
  return {
    zone: 'base',
    layer: 0,
    edgeStart: polygon ? 1 : null,
    edgeEnd: polygon ? n : null,
    count: polygon ? n : 1,
    yMm: roundMm(yMm)
  }
}

export function posShoulder(layerNearest: number, yMm: number, radiusMm: number): MemberPosition {
  return { zone: 'shoulder', layer: layerNearest, edgeStart: null, edgeEnd: null, count: 1, yMm: roundMm(yMm), radiusMm: roundMm(radiusMm) }
}

export function posSpoke(side: 'top' | 'bottom', n: number, yMm: number, layerTop: number): MemberPosition {
  return {
    zone: 'spoke',
    // 下辐条位于底盘面（近第 1 层，记 1）；上辐条位于上口面（近顶层 layerTop）
    layer: side === 'top' ? layerTop : 1,
    edgeStart: 1,
    edgeEnd: n,
    count: n,
    yMm: roundMm(yMm)
  }
}

export function posNone(bucket: string): MemberPosition {
  return { zone: 'none', layer: null, edgeStart: null, edgeEnd: null, count: 1, bucket }
}

export function posSolidEdge(edgeCount: number): MemberPosition {
  return { zone: 'solid-edge', layer: null, edgeStart: 1, edgeEnd: edgeCount, count: edgeCount }
}

/** 顶盖/底盘裁片位置（方案 A：无层无棱档） */
export function posCap(side: 'top' | 'bottom'): MemberPosition {
  return posNone(side === 'top' ? '顶盖圆片' : '底盖圆片')
}

/* ---------------- 位置模型（实例化：图、备料按位置分列都从这里取） ---------------- */

const hoopPoint = (a: number, r: number, y: number): Point3 => ({ x: roundMm(r * Math.cos(a)), y: roundMm(y), z: roundMm(r * Math.sin(a)) })

/** 整圈几何点（俯视正上方为 1 号缝点，顺时针，segments 段首尾闭合） */
export function hoopPoints(yMm: number, radiusMm: number, segments: number): Point3[] {
  const pts: Point3[] = []
  for (let k = 0; k < segments; k++) {
    pts.push(hoopPoint(-Math.PI / 2 + (2 * Math.PI * k) / segments, radiusMm, yMm))
  }
  return pts
}

/** 棱柱某圈上第 k 棱（顶点 k）的位置（0 起） */
function polygonVertex(k: number, r: number, n: number, y: number): Point3 {
  return hoopPoint(-Math.PI / 2 + (2 * Math.PI * k) / n, r, y)
}

/** 通长竖篾：沿截面折线（与 segmentInfos 同口径，每层截面一处折线点） */
function verticalPoly(g: Geometry, k: number): Point3[] {
  const n = g.n
  return g.sections.map((s) => polygonVertex(k, s.radiusMm, n, s.yMm))
}

/**
 * 由灯样 + 构件表 + 顶盖/底盘裁片构建统一位置模型。
 * capPanels 传顶/底盖两片（buildPanels 已标 capSide）；其余裁片无位置、不进模型。
 */
export function buildPositionModel(l: Lantern, g: Geometry, members: FrameMember[], capPanels: { id: string; label: string; capSide?: 'top' | 'bottom' }[] = []): PositionModel {
  const L = l.layers.length
  const n = g.n
  const instances: PosInstance[] = []
  const byMember = new Map<string, PosInstance[]>()
  const bucket: BucketEntry[] = []

  const pushInst = (ins: PosInstance) => {
    instances.push(ins)
    const arr = byMember.get(ins.memberId) || []
    arr.push(ins)
    byMember.set(ins.memberId, arr)
  }

  const sec = (i: number) => g.sections[i]

  for (const m of members) {
    const p = m.pos
    const add = (geom: PosGeom, edgeNo: number | null, anchor: Point3, posOverride?: MemberPosition) => {
      const pos = posOverride || p
      const ins: PosInstance = {
        memberId: m.id,
        label: m.label,
        edgeNo,
        pos,
        posText: '',
        geom,
        anchor: { x: roundMm(anchor.x), y: roundMm(anchor.y), z: roundMm(anchor.z) }
      }
      ins.posText = instanceText(ins)
      pushInst(ins)
    }

    if (p.zone === 'none') {
      add({ type: 'none' }, null, { x: 0, y: 0, z: 0 })
      bucket.push({ memberId: m.id, kind: m.kind, name: p.bucket || m.label, qty: m.qty })
      continue
    }

    if (p.zone === 'solid-edge') {
      const wf = polyhedronWireframe(g)
      for (const e of wf.edges) {
        add({ type: 'polyline', pts: [{ x: e.a.x, y: e.a.y, z: e.a.z }, { x: e.b.x, y: e.b.y, z: e.b.z }] }, e.edgeNo, {
          x: (e.a.x + e.b.x) / 2,
          y: (e.a.y + e.b.y) / 2,
          z: (e.a.z + e.b.z) / 2
        })
      }
      continue
    }

    if (p.zone === 'shoulder') {
      const r = p.radiusMm ?? radiusOfSectionAtY(g, p.yMm || 0)
      const segs = g.polygon ? n : Math.max(24, n)
      add({ type: 'hoop', yMm: p.yMm || 0, radiusMm: r, segments: segs }, null, { x: 0, y: p.yMm || 0, z: r })
      continue
    }

    if (p.zone === 'spoke') {
      // 下辐条 layer=1（底盘面）；上辐条 layer=顶层号（上口面）
      const top = (p.layer ?? 1) !== 1
      const ringSec = top ? sec(L) : sec(0)
      for (let k = 0; k < n; k++) {
        const outer = polygonVertex(k, ringSec.radiusMm, n, ringSec.yMm)
        const inner = { x: 0, y: ringSec.yMm, z: 0 }
        add({ type: 'polyline', pts: [inner, outer] }, k + 1, { x: outer.x / 2, y: ringSec.yMm, z: outer.z / 2 })
      }
      continue
    }

    // 竖篾 / 母线篾（通长）
    if ((m.kind === 'vertical' || m.kind === 'rib') && p.layer === null) {
      for (let k = 0; k < n; k++) {
        const pts = verticalPoly(g, k)
        add({ type: 'polyline', pts }, k + 1, pts[Math.floor(pts.length / 2)])
      }
      continue
    }

    // 上口圈 / 底盘圈
    if (m.kind === 'mouth_ring' || m.kind === 'base_ring') {
      const si = m.kind === 'mouth_ring' ? sec(L) : sec(0)
      if (p.edgeStart == null) {
        const segs = Math.max(48, n)
        add({ type: 'hoop', yMm: si.yMm, radiusMm: si.radiusMm, segments: segs }, null, { x: 0, y: si.yMm, z: si.radiusMm })
      } else {
        for (let k = 0; k < n; k++) {
          const a = polygonVertex(k, si.radiusMm, n, si.yMm)
          const b = polygonVertex((k + 1) % n, si.radiusMm, n, si.yMm)
          add({ type: 'polyline', pts: [a, b] }, k + 1, { x: (a.x + b.x) / 2, y: si.yMm, z: (a.z + b.z) / 2 })
        }
      }
      continue
    }

    // 第 i 层横篾（圈）
    if (m.kind === 'ring' && p.layer != null) {
      const si = sec(p.layer)
      if (p.edgeStart == null) {
        add({ type: 'hoop', yMm: si.yMm, radiusMm: si.radiusMm, segments: Math.max(48, n) }, null, {
          x: 0,
          y: si.yMm,
          z: si.radiusMm
        })
      } else {
        for (let k = 0; k < n; k++) {
          const a = polygonVertex(k, si.radiusMm, n, si.yMm)
          const b = polygonVertex((k + 1) % n, si.radiusMm, n, si.yMm)
          add({ type: 'polyline', pts: [a, b] }, k + 1, { x: (a.x + b.x) / 2, y: si.yMm, z: (a.z + b.z) / 2 })
        }
      }
      continue
    }

    // 兜底：无几何（不应发生，自检 CHK-09 会报）
    add({ type: 'none' }, null, { x: 0, y: 0, z: 0 })
  }

  // 顶盖 / 底盘裁片（方案 A：无层无棱档；图上只进档位牌）
  for (const c of capPanels) {
    if (!c.capSide) continue
    const si = c.capSide === 'top' ? sec(L) : sec(0)
    const pos = posCap(c.capSide)
    const ins: PosInstance = {
      memberId: c.id,
      label: c.label,
      edgeNo: null,
      pos,
      posText: positionText(pos),
      geom: { type: 'cap', side: c.capSide, radiusMm: roundMm(si.radiusMm), segments: g.polygon ? n : Math.max(48, n) },
      anchor: { x: 0, y: si.yMm, z: 0 }
    }
    pushInst(ins)
    bucket.push({ memberId: c.id, kind: 'cap', name: pos.bucket || c.label, qty: 1 })
  }

  return {
    scheme: POSITION_SCHEME,
    layers: L,
    n,
    polygon: g.polygon,
    kind: l.kind,
    heightMm: r1(g.heightMm),
    instances,
    byMember,
    bucket,
    sections: g.sections.map((s) => ({ index: s.index, yMm: roundMm(s.yMm), radiusMm: roundMm(s.radiusMm) }))
  }
}

function radiusOfSectionAtY(g: Geometry, yMm: number): number {
  // 收口支撑圈：用其实际高度在轮廓上取半径（与几何同口径）
  let best = g.sections[0].radiusMm
  let bestDy = Infinity
  for (const s of g.sections) {
    const dy = Math.abs(s.yMm - yMm)
    if (dy < bestDy) {
      bestDy = dy
      best = s.radiusMm
    }
  }
  return best
}

/* ---------------- 选择键（表 ↔ 图 互相落位） ---------------- */

/** 构件行键（点一行 = 该位置全部根数一起显） */
export function memberKey(memberId: string): string {
  return `M:${memberId}`
}

/** 单根键（点图上一根） */
export function instanceKey(memberId: string, edgeNo: number | null): string {
  return edgeNo == null ? `M:${memberId}` : `I:${memberId}:${edgeNo}`
}

/** 该实例属于的构件行键 */
export function instanceRowKey(ins: PosInstance): string {
  return memberKey(ins.memberId)
}

/** 判断某选择键是否命中某实例（点行 → 显该构件全部；点单根 → 只显一根） */
export function selectionHits(sel: string, ins: PosInstance): boolean {
  if (!sel) return false
  if (sel === memberKey(ins.memberId)) return true
  return sel === instanceKey(ins.memberId, ins.edgeNo)
}

/** 备料按位置分行：每根实例一行（长度取构件含余量长度），圈类每类一行 */
export interface PosStockRow {
  memberId: string
  label: string
  zone: PosZone
  posText: string
  edgeNo: number | null
  /** 该实例根数（恒 1，圈类也是整圈 1 根） */
  qty: number
  /** 单根截取长（含余量，mm） */
  lengthMm: number
  rawLengthMm: number
  layer: number | null
}

export function positionStockRows(members: FrameMember[], model: PositionModel): PosStockRow[] {
  const rows: PosStockRow[] = []
  for (const ins of model.instances) {
    const m = members.find((x) => x.id === ins.memberId)
    if (!m) continue // 顶盖/底盘裁片不在竹篾备料里
    rows.push({
      memberId: ins.memberId,
      label: ins.label,
      zone: ins.pos.zone,
      posText: ins.posText,
      edgeNo: ins.edgeNo,
      qty: 1,
      lengthMm: m.lengthMm,
      rawLengthMm: m.rawLengthMm,
      layer: ins.pos.layer
    })
  }
  // 稳定排序：无层无棱档在后，其余按层、圈口、棱号
  const zoneOrder: PosZone[] = ['base', 'body', 'mouth', 'shoulder', 'spoke', 'solid-edge', 'none']
  rows.sort((a, b) => {
    const za = zoneOrder.indexOf(a.zone)
    const zb = zoneOrder.indexOf(b.zone)
    if (za !== zb) return za - zb
    if ((a.layer ?? -1) !== (b.layer ?? -1)) return (a.layer ?? -1) - (b.layer ?? -1)
    return (a.edgeNo ?? 0) - (b.edgeNo ?? 0)
  })
  return rows
}

/** 方案 A 的取舍说明（界面与单子同一文案） */
export const POSITION_POLICY_TEXT =
  '位置方案 POS-A1：顶盖、底盘、中轴统一归「无层无棱档」（图上只列档不落位），代价是这几根在预览图上落不到灯体具体位置；换得改层数/棱数时这几根位置不漂移。'
