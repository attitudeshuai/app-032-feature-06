/**
 * 骨架构件表（规格书 §4.3）
 * 绑扎余量：竖篾两端各加 lashAllowanceMm；横篾圈接头处按「圆形 1 处 / 多边形 n 处」加。
 * lengthMm（含余量）用于备料，rawLengthMm（净长）用于核对。
 *
 * 位置：每一根物理篾一条记录，pos 全部来自 core/position.ts 的同一套位置；
 * 表、预览图、备料、导出、本机存档不允许各自另算。
 * patternKey 相同的多根尺寸完全一致（如 n 根竖篾），1:1 长条图只出一份放样模板，
 * 备注截取根数与各自位置，不再重复出图。
 */
import type { FrameMember, Lantern } from './types'
import {
  buildGeometry,
  polygonEdge,
  polyhedronInfo,
  r1,
  segmentInfos,
  shoulderBendRadius,
  TAU,
  type Geometry
} from './geometry'
import { makePositions, type MemberPosition } from './position'

export interface FrameResult {
  geometry: Geometry
  members: FrameMember[]
  /** 构件总根数 */
  totalQty: number
  /** 备料总长（含余量，mm） */
  stockLengthMm: number
  /** 净长合计（mm） */
  rawLengthMm: number
  /** 全部绑扎余量合计（mm） */
  lashExtraMm: number
}

export function buildFrame(l: Lantern): FrameResult {
  const g = buildGeometry(l)
  const lash = Math.max(0, l.lashAllowanceMm)
  const members: FrameMember[] = []
  const P = makePositions(l, g)
  let seq = 0
  const push = (m: Omit<FrameMember, 'id'>) => {
    members.push({ ...m, id: `FM${String(++seq).padStart(3, '0')}` })
  }

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const isTetra = info.kind === 'tetra'
    const total = isTetra ? 6 : 12
    for (let j = 1; j <= total; j++) {
      push({
        kind: 'vertical',
        label: `${isTetra ? '正四面体' : '正八面体'}棱篾 ${j}/${total}`,
        rawLengthMm: r1(info.edgeMm),
        lengthMm: r1(info.edgeMm + 2 * lash),
        qty: 1,
        lashJoints: 2,
        bendAngleDeg: 60,
        group: '棱篾（无层无棱档）',
        pos: P.polyEdge(j),
        patternKey: 'POLY-EDGE',
        note: `端头夹角 60°（正三角形面角，两端各留 ${lash}mm 绑扎余量）；多面体无层无棱，棱序 ${j}/${total} 为稳定编号`
      })
    }
    return summarize(g, members)
  }

  const n = g.n
  const segs = segmentInfos(g)
  const cornerLength = segs.reduce((s, x) => s + x.slantMm, 0)

  if (l.kind === 'prism' || l.kind === 'box') {
    // 竖篾：每根一条，位置 = 第 1..L 层全长 · 第 j 棱
    for (let j = 1; j <= n; j++) {
      push({
        kind: 'vertical',
        label: `竖篾（第 ${j} 棱）`,
        rawLengthMm: r1(cornerLength),
        lengthMm: r1(cornerLength + 2 * lash),
        qty: 1,
        lashJoints: 2,
        group: '竖篾',
        pos: P.vertical(j),
        patternKey: 'VERTICAL',
        note: `沿轮廓折线长（${segs.length} 段累计），两端各留 ${lash}mm`
      })
    }

    const bendAngle = 180 - 360 / n
    // 中间各层横篾：每层 n 根，每根是两棱之间那一段
    for (let i = 1; i < g.sections.length - 1; i++) {
      const sec = g.sections[i]
      const edge = polygonEdge(sec.radiusMm, n)
      for (let j = 1; j <= n; j++) {
        const pos = P.ringSegment(i, sec.radiusMm, sec.yMm, j)
        push({
          kind: 'ring',
          label: `第 ${i} 层横篾 · 第 ${j} 段`,
          rawLengthMm: r1(edge),
          lengthMm: r1(edge + lash),
          qty: 1,
          lashJoints: 1,
          bendAngleDeg: r1(bendAngle),
          group: `横篾（第 ${i} 层）`,
          pos,
          patternKey: `RING-L${i}`,
          note: `层直径 ${r1(sec.radiusMm * 2)}mm，本段为第 ${j}–${j % n === 0 ? 1 : j + 1} 棱之间，含 1 处接头余量`
        })
      }
    }

    const topSec = g.sections[g.sections.length - 1]
    const botSec = g.sections[0]
    const topEdge = polygonEdge(topSec.radiusMm, n)
    const botEdge = polygonEdge(botSec.radiusMm, n)
    // 上口圈 / 底盘圈：各 n 根段
    for (let j = 1; j <= n; j++) {
      push({
        kind: 'mouth_ring',
        label: `上口圈 · 第 ${j} 段`,
        rawLengthMm: r1(topEdge),
        lengthMm: r1(topEdge + lash),
        qty: 1,
        lashJoints: 1,
        bendAngleDeg: r1(bendAngle),
        bendRadiusMm: r1(shoulderBendRadius(g.maxR - topSec.radiusMm, g.heightMm * g.kTop)),
        group: '上口圈',
        pos: P.rimSegment('mouth', topSec.radiusMm, topSec.yMm, j),
        patternKey: 'MOUTH',
        note: `上口外接直径 ${r1(topSec.radiusMm * 2)}mm，第 ${j}–${j % n === 0 ? 1 : j + 1} 棱之间，收口段曲率半径建议值`
      })
      push({
        kind: 'base_ring',
        label: `底盘圈 · 第 ${j} 段`,
        rawLengthMm: r1(botEdge),
        lengthMm: r1(botEdge + lash),
        qty: 1,
        lashJoints: 1,
        bendAngleDeg: r1(bendAngle),
        bendRadiusMm: r1(shoulderBendRadius(g.maxR - botSec.radiusMm, g.heightMm * g.kBot)),
        group: '底盘圈',
        pos: P.rimSegment('base', botSec.radiusMm, botSec.yMm, j),
        patternKey: 'BASE',
        note: `底盘外接直径 ${r1(botSec.radiusMm * 2)}mm，第 ${j}–${j % n === 0 ? 1 : j + 1} 棱之间`
      })
    }

    if (l.kind === 'box') {
      push({
        kind: 'spoke',
        label: '中轴（走马灯转轴）',
        rawLengthMm: r1(g.heightMm),
        lengthMm: r1(g.heightMm + 2 * lash),
        qty: 1,
        lashJoints: 2,
        group: l.positionPolicy === 'tier' ? '走马机构（无层无棱档）' : '走马机构（就近折算）',
        pos: P.axis(),
        patternKey: 'AXIS',
        note: '贯穿灯体中轴，两端各留绑扎余量'
      })
      const spokeLen = (botSec.radiusMm + topSec.radiusMm) / 2
      for (const end of ['top', 'bottom'] as const) {
        const r = end === 'top' ? topSec.radiusMm : botSec.radiusMm
        const y = end === 'top' ? topSec.yMm : botSec.yMm
        for (let j = 1; j <= n; j++) {
          push({
            kind: 'spoke',
            label: `${end === 'top' ? '上口' : '底盘'}辐条 · 朝第 ${j} 棱`,
            rawLengthMm: r1(spokeLen),
            lengthMm: r1(spokeLen + lash),
            qty: 1,
            lashJoints: 1,
            group: l.positionPolicy === 'tier' ? '走马机构（无层无棱档）' : '走马机构（就近折算）',
            pos: P.spoke(end, j, r, y),
            patternKey: `SPOKE-${end === 'top' ? 'T' : 'B'}`,
            note: `由中心到第 ${j} 号棱角支撑中轴，共 ${n} 根`
          })
        }
      }
    }
  } else {
    // 旋转体：母线根数 = 等分数 divisions（几何 n 在旋转体时仍取 sides，不能用作根数）
    const dn = Math.max(3, Math.round(l.divisions))
    for (let j = 1; j <= dn; j++) {
      push({
        kind: 'rib',
        label: `母线篾（第 ${j} 等分）`,
        rawLengthMm: r1(cornerLength),
        lengthMm: r1(cornerLength + 2 * lash),
        qty: 1,
        lashJoints: 2,
        group: '母线篾',
        pos: P.vertical(j),
        patternKey: 'RIB',
        note: `按母线折线长（${segs.length} 段累计），两端各留 ${lash}mm；等分序号 ${j}/${dn} 首尾相接`
      })
    }
    for (let i = 1; i < g.sections.length - 1; i++) {
      const sec = g.sections[i]
      const circ = TAU * sec.radiusMm
      push({
        kind: 'ring',
        label: `第 ${i} 层横篾圈`,
        rawLengthMm: r1(circ),
        lengthMm: r1(circ + lash),
        qty: 1,
        lashJoints: 1,
        bendRadiusMm: r1(sec.radiusMm),
        group: `横篾圈（第 ${i} 层）`,
        pos: P.ringFull(i, sec.radiusMm, sec.yMm),
        patternKey: `RING-L${i}`,
        note: `圈直径 ${r1(sec.radiusMm * 2)}mm，整圈一根（${dn} 等分定位），圆形圈 1 处接头`
      })
    }
    const topSec = g.sections[g.sections.length - 1]
    const botSec = g.sections[0]
    push({
      kind: 'mouth_ring',
      label: '上口圈',
      rawLengthMm: r1(TAU * topSec.radiusMm),
      lengthMm: r1(TAU * topSec.radiusMm + lash),
      qty: 1,
      lashJoints: 1,
      bendRadiusMm: r1(topSec.radiusMm),
      group: '上口圈',
      pos: P.rimFull('mouth', topSec.radiusMm, topSec.yMm),
      patternKey: 'MOUTH',
      note: `圈直径 ${r1(topSec.radiusMm * 2)}mm，弯曲半径 = 口径/2 = ${r1(topSec.radiusMm)}mm`
    })
    push({
      kind: 'base_ring',
      label: '底盘圈',
      rawLengthMm: r1(TAU * botSec.radiusMm),
      lengthMm: r1(TAU * botSec.radiusMm + lash),
      qty: 1,
      lashJoints: 1,
      bendRadiusMm: r1(botSec.radiusMm),
      group: '底盘圈',
      pos: P.rimFull('base', botSec.radiusMm, botSec.yMm),
      patternKey: 'BASE',
      note: `圈直径 ${r1(botSec.radiusMm * 2)}mm`
    })
    if (l.mouthStyle !== 'flat') {
      const supR = (topSec.radiusMm + g.maxR) / 2
      const supY = g.heightMm * (1 - g.kTop / 2)
      push({
        kind: 'ring',
        label: '收口支撑篾',
        rawLengthMm: r1(TAU * supR),
        lengthMm: r1(TAU * supR + lash),
        qty: 1,
        lashJoints: 1,
        bendRadiusMm: r1(shoulderBendRadius(g.maxR - topSec.radiusMm, g.heightMm * g.kTop)),
        group: l.positionPolicy === 'tier' ? '无层无棱档' : '收口圈（就近折算）',
        pos: P.support(supR, supY),
        patternKey: 'SUPPORT',
        note: '撑起收口肩部曲线，弯曲半径由收口口径与收口段高决定'
      })
    }
  }

  return summarize(g, members)
}

function summarize(geometry: Geometry, members: FrameMember[]): FrameResult {
  let totalQty = 0
  let stockLengthMm = 0
  let rawLengthMm = 0
  for (const m of members) {
    totalQty += m.qty
    stockLengthMm += m.lengthMm * m.qty
    rawLengthMm += m.rawLengthMm * m.qty
  }
  return {
    geometry,
    members,
    totalQty,
    stockLengthMm: r1(stockLengthMm),
    rawLengthMm: r1(rawLengthMm),
    lashExtraMm: r1(stockLengthMm - rawLengthMm)
  }
}

/** 构件按分组归并（构件表按类别分组展示） */
export function groupMembers(members: FrameMember[]): { group: string; items: FrameMember[] }[] {
  const order: string[] = []
  const map = new Map<string, FrameMember[]>()
  for (const m of members) {
    if (!map.has(m.group)) {
      map.set(m.group, [])
      order.push(m.group)
    }
    map.get(m.group)!.push(m)
  }
  return order.map((g) => ({ group: g, items: map.get(g)! }))
}

/** 1:1 长条图模板：patternKey 相同的多根尺寸一致，合并为一份放样模板 */
export interface StripPattern {
  patternKey: string
  /** 代表构件（取同组第一根，尺寸即模板尺寸） */
  member: FrameMember
  /** 本模板要截取的根数 */
  copies: number
  /** 每一根的统一位置（同一顺序） */
  positions: MemberPosition[]
}

export function stripPatterns(members: FrameMember[]): StripPattern[] {
  const map = new Map<string, StripPattern>()
  const order: string[] = []
  for (const m of members) {
    let p = map.get(m.patternKey)
    if (!p) {
      p = { patternKey: m.patternKey, member: m, copies: 0, positions: [] }
      map.set(m.patternKey, p)
      order.push(m.patternKey)
    }
    p.copies += m.qty
    for (let k = 0; k < m.qty; k++) p.positions.push(m.pos)
  }
  return order.map((k) => map.get(k)!)
}
