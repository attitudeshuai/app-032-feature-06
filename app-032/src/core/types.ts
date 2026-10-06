/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'

export interface Point2 {
  x: number
  y: number
}

export interface Point3 {
  x: number
  y: number
  z: number
}

/**
 * 位置分区（方案 A：无层无棱构件统一归入显式的「无层无棱档」）。
 * body=层身段件  mouth=上口圈  base=底盘圈  shoulder=收口肩部支撑圈
 * spoke=走马灯辐条  none=无层无棱档（中轴、顶盖/底盘裁片）  solid-edge=正多面体棱（不分层）
 */
export type PosZone = 'body' | 'mouth' | 'base' | 'shoulder' | 'spoke' | 'none' | 'solid-edge'

/**
 * 构件在灯体上的位置（表、图、备料、导出、存档共用的同一份位置）。
 * 层号自底向上 1..L；棱/母线序号 1 起，俯视正上方为 1 号、顺时针递增，末号接 1 号（不断号、不重号）。
 * 坐标一律 mm 取整；界面换算 cm 时保留 1 位小数。
 */
export interface MemberPosition {
  zone: PosZone
  /** 层号 1..L；通长件为 null（跨全部层）；底盘圈为 0；上口圈为 L；无层无棱档为 null */
  layer: number | null
  /** 棱/母线序号起止；整圈一根（旋转体圈类）为 null */
  edgeStart: number | null
  edgeEnd: number | null
  /** 该位置的根数（必须与 FrameMember.qty 一致） */
  count: number
  /** 离底高度（mm，取整）；通长件/无档件省略（null） */
  yMm?: number | null
  /** 收口支撑圈等非截面圈的实际半径（mm，取整） */
  radiusMm?: number
  /** zone=none 时档内名称，如「中轴（走马灯转轴）」「顶盖圆片」「底盖圆片」 */
  bucket?: string
}

/** 分段（层）：高度为准，直径为轮廓派生结果 */
export interface LayerSpec {
  heightMm: number
  diameterMm: number
}

export interface Lantern {
  id: string
  kind: LanternKind
  name: string
  /** 最大直径（灯体最粗处） */
  maxDiameterMm: number
  /** 总高（= 各分段高度之和） */
  totalHeightMm: number
  /** 收口直径（上口） */
  mouthDiameterMm: number
  /** 底口直径（下口） */
  baseDiameterMm: number
  /** 棱数（prism/box）；旋转体时作为竖篾（母线篾）根数 */
  sides: number
  /** 分段高度与直径 */
  layers: LayerSpec[]
  /** 上收口方式 */
  mouthStyle: MouthStyle
  /** 下收口方式 */
  bottomStyle: MouthStyle
  /** 收口曲线强度 0~1 */
  smoothness: number
  /** 葫芦/花瓶形贝塞尔控制点（归一化：x 为半径插值比例，y 为肩部区间比例） */
  ctrl1: Point2
  ctrl2: Point2
  /** 旋转体母线等分数（默认 24，可调） */
  divisions: number
  /** 蒙面类型 */
  covering: Covering
  /** 缝份（mm，四边各加） */
  seamAllowanceMm: number
  /** 绑扎余量（mm，每端） */
  lashAllowanceMm: number
  /** 每层配色（长度 = layers.length，可短于层数则回落到主色） */
  layerColors: string[]
  /** 主色 */
  color: string
  /** 批量制灯数量 */
  batchCount: number
  /** 损耗率 0~0.2 */
  wasteRatio: number
  /** 1:1 打印纸张 */
  pageSize: PageSize
  /** 长条图跨页搭接量（mm） */
  overlapMm: number
  /**
   * 位置方案版本戳。POS-A1 = 统一无层无棱档方案（中轴/顶盖/底盘归档，不折算到层棱）。
   * 缺省或版本对不上即视为「老位置」：存档位置、已导出清单与放样图全部作废重出。
   */
  posVersion: string
  createdAt: string
  updatedAt: string
}

export interface FrameMember {
  id: string
  kind: MemberKind
  /** 名称，如「竖篾」「第 3 层横篾」「收口圈」 */
  label: string
  /** 截取长度（已含绑扎余量） */
  lengthMm: number
  /** 净长（不含余量） */
  rawLengthMm: number
  /** 建议弯曲半径（圆形圈 / 收口段） */
  bendRadiusMm?: number
  /** 折角（多边形圈的转角，度） */
  bendAngleDeg?: number
  /** 数量 */
  qty: number
  /** 分组：所属层或类别 */
  group: string
  /** 每根含几处绑扎余量 */
  lashJoints: number
  /** 统一位置（层/棱/圈口/无层无棱档）——表、图、备料、导出、存档共用 */
  pos: MemberPosition
  note?: string
}

export interface PanelMark {
  x: number
  y: number
  label: string
}

export interface Panel {
  id: string
  label: string
  shape: PanelShape
  /** 裁片下宽（已含缝份） */
  widthBottomMm: number
  /** 裁片上宽（已含缝份） */
  widthTopMm: number
  /** 裁片高（已含缝份） */
  heightMm: number
  seamAllowanceMm: number
  marksMm: PanelMark[]
  qty: number
  /** 展开净尺寸（不含缝份） */
  rawWidthTopMm: number
  rawWidthBottomMm: number
  rawHeightMm: number
  /** 圆形/正多边形裁片半径（净，不含缝份） */
  radiusMm?: number
  /** 正多边形边数（顶/底盖为多边形时） */
  polySides?: number
  /** 对应灯体层的索引（-1 表示顶/底盖） */
  layerIndex: number
  /** 顶/底盖侧（与 layerIndex=-1 配套；方案 A 归「无层无棱档」） */
  capSide?: 'top' | 'bottom'
  color: string
  note?: string
}

export interface MaterialTally {
  /** 备料竹篾/铁丝总长（m，含绑扎余量与损耗） */
  frameM: number
  /** 蒙面面积（m²，含缝份与损耗） */
  coveringM2: number
  /** 损耗率 */
  wasteRatio: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** LED 灯珠建议数量 */
  ledCount?: number
}

/** 构件与裁片的自检结果（对应规格书 §10） */
export interface CheckResult {
  id: string
  title: string
  pass: boolean
  detail: string
  /** 相关数值，便于界面展示 */
  value?: string
}
