/** 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求）
 *  三份单子的「位置」列与表、预览图、备料、本机存档同属位置方案 POS-A1（见 positions.ts）。 */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import type { PosStockRow } from './positions'
import { POSITION_POLICY_TEXT, POSITION_SCHEME, positionText } from './positions'
import { coveringSpec } from './craft'

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
  const rows: (string | number)[][] = [
    [`花灯构件清单 · ${l.name}`],
    [`位置方案 ${l.posVersion || POSITION_SCHEME}（存档戳：${l.posVersion || '无-老位置待重认'}） · 最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 生成 ${new Date().toLocaleString()}`],
    [POSITION_POLICY_TEXT],
    ['位置坐标 mm 取整，cm 保留 1 位；棱/母线序号自俯视正上方 1 号顺时针递增，末号接 1 号。'],
    [],
    ['构件名称', '类别', '分组', '位置（层/棱/圈口/档）', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '弯曲半径(mm)', '折角(°)', '备注']
  ]
  for (const m of members) {
    rows.push([
      m.label,
      kindName(m.kind),
      m.group,
      positionText(m.pos),
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      m.note || ''
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m`])
  return toCsv(rows)
}

/** 备料按位置分列（每根/每圈一行）——与构件表、预览图同一套位置 */
export function positionStockCsv(l: Lantern, rows: PosStockRow[], batchCount: number, wasteRatio: number): string {
  const out: (string | number)[][] = [
    [`备料按位置分列 · ${l.name}`],
    [`位置方案 ${l.posVersion || POSITION_SCHEME}（存档戳：${l.posVersion || '无-老位置待重认'}）· 单位 mm 取整 · 生成 ${new Date().toLocaleString()}`],
    [POSITION_POLICY_TEXT],
    [],
    ['位置（层/棱/圈口/档）', '构件名称', '棱/圈序号', '根数', '单根净长(mm)', '单根截取长(mm,含余量)', `批量 ${batchCount} 个总截取长(mm,含 ${(wasteRatio * 100).toFixed(0)}%损耗)`]
  ]
  let single = 0
  for (const r of rows) {
    single += r.lengthMm
    out.push([
      r.posText,
      r.label,
      r.edgeNo == null ? '整圈' : String(r.edgeNo),
      r.qty,
      r.rawLengthMm.toFixed(1),
      r.lengthMm.toFixed(1),
      (r.lengthMm * batchCount * (1 + wasteRatio)).toFixed(1)
    ])
  }
  out.push([])
  out.push(['单灯合计', '', '', rows.length, '', single.toFixed(1), (single * batchCount * (1 + wasteRatio)).toFixed(1)])
  return toCsv(out)
}

export function panelsCsv(l: Lantern, panels: Panel[]): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [`位置方案 ${l.posVersion || POSITION_SCHEME}（存档戳：${l.posVersion || '无-老位置待重认'}）· 蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 生成 ${new Date().toLocaleString()}`],
    [POSITION_POLICY_TEXT],
    [],
    ['裁片编号', '名称', '形状', '位置（层/无层无棱档）', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      panelPositionText(p),
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

/** 裁片位置文字（与位置模型同一口径） */
export function panelPositionText(p: Panel): string {
  if (p.layerIndex < 0) {
    return p.capSide === 'top' ? '无层无棱档 · 顶盖圆片' : p.capSide === 'bottom' ? '无层无棱档 · 底盖圆片' : '无层无棱档 · 顶/底盖'
  }
  return `第 ${p.layerIndex + 1} 层`
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`位置方案 ${l.posVersion || POSITION_SCHEME}（存档戳：${l.posVersion || '无-老位置待重认'}）· 生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g`],
    [POSITION_POLICY_TEXT],
    ['备料按位置分见解出的「备料按位置分列」表；竹篾长度按含绑扎余量计。'],
    [],
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)],
    [`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount],
    [],
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)]
  ]
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
