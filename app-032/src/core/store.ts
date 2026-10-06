/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 */
import { reactive, watch } from 'vue'
import type { Lantern } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'
import { positionFingerprint } from './position'

const KEY = 'lantern-frame-lofting.v1'

interface StaleInfo {
  /** 存档里记录的位置指纹 */
  saved: string
  /** 按当前参数应有的位置指纹 */
  current: string
  /** 变化的维度（层数/棱数/等分数/定位策略） */
  reasons: string[]
}

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
  /** 位置指纹已过期的灯样（存档位置、据其导出的清单与放样图都需作废重出） */
  stale: Record<string, StaleInfo>
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '', stale: {} })

let suspendPersist = false
let timer: number | undefined

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

/** 依据灯型库预设新建灯样 */
export function createFromPreset(presetId: string): Lantern {
  const preset = presetById(presetId) || PRESETS[0]
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  // 保证分段高度之和 = 总高
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = r1v(layers[layers.length - 1].heightMm + (p.totalHeightMm - sum))

  const now = new Date().toISOString()
  const lantern: Lantern = {
    id: makeId(),
    kind: preset.kind,
    name: preset.name,
    maxDiameterMm: p.maxDiameterMm,
    totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm,
    baseDiameterMm: p.baseDiameterMm,
    sides: p.sides,
    layers,
    mouthStyle: p.mouthStyle,
    bottomStyle: p.bottomStyle,
    smoothness: p.smoothness,
    ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions,
    covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
    lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors],
    color: p.color,
    batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio,
    pageSize: 'A4',
    overlapMm: CRAFT.defaultOverlapMm,
    positionPolicy: 'tier',
    posFingerprint: '',
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  lantern.posFingerprint = positionFingerprint(lantern)
  return lantern
}

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm） */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
}

/** 补齐老存档缺失的定位字段（老灯样默认走 tier 无层无棱档） */
function migrateLantern(l: Lantern) {
  if (l.positionPolicy !== 'tier' && l.positionPolicy !== 'nearest') l.positionPolicy = 'tier'
  if (typeof l.posFingerprint !== 'string') l.posFingerprint = ''
}

/** 比较存档指纹与当前参数，给出位置作废原因；一致返回 null */
export function staleInfoOf(l: Lantern): StaleInfo | null {
  migrateLantern(l)
  const saved = l.posFingerprint || ''
  const current = positionFingerprint(l)
  if (saved && saved === current) return null
  const reasons: string[] = []
  const savedParts = saved.split('|')
  const curParts = current.split('|')
  // [kind, layers, edges, policy]
  if (!saved) reasons.push('该灯样在统一位置编号上线前存档（无位置指纹）')
  if (savedParts[1] !== curParts[1]) reasons.push(`层数 ${savedParts[1] ?? '?'} → ${curParts[1]}`)
  if (savedParts[2] !== curParts[2]) {
    reasons.push(l.kind === 'revolution' ? `母线等分数 ${savedParts[2] ?? '?'} → ${curParts[2]}` : `棱数 ${savedParts[2] ?? '?'} → ${curParts[2]}`)
  }
  if (savedParts[3] !== curParts[3]) {
    reasons.push(`无层无棱定位路线 ${savedParts[3] ?? '?'} → ${curParts[3]}`)
  }
  return { saved, current, reasons }
}

/** 重新扫描全部灯样的位置过期状态 */
export function refreshStale() {
  for (const l of state.lanterns) {
    migrateLantern(l)
    const info = staleInfoOf(l)
    if (info) state.stale[l.id] = info
    else delete state.stale[l.id]
  }
}

/** 认定当前位置为准（旧存档位置/已发单据/已裁料均已作废重出后调用），刷新存档指纹 */
export function acknowledgePosition(l: Lantern) {
  migrateLantern(l)
  l.posFingerprint = positionFingerprint(l)
  l.updatedAt = new Date().toISOString()
  delete state.stale[l.id]
}

/** 分段高度均分（改总高/层数时调用） */
export function distributeLayers(l: Lantern) {
  const count = Math.max(1, Math.round(l.layers.length))
  const each = l.totalHeightMm / count
  l.layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  const sum = l.layers.reduce((s, x) => s + x.heightMm, 0)
  l.layers[count - 1].heightMm = r1v(l.layers[count - 1].heightMm + (l.totalHeightMm - sum))
  while (l.layerColors.length < count) l.layerColors.push(l.color)
  l.layerColors = l.layerColors.slice(0, count)
  syncLayerDiameters(l)
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const copy: Lantern = JSON.parse(JSON.stringify(src))
  copy.id = makeId()
  copy.name = src.name + ' 副本'
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

function persistNow() {
  suspendPersist = true
  try {
    for (const l of state.lanterns) {
      syncLayerDiameters(l)
      migrateLantern(l)
    }
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: state.lanterns }))
    state.storageError = ''
  } catch (e) {
    state.storageError = e instanceof Error ? e.message : String(e)
  } finally {
    suspendPersist = false
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/** 载入本地灯样；首次进入预置一个六角宫灯，便于立即放样 */
export function loadStore() {
  if (state.ready) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as { lanterns?: Lantern[] }
      if (Array.isArray(data.lanterns)) {
        data.lanterns.forEach(migrateLantern)
        state.lanterns = data.lanterns
      }
    }
  } catch {
    state.storageError = '本地灯样数据损坏，已重置'
  }
  if (state.lanterns.length === 0) {
    state.lanterns.push(createFromPreset('hex-palace'))
  }
  state.ready = true
  refreshStale()
  watch(
    () => state.lanterns,
    () => {
      if (suspendPersist) return
      schedulePersist()
      refreshStale()
    },
    { deep: true }
  )
  persistNow()
}

export function useLanternStore() {
  return {
    state,
    createFromPreset,
    addLantern,
    getLantern,
    duplicateLantern,
    removeLantern,
    distributeLayers,
    syncLayerDiameters,
    refreshStale,
    staleInfoOf,
    acknowledgePosition
  }
}
