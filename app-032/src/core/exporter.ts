/** 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求）
 *  三份单子的构件位置列与表/图/备料/存档同源（member.pos）；
 *  单子头记录位置指纹，指纹与当前参数不符时头部直接标「本单位置已作废，请重出」。
 */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import { coveringSpec } from './craft'
import { positionFingerprint, cm1 } from './position'

/** 导出单据头：位置指纹与当前不符时给出作废标记 */
function posBanner(l: Lantern): string[] {
  const fp = positionFingerprint(l)
  const saved = l.posFingerprint || ''
  const lines = [`位置指纹:${fp}`]
  if (!saved || saved !== fp) {
    lines.unshift('【作废重出】本单依据的灯样位置编号已过期（层数/棱数/等分数或无层无棱定位路线变更），此单与已发放样图、已裁料请按新位置全部作废重做')
  }
  return lines
}

/** 无层无棱档与就近折算的位置备注（同一套说法） */
function posSuffix(m: FrameMember): string {
  if (m.pos.inNoTier) return '（无层无棱档，图上不落到具体层棱）'
  if (m.pos.nearestDerived) return '（位置为就近折算，层/棱数变更会挪动）'
  return ''
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function membersCsv(l: Lantern, members: FrameMember[]): string {
  const rows: (string | number)[][] = []
  rows.push([`花灯构件清单 · ${l.name}`])
  for (const b of posBanner(l)) rows.push([b])
  rows.push([`最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 位置坐标单位 mm（取整），显示换算 cm 保留 1 位 / 生成 ${new Date().toLocaleString()}`])
  rows.push([])
  rows.push(['构件名称', '第几层', '第几棱/圈', '上口圈/底盘圈', '位置坐标(mm，取整)', '类别', '分组', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '弯曲半径(mm)', '折角(°)', '备注'])
  for (const m of members) {
    const a = m.pos.anchorMm
    rows.push([
      m.label,
      m.pos.layerText,
      m.pos.edgeText,
      m.pos.rim === 'mouth' ? '上口圈' : m.pos.rim === 'base' ? '底盘圈' : '—',
      a ? `x${a.x} y${a.y} z${a.z}（cm：${cm1(a.x)}/${cm1(a.y)}/${cm1(a.z)}）` : '无层无棱档（不落坐标）',
      kindName(m.kind),
      m.group,
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      (m.note || '') + posSuffix(m)
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', '', '', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m`])
  return toCsv(rows)
}

export function panelsCsv(l: Lantern, panels: Panel[]): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 生成 ${new Date().toLocaleString()}`],
    [],
    ['裁片编号', '名称', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.qty,
      p.marksMm.length
    ])
  }
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = []
  rows.push([`备料单 · ${l.name}`])
  for (const b of posBanner(l)) rows.push([b])
  rows.push([`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g`])
  rows.push([])
  rows.push(['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`])
  rows.push(['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)])
  rows.push(['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)])
  rows.push([`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)])
  rows.push(['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)])
  rows.push(['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)])
  rows.push(['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)])
  rows.push(['LED 灯珠建议', single.ledCount, '颗', batch.ledCount])
  rows.push([])
  rows.push(['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)])
  rows.push(['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)])

  // 按位置分开的逐根用量（与构件表、预览图、存档同一套位置）
  rows.push([])
  rows.push(['—— 竹篾按位置分开备料（同一套位置：第几层·第几棱/上口圈/底盘圈；坐标 mm 取整）——'])
  rows.push(['位置身份键', '构件', '第几层', '第几棱/圈', '单灯截取(mm,含余量)', '单灯净长(mm)', '单灯根数', `批量截取合计(mm,×${batch.count}含损耗)`])
  for (const u of batch.byPosition) {
    rows.push([
      u.key,
      u.label,
      u.layerText,
      u.edgeText,
      u.lengthMm.toFixed(1),
      u.rawLengthMm.toFixed(1),
      u.qty,
      u.batchLengthMm.toFixed(1)
    ])
  }
  return toCsv(rows)
}

export function kindName(k: FrameMember['kind']): string {
  const map: Record<FrameMember['kind'], string> = {
    vertical: '竖篾',
    ring: '横篾',
    mouth_ring: '收口圈',
    base_ring: '底盘圈',
    rib: '母线篾',
    spoke: '辐条/中轴'
  }
  return map[k]
}

export function shapeName(s: Panel['shape']): string {
  const map: Record<Panel['shape'], string> = {
    trapezoid: '梯形',
    rectangle: '矩形',
    sector: '扇形',
    circle: '圆形/正多边形',
    triangle: '三角形'
  }
  return map[s]
}
