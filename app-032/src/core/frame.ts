/**
 * 骨架构件表（规格书 §4.3）
 * 绑扎余量：竖篾两端各加 lashAllowanceMm；横篾圈接头处按「圆形 1 处 / 多边形 n 处」加。
 * lengthMm（含余量）用于备料，rawLengthMm（净长）用于核对。
 *
 * 每个构件都带同一份位置 m.pos（层/棱/圈口/无层无棱档），位置模型由 buildFrame 一并产出；
 * 预览图、备料按位置分列、三份导出清单、本机存档都从这里取，改一处别处跟着刷新。
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
import {
  buildPositionModel,
  posBase,
  posLayerRing,
  posMouth,
  posNone,
  posRib,
  posShoulder,
  posSolidEdge,
  posSpoke,
  posVertical,
  type PositionModel
} from './positions'

export interface FrameResult {
  geometry: Geometry
  members: FrameMember[]
  /** 统一位置模型（实例到 mm 坐标；顶盖/底盘裁片在 buildFullPositionModel 中补入） */
  positions: PositionModel
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
  let seq = 0
  const push = (m: Omit<FrameMember, 'id'>) => {
    members.push({ ...m, id: `FM${String(++seq).padStart(3, '0')}` })
  }

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const isTetra = info.kind === 'tetra'
    const edgeCount = isTetra ? 6 : 12
    push({
      kind: 'vertical',
      label: isTetra ? '棱篾（正四面体）' : '棱篾（正八面体）',
      rawLengthMm: r1(info.edgeMm),
      lengthMm: r1(info.edgeMm + 2 * lash),
      qty: edgeCount,
      lashJoints: 2,
      bendAngleDeg: 60,
      group: '棱篾',
      pos: posSolidEdge(edgeCount),
      note: `端头夹角 60°（正三角形面角，两端各留 ${lash}mm 绑扎余量）；位置：无分层，棱 1–${edgeCount} 稳定编号`
    })
    return summarize(g, l, members)
  }

  const n = g.n
  const L = l.layers.length
  const segs = segmentInfos(g)
  const cornerLength = segs.reduce((s, x) => s + x.slantMm, 0)

  if (l.kind === 'prism' || l.kind === 'box') {
    push({
      kind: 'vertical',
      label: '竖篾',
      rawLengthMm: r1(cornerLength),
      lengthMm: r1(cornerLength + 2 * lash),
      qty: n,
      lashJoints: 2,
      group: '竖篾',
      pos: posVertical(n),
      note: `沿轮廓折线长（${segs.length} 段累计），两端各留 ${lash}mm；位置：通长，棱 1–${n}`
    })
    const bendAngle = 180 - 360 / n
    for (let i = 1; i < g.sections.length - 1; i++) {
      const r = g.sections[i].radiusMm
      const edge = polygonEdge(r, n)
      push({
        kind: 'ring',
        label: `第 ${i} 层横篾`,
        rawLengthMm: r1(edge),
        lengthMm: r1(edge + lash),
        qty: n,
        lashJoints: 1,
        bendAngleDeg: r1(bendAngle),
        group: `横篾（第 ${i} 层）`,
        pos: posLayerRing(i, g.sections[i].yMm, true, n),
        note: `圈直径 ${r1(r * 2)}mm，合围 ${n} 根（每根为一圈边，棱号即位置），含 1 处接头余量`
      })
    }
    const topR = g.sections[g.sections.length - 1].radiusMm
    const botR = g.sections[0].radiusMm
    const topEdge = polygonEdge(topR, n)
    const botEdge = polygonEdge(botR, n)
    push({
      kind: 'mouth_ring',
      label: '收口圈',
      rawLengthMm: r1(topEdge),
      lengthMm: r1(topEdge + lash),
      qty: n,
      lashJoints: 1,
      bendAngleDeg: r1(bendAngle),
      bendRadiusMm: r1(shoulderBendRadius(g.maxR - topR, g.heightMm * g.kTop)),
      group: '收口圈',
      pos: posMouth(L, g.sections[L].yMm, true, n),
      note: `收口外接直径 ${r1(topR * 2)}mm，合围 ${n} 根，收口段曲率半径建议值；位置：上口圈（第 ${L} 层顶）`
    })
    push({
      kind: 'base_ring',
      label: '底盘圈',
      rawLengthMm: r1(botEdge),
      lengthMm: r1(botEdge + lash),
      qty: n,
      lashJoints: 1,
      bendAngleDeg: r1(bendAngle),
      bendRadiusMm: r1(shoulderBendRadius(g.maxR - botR, g.heightMm * g.kBot)),
      group: '底盘圈',
      pos: posBase(g.sections[0].yMm, true, n),
      note: `底盘外接直径 ${r1(botR * 2)}mm，合围 ${n} 根；位置：底盘圈（0 层）`
    })
    if (l.kind === 'box') {
      push({
        kind: 'spoke',
        label: '中轴（走马灯转轴）',
        rawLengthMm: r1(g.heightMm),
        lengthMm: r1(g.heightMm + 2 * lash),
        qty: 1,
        lashJoints: 2,
        group: '走马机构',
        pos: posNone('中轴（走马灯转轴）'),
        note: `贯穿灯体中轴，两端各留绑扎余量；位置：无层无棱档（方案 POS-A1，图上只列档不落位）`
      })
      push({
        kind: 'spoke',
        label: '下辐条',
        rawLengthMm: r1(botR),
        lengthMm: r1(botR + lash),
        qty: n,
        lashJoints: 1,
        group: '走马机构',
        pos: posSpoke('bottom', n, g.sections[0].yMm, L),
        note: `${n} 根，底盘面由中心到棱角支撑中轴；位置：下辐条，棱 1–${n}`
      })
      push({
        kind: 'spoke',
        label: '上辐条',
        rawLengthMm: r1(topR),
        lengthMm: r1(topR + lash),
        qty: n,
        lashJoints: 1,
        group: '走马机构',
        pos: posSpoke('top', n, g.sections[L].yMm, L),
        note: `${n} 根，上口面由中心到棱角支撑中轴；位置：上辐条，棱 1–${n}`
      })
    }
  } else {
    // 旋转体：母线篾根数 = 母线等分数（= g.n = l.divisions），与展开片数一致、绕一圈首尾闭合
    push({
      kind: 'rib',
      label: '竖篾（母线篾）',
      rawLengthMm: r1(cornerLength),
      lengthMm: r1(cornerLength + 2 * lash),
      qty: n,
      lashJoints: 2,
      group: '竖篾',
      pos: posRib(n),
      note: `按母线折线长（${segs.length} 段累计），两端各留 ${lash}mm；位置：通长母线，序号 1–${n}（= ${l.divisions} 等分，末号接 1 号）`
    })
    for (let i = 1; i < g.sections.length - 1; i++) {
      const r = g.sections[i].radiusMm
      const circ = TAU * r
      push({
        kind: 'ring',
        label: `第 ${i} 层横篾圈`,
        rawLengthMm: r1(circ),
        lengthMm: r1(circ + lash),
        qty: 1,
        lashJoints: 1,
        bendRadiusMm: r1(r),
        group: `横篾圈（第 ${i} 层）`,
        pos: posLayerRing(i, g.sections[i].yMm, false, n),
        note: `圈直径 ${r1(r * 2)}mm，整圈 1 根，圆形圈 1 处接头；位置：第 ${i} 层整圈`
      })
    }
    const topR = g.sections[g.sections.length - 1].radiusMm
    const botR = g.sections[0].radiusMm
    push({
      kind: 'mouth_ring',
      label: '收口圈',
      rawLengthMm: r1(TAU * topR),
      lengthMm: r1(TAU * topR + lash),
      qty: 1,
      lashJoints: 1,
      bendRadiusMm: r1(topR),
      group: '收口圈',
      pos: posMouth(L, g.sections[L].yMm, false, n),
      note: `圈直径 ${r1(topR * 2)}mm，弯曲半径 = 口径/2 = ${r1(topR)}mm；位置：上口圈整圈（第 ${L} 层顶）`
    })
    push({
      kind: 'base_ring',
      label: '底盘圈',
      rawLengthMm: r1(TAU * botR),
      lengthMm: r1(TAU * botR + lash),
      qty: 1,
      lashJoints: 1,
      bendRadiusMm: r1(botR),
      group: '底盘圈',
      pos: posBase(g.sections[0].yMm, false, n),
      note: `圈直径 ${r1(botR * 2)}mm，整圈 1 根；位置：底盘圈整圈（0 层）`
    })
    if (l.mouthStyle !== 'flat') {
      const shoulderR = (topR + g.maxR) / 2
      // 收口支撑圈的实际高度：上收口段中点（与轮廓同口径插值）
      const yShoulder = g.heightMm * (1 - g.kTop / 2)
      const layerNearest = nearestLayer(g.sections, yShoulder)
      push({
        kind: 'ring',
        label: '收口支撑篾',
        rawLengthMm: r1(TAU * shoulderR),
        lengthMm: r1(TAU * shoulderR + lash),
        qty: 1,
        lashJoints: 1,
        bendRadiusMm: r1(shoulderBendRadius(g.maxR - topR, g.heightMm * g.kTop)),
        group: '收口圈',
        pos: posShoulder(layerNearest, yShoulder, shoulderR),
        note: `撑起收口肩部曲线，整圈 1 根，高约 ${r1(yShoulder)}mm（近第 ${layerNearest} 层），弯曲半径由收口口径与收口段高决定`
      })
    }
  }

  return summarize(g, l, members)
}

function nearestLayer(sections: Geometry['sections'], y: number): number {
  let best = 1
  let bestDy = Infinity
  for (let i = 1; i < sections.length - 1; i++) {
    const dy = Math.abs(sections[i].yMm - y)
    if (dy < bestDy) {
      bestDy = dy
      best = i
    }
  }
  return best
}

function summarize(geometry: Geometry, l: Lantern, members: FrameMember[]): FrameResult {
  let totalQty = 0
  let stockLengthMm = 0
  let rawLengthMm = 0
  for (const m of members) {
    totalQty += m.qty
    stockLengthMm += m.lengthMm * m.qty
    rawLengthMm += m.rawLengthMm * m.qty
  }
  // 统一位置模型：所有构件实例（顶盖/底盘裁片由 checks.computeAll 再补）
  const positions = buildPositionModel(l, geometry, members, [])
  return {
    geometry,
    members,
    positions,
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
