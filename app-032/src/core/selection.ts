/**
 * 表 ↔ 预览图联动选择（跨页面共享，按灯样 id 隔离）。
 * 选择键：
 *  - 点构件表一行  → memberKey（M:<memberId>）：该位置全部根数一起显；
 *  - 点图上一根    → instanceKey（I:<memberId>:<棱号>，整圈为 M:<memberId>）：只显那一根。
 * 点同一处取消选择。位置一律来自 positions.ts，表与图不靠各自维护的“老位置”。
 */
import { reactive } from 'vue'
import { instanceKey, memberKey } from './positions'

interface FigureSelection {
  key: string
  /** 选中来源（图/表），用于跨页打开时定位滚动 */
  from: 'figure' | 'table'
}

const sel = reactive<Record<string, FigureSelection>>({})

export function getSelection(lanternId: string): FigureSelection | undefined {
  return sel[lanternId]
}

export function selectedKey(lanternId: string): string {
  return sel[lanternId]?.key || ''
}

/** 点构件表一行 */
export function selectMember(lanternId: string, memberId: string) {
  const key = memberKey(memberId)
  if (sel[lanternId]?.key === key) delete sel[lanternId]
  else sel[lanternId] = { key, from: 'table' }
}

/** 点图上一根（edgeNo 为 null 表示整圈） */
export function selectInstance(lanternId: string, memberId: string, edgeNo: number | null) {
  const key = instanceKey(memberId, edgeNo)
  if (sel[lanternId]?.key === key) delete sel[lanternId]
  else sel[lanternId] = { key, from: 'figure' }
}

export function clearSelection(lanternId: string) {
  delete sel[lanternId]
}
