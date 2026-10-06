<script setup lang="ts">
/**
 * 灯体预览：正视 / 俯视 / 等轴测示意（不做 3D 渲染，等轴测为线框投影）。
 * 所有可点选段都来自统一位置模型（positions.ts）——与构件表、备料、导出、存档同一份位置。
 * 点图上一根 → 通知父组件选中该实例（selectInstance）；点构件表一行 → 对应段高亮。
 * 无层无棱档（中轴、顶盖、底盘裁片）只在灯体旁的「档位牌」里列出，不落到灯体坐标（方案 POS-A1）。
 */
import { computed, ref } from 'vue'
import type { FrameMember, Lantern } from '../core/types'
import { buildGeometry, radiusAtY, segmentInfos, topShoulder } from '../core/geometry'
import {
  buildPositionModel,
  instanceText,
  mmToCm,
  positionText,
  selectionHits,
  type PosInstance,
  type PositionModel
} from '../core/positions'

const props = defineProps<{
  lantern: Lantern
  mode: 'front' | 'top' | 'iso'
  interactive?: boolean
  /** 外部传入的位置模型（构件 + 顶盖/底盘裁片）；不传则只画构件段 */
  model?: PositionModel
  /** 当前选中键（selection.ts 的 selectedKey） */
  selected?: string
  /** 可选：构件表（用于在提示里显示长度） */
  members?: FrameMember[]
}>()
const emit = defineEmits<{
  (e: 'update-ctrl', v: { which: 1 | 2; x: number; y: number }): void
  (e: 'pick', memberId: string, edgeNo: number | null): void
}>()

const g = computed(() => buildGeometry(props.lantern))
/** 位置模型：优先用父级的（含顶盖/底盘），否则用仅构件的 */
const pm = computed<PositionModel>(() => props.model || buildPositionModel(props.lantern, g.value, [], []))
const dragging = ref<0 | 1 | 2>(0)
const hoverId = ref('')

const PAD = 46
const viewBox = computed(() => {
  const geo = g.value
  if (props.mode === 'front') {
    return `0 0 ${geo.maxR * 2 + PAD * 2} ${geo.heightMm + PAD * 2}`
  }
  if (props.mode === 'top') {
    const s = geo.maxR * 2 + PAD * 1.2
    return `0 0 ${s} ${s}`
  }
  const p = isoFrame.value
  return `${p.minX} ${p.minY} ${p.w} ${p.h}`
})

const FRONT_W = computed(() => g.value.maxR * 2 + PAD * 2)
const FRONT_H = computed(() => g.value.heightMm + PAD * 2)
const sx = (x: number) => FRONT_W.value / 2 + x
const sy = (y: number) => FRONT_H.value - PAD - y

/* ---------------- 投影（mm 3D → 视图 2D） ---------------- */
const projectFront = (p: { x: number; y: number; z: number }) => ({ X: sx(p.x), Y: sy(p.y) })
const projectTop = (p: { x: number; y: number; z: number }) => {
  const c = (g.value.maxR * 2 + PAD * 1.2) / 2
  return { X: c + p.x, Y: c - p.z }
}
const isoProj = (p: { x: number; y: number; z: number }) => ({ X: (p.x - p.z) * 0.866, Y: p.y - (p.x + p.z) * 0.5 })

/** 等轴测视图框（由位置模型全部点取边界，确保多面体棱也在内） */
const isoFrame = computed(() => {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const eat = (p: { x: number; y: number; z: number }) => {
    const q = isoProj(p)
    minX = Math.min(minX, q.X)
    maxX = Math.max(maxX, q.X)
    minY = Math.min(minY, q.Y)
    maxY = Math.max(maxY, q.Y)
  }
  for (const ins of pm.value.instances) {
    if (ins.geom.type === 'cap') continue
    if (ins.geom.type === 'hoop') {
      const seg = ins.geom.segments
      for (let k = 0; k < seg; k++) {
        const a = -Math.PI / 2 + (2 * Math.PI * k) / seg
        eat({ x: ins.geom.radiusMm * Math.cos(a), y: ins.geom.yMm, z: ins.geom.radiusMm * Math.sin(a) })
      }
    } else if (ins.geom.type === 'polyline') {
      ins.geom.pts.forEach(eat)
    }
  }
  if (!Number.isFinite(minX)) {
    minX = -g.value.maxR
    maxX = g.value.maxR
    minY = 0
    maxY = g.value.heightMm
  }
  const pad = 24
  return { minX: minX - pad, minY: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
})

interface DrawSeg {
  id: string
  ins: PosInstance
  d: string
  /** 闭合形状（圈）用元素类型区分 */
  closed: boolean
}

function segsFor(mode: 'front' | 'top' | 'iso'): DrawSeg[] {
  const out: DrawSeg[] = []
  // iso 的 viewBox 原点 = isoFrame.min（含 pad），投影后要减去该原点
  const projectIso = (p: { x: number; y: number; z: number }) => {
    const q = isoProj(p)
    return { X: q.X - isoFrame.value.minX, Y: q.Y - isoFrame.value.minY }
  }
  const P = mode === 'front' ? projectFront : mode === 'top' ? projectTop : projectIso
  const f1 = (v: number) => v.toFixed(1)

  pm.value.instances.forEach((ins, idx) => {
    const id = `${idx}:${ins.memberId}:${ins.edgeNo ?? 'H'}`
    const gm = ins.geom
    if (gm.type === 'none' || gm.type === 'cap') return
    if (gm.type === 'hoop') {
      const seg = gm.segments
      let d = ''
      for (let k = 0; k <= seg; k++) {
        const a = -Math.PI / 2 + (2 * Math.PI * (k % seg)) / seg
        const q = P({ x: gm.radiusMm * Math.cos(a), y: gm.yMm, z: gm.radiusMm * Math.sin(a) })
        d += `${k === 0 ? 'M' : 'L'} ${f1(q.X)} ${f1(q.Y)} `
      }
      d += 'Z'
      out.push({ id, ins, d, closed: true })
      return
    }
    // polyline
    const pts = gm.pts.map(P)
    const d = pts.map((q, i) => `${i === 0 ? 'M' : 'L'} ${f1(q.X)} ${f1(q.Y)}`).join(' ')
    out.push({ id, ins, d, closed: false })
  })
  return out
}

const frontSegs = computed(() => segsFor('front'))
const topSegs = computed(() => segsFor('top'))
const isoSegs = computed(() => segsFor('iso'))

function segClass(ins: PosInstance): string {
  const z = ins.pos.zone
  if (z === 'mouth') return 'seg-mouth'
  if (z === 'base') return 'seg-base'
  if (z === 'shoulder') return 'seg-shoulder'
  if (z === 'spoke') return 'seg-spoke'
  if (z === 'solid-edge') return 'seg-solid'
  if (ins.memberId.startsWith('P')) return 'seg-cap'
  return 'seg-body'
}

function isOn(ins: PosInstance): boolean {
  return !!props.selected && selectionHits(props.selected, ins)
}

/** 俯视顶点处的小圆点（竖篾/母线篈的棱号落点） */
const topDots = computed(() => {
  if (props.mode !== 'top') return []
  const c = (g.value.maxR * 2 + PAD * 1.2) / 2
  const out: { id: string; iid: string; X: number; Y: number; label: string; ins: PosInstance }[] = []
  pm.value.instances.forEach((ins, idx) => {
    // 竖篾/母线篾的棱号落点（通长、body 区、有棱号）；多面体棱不在俯视标棱号
    if (ins.pos.zone !== 'body' || ins.pos.layer !== null || ins.edgeNo == null) return
    const a = -Math.PI / 2 + (2 * Math.PI * (ins.edgeNo - 1)) / pm.value.n
    const r = g.value.maxR
    out.push({
      id: `dot-${ins.memberId}-${ins.edgeNo}`,
      iid: `${idx}:${ins.memberId}:${ins.edgeNo}`,
      X: c + r * Math.cos(a),
      Y: c - r * Math.sin(a),
      label: String(ins.edgeNo),
      ins
    })
  })
  // 棱柱/旋转体各只保留一套棱号点（竖篾那套），按棱号去重
  const map = new Map<string, (typeof out)[number]>()
  for (const d of out) if (!map.has(d.label)) map.set(d.label, d)
  return [...map.values()]
})

/** 档位牌（无层无棱档：中轴、顶盖、底盘） */
const bucketChips = computed(() =>
  pm.value.bucket.map((b) => {
    const ins = pm.value.byMember.get(b.memberId)?.[0]
    return {
      id: b.memberId,
      name: b.name,
      qty: b.qty,
      posText: ins ? positionText(ins.pos) : '无层无棱档',
      on: ins ? isOn(ins) : false,
      isCap: b.kind === 'cap'
    }
  })
)

function findIns(iid: string): PosInstance | null {
  if (!iid) return null
  const parts = iid.split(':')
  if (parts.length < 3) return null
  const memberId = parts[1]
  const tail = parts[2]
  const edgeNo = tail === 'H' ? null : Number(tail)
  return (
    pm.value.instances.find((ins) => ins.memberId === memberId && (edgeNo == null ? ins.edgeNo == null : ins.edgeNo === edgeNo)) ||
    null
  )
}

const hoverIns = computed<PosInstance | null>(() => findIns(hoverId.value))

const activeIns = computed<PosInstance | null>(() => {
  if (!props.selected) return null
  return pm.value.instances.find((ins) => isOn(ins)) || null
})

function memberOf(ins: PosInstance): FrameMember | undefined {
  return props.members?.find((m) => m.id === ins.memberId)
}

function infoText(ins: PosInstance | null): string {
  if (!ins) return ''
  const m = memberOf(ins)
  const len = m ? ` · 截取 ${m.lengthMm.toFixed(1)}mm（净 ${m.rawLengthMm.toFixed(1)}mm）` : ''
  const coord = ins.pos.zone === 'none' ? '' : ` · 定位点 (${mmToCm(ins.anchor.x).toFixed(1)}, ${mmToCm(ins.anchor.y).toFixed(1)}, ${mmToCm(ins.anchor.z).toFixed(1)}) cm`
  return `${ins.label}：${instanceText(ins)}${len}${coord}`
}

function onSegClick(evt: MouseEvent) {
  const el = evt.target as SVGElement
  const iid = el.getAttribute('data-iid')
  if (!iid) return
  const parts = iid.split(':')
  const memberId = parts[1]
  const tail = parts[2]
  emit('pick', memberId, tail === 'H' ? null : Number(tail))
}

function onChipClick(memberId: string) {
  emit('pick', memberId, null)
}

function onSegEnter(evt: MouseEvent) {
  hoverId.value = (evt.target as SVGElement).getAttribute('data-iid') || ''
}
function onSegLeave() {
  hoverId.value = ''
}

/** 每层的侧面色带 */
const bands = computed(() => {
  const geo = g.value
  const segs = segmentInfos(geo)
  return segs.map((s, i) => {
    const pts: { x: number; y: number }[] = []
    const steps = 18
    for (let k = 0; k <= steps; k++) {
      const y = s.y0Mm + ((s.y1Mm - s.y0Mm) * k) / steps
      pts.push({ x: radiusAtY(geo.profile, y), y })
    }
    const right = pts.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
    const left = [...pts].reverse().map((p) => `${sx(-p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
    return {
      d: `M ${right.join(' L ')} L ${left.join(' L ')} Z`,
      color: props.lantern.layerColors[i] || props.lantern.color,
      y0: s.y0Mm,
      y1: s.y1Mm
    }
  })
})

const outlinePath = computed(() => {
  const geo = g.value
  const pts: { x: number; y: number }[] = []
  const N = 64
  for (let k = 0; k <= N; k++) {
    const y = (geo.heightMm * k) / N
    pts.push({ x: radiusAtY(geo.profile, y), y })
  }
  const right = pts.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
  const left = [...pts].reverse().map((p) => `${sx(-p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
  return `M ${right.join(' L ')} L ${left.join(' L ')} Z`
})

/** 各层截面的标注位置（正视） */
const ringMarks = computed(() =>
  g.value.sections.map((s) => ({
    y: sy(s.yMm),
    x: sx(-s.radiusMm),
    label: s.index === 0 ? '0·底盘' : s.index === g.value.sections.length - 1 ? `${s.index}·上口` : `${s.index}`
  }))
)

const gridLines = computed(() => {
  const geo = g.value
  const out: { y: number; label: string }[] = []
  const step = geo.heightMm > 600 ? 200 : geo.heightMm > 300 ? 100 : 50
  for (let y = step; y < geo.heightMm; y += step) out.push({ y: sy(y), label: String(y) })
  return out
})

const shoulder = computed(() => topShoulder(props.lantern, g.value))

function clientToMm(evt: PointerEvent, el: SVGSVGElement) {
  const rect = el.getBoundingClientRect()
  const vb = viewBox.value.split(' ').map(Number)
  const scale = Math.min(rect.width / vb[2], rect.height / vb[3])
  const offX = (rect.width - vb[2] * scale) / 2
  const offY = (rect.height - vb[3] * scale) / 2
  const xMm = (evt.clientX - rect.left - offX) / scale + vb[0]
  const yMm = (evt.clientY - rect.top - offY) / scale + vb[1]
  return { xMm, yMm }
}

function startDrag(which: 1 | 2, evt: PointerEvent) {
  if (!props.interactive || props.lantern.mouthStyle !== 'gourd') return
  dragging.value = which
  const el = evt.currentTarget as SVGSVGElement
  try {
    el.setPointerCapture?.(evt.pointerId)
  } catch {
    // 指针已释放或不被支持时忽略
  }
}

function onMove(evt: PointerEvent) {
  if (!dragging.value || !shoulder.value) return
  const el = evt.currentTarget as SVGSVGElement
  const { xMm, yMm } = clientToMm(evt, el)
  const xRadius = xMm - FRONT_W.value / 2
  const yHeight = FRONT_H.value - PAD - yMm
  const s = shoulder.value
  const dx = s.p3.x - s.p0.x
  const dy = s.p3.y - s.p0.y
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return
  const nx = (xRadius - s.p0.x) / dx
  const ny = (yHeight - s.p0.y) / dy
  emit('update-ctrl', {
    which: dragging.value,
    x: Math.min(1.6, Math.max(0.02, nx)),
    y: Math.min(0.92, Math.max(0.02, ny))
  })
}

function endDrag() {
  dragging.value = 0
}
</script>

<template>
  <div class="preview" :class="`preview-${mode}`">
    <!-- 正视图 -->
    <svg
      v-if="mode === 'front'"
      class="svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      @pointermove="onMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @click="onSegClick"
    >
      <rect class="bg-hit" :x="0" :y="0" :width="FRONT_W" :height="FRONT_H" data-iid="" @click.stop="emit('pick', '', null)" />

      <g class="grid">
        <line v-for="gl in gridLines" :key="gl.y" :x1="6" :x2="FRONT_W - 6" :y1="gl.y" :y2="gl.y" />
        <text v-for="gl in gridLines" :key="'t' + gl.y" :x="8" :y="gl.y - 2" class="grid-label">{{ gl.label }}</text>
      </g>

      <path
        v-for="(b, i) in bands"
        :key="i"
        :d="b.d"
        :fill="b.color"
        fill-opacity="0.5"
        stroke="rgba(60,30,20,0.3)"
        stroke-width="0.4"
      />
      <path :d="outlinePath" fill="none" stroke="#7a2b1c" stroke-width="1.1" />

      <!-- 统一位置段（每根/每圈都可点） -->
      <g class="seg-layer">
        <path
          v-for="s in frontSegs"
          :key="s.id"
          :data-iid="s.id"
          :d="s.d"
          class="seg"
          :class="[segClass(s.ins), { on: isOn(s.ins), faint: selected && !isOn(s.ins) }]"
          @mouseenter="onSegEnter"
          @mouseleave="onSegLeave"
        />
      </g>

      <!-- 层号标注（底盘 0 / 上口 L） -->
      <g class="layer-marks">
        <template v-for="(r, i) in ringMarks" :key="'rm' + i">
          <circle :cx="r.x" :cy="r.y" r="1.6" />
          <text :x="r.x - 2" :y="r.y + 2.6" text-anchor="end" class="layer-label">{{ r.label }}</text>
        </template>
      </g>

      <!-- 尺寸标注 -->
      <g class="dim">
        <line :x1="sx(-g.maxR)" :x2="sx(g.maxR)" :y1="FRONT_H - 16" :y2="FRONT_H - 16" />
        <line :x1="sx(-g.maxR)" :x2="sx(-g.maxR)" :y1="FRONT_H - 20" :y2="FRONT_H - 12" />
        <line :x1="sx(g.maxR)" :x2="sx(g.maxR)" :y1="FRONT_H - 20" :y2="FRONT_H - 12" />
        <text :x="FRONT_W / 2" :y="FRONT_H - 5" text-anchor="middle">最大直径 {{ g.maxR * 2 }}mm</text>
        <line :x1="FRONT_W - 14" :x2="FRONT_W - 14" :y1="sy(0)" :y2="sy(g.heightMm)" />
        <line :x1="FRONT_W - 18" :x2="FRONT_W - 10" :y1="sy(0)" :y2="sy(0)" />
        <line :x1="FRONT_W - 18" :x2="FRONT_W - 10" :y1="sy(g.heightMm)" :y2="sy(g.heightMm)" />
        <text
          :x="FRONT_W - 6"
          :y="sy(g.heightMm / 2)"
          text-anchor="middle"
          :transform="`rotate(90 ${FRONT_W - 6} ${sy(g.heightMm / 2)})`"
        >
          总高 {{ g.heightMm }}mm
        </text>
      </g>

      <!-- 收口贝塞尔控制点 -->
      <g v-if="shoulder" class="ctrl">
        <line :x1="sx(shoulder.p0.x)" :y1="sy(shoulder.p0.y)" :x2="sx(shoulder.p1.x)" :y2="sy(shoulder.p1.y)" />
        <line :x1="sx(shoulder.p3.x)" :y1="sy(shoulder.p3.y)" :x2="sx(shoulder.p2.x)" :y2="sy(shoulder.p2.y)" />
        <line :x1="sx(shoulder.p1.x)" :y1="sy(shoulder.p1.y)" :x2="sx(shoulder.p2.x)" :y2="sy(shoulder.p2.y)" />
        <template v-if="interactive && lantern.mouthStyle === 'gourd'">
          <circle :cx="sx(shoulder.p1.x)" :cy="sy(shoulder.p1.y)" r="5" class="handle" :class="{ active: dragging === 1 }" @pointerdown.stop="startDrag(1, $event)" />
          <circle :cx="sx(shoulder.p2.x)" :cy="sy(shoulder.p2.y)" r="5" class="handle" :class="{ active: dragging === 2 }" @pointerdown.stop="startDrag(2, $event)" />
          <text :x="sx(shoulder.p1.x) + 7" :y="sy(shoulder.p1.y) - 6" class="ctrl-label">控制点 1</text>
          <text :x="sx(shoulder.p2.x) + 7" :y="sy(shoulder.p2.y) - 6" class="ctrl-label">控制点 2</text>
        </template>
      </g>
    </svg>

    <!-- 俯视图 -->
    <svg v-else-if="mode === 'top'" class="svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" @click="onSegClick">
      <g :transform="`translate(${(g.maxR * 2 + PAD * 1.2) / 2},${(g.maxR * 2 + PAD * 1.2) / 2})`">
        <g class="plan-grid">
          <circle :r="g.maxR" fill="none" stroke-dasharray="3 3" />
          <line :x1="-g.maxR - 10" :x2="g.maxR + 10" :y1="0" :y2="0" />
          <line :x1="0" :x2="0" :y1="-g.maxR - 10" :y2="g.maxR + 10" />
        </g>

        <g class="seg-layer">
          <path
            v-for="s in topSegs"
            :key="s.id"
            :data-iid="s.id"
            :d="s.d"
            class="seg"
            :class="[segClass(s.ins), { on: isOn(s.ins), faint: selected && !isOn(s.ins) }]"
            @mouseenter="onSegEnter"
            @mouseleave="onSegLeave"
          />
        </g>

        <!-- 棱号点（竖篾/母线篈落点，1 号在正上方，顺时针） -->
        <g class="edge-dots">
          <template v-for="d in topDots" :key="d.id">
            <circle
              :data-iid="d.iid"
              :cx="d.X - (g.maxR * 2 + PAD * 1.2) / 2"
              :cy="d.Y - (g.maxR * 2 + PAD * 1.2) / 2"
              r="3.2"
              class="dot"
              :class="{ on: isOn(d.ins) }"
              @mouseenter="hoverId = d.iid"
              @mouseleave="hoverId = ''"
            />
            <text
              :x="d.X - (g.maxR * 2 + PAD * 1.2) / 2"
              :y="d.Y - (g.maxR * 2 + PAD * 1.2) / 2 - 5"
              text-anchor="middle"
              class="edge-no"
              :class="{ on: isOn(d.ins) }"
            >
              {{ d.label }}
            </text>
          </template>
        </g>

        <text :x="0" :y="-g.maxR - 20" text-anchor="middle" class="dim-text">
          俯视 · 外接 ⌀{{ (g.maxR * 2).toFixed(1) }}mm / {{ g.polygon ? g.n + ' 棱' : `旋转体 ${pm.n} 等分（母线根数）` }} · 棱号自正上方 1 号顺时针
        </text>
      </g>
    </svg>

    <!-- 等轴测 -->
    <svg v-else class="svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" @click="onSegClick">
      <g class="seg-layer">
        <path
          v-for="s in isoSegs"
          :key="s.id"
          :data-iid="s.id"
          :d="s.d"
          class="seg"
          :class="[segClass(s.ins), { on: isOn(s.ins), faint: selected && !isOn(s.ins) }]"
          @mouseenter="onSegEnter"
          @mouseleave="onSegLeave"
        />
      </g>
      <text :x="isoFrame.minX + 12 - isoFrame.minX" :y="isoFrame.minY + 16 - isoFrame.minY" class="dim-text">
        等轴测线框（非 3D 渲染）· 每根篾按统一位置绘制
      </text>
    </svg>

    <!-- 档位牌：无层无棱档（方案 POS-A1，图上不落灯体位置） -->
    <div class="bucket" @click.stop>
      <span class="bucket-title">无层无棱档（图上不列灯体位置）：</span>
      <button
        v-for="c in bucketChips"
        :key="c.id"
        type="button"
        class="chip"
        :class="{ on: c.on }"
        :title="c.posText"
        @click="onChipClick(c.id)"
      >
        {{ c.name }}<em>×{{ c.qty }}</em>
      </button>
      <span v-if="!bucketChips.length" class="bucket-empty">（本灯样无）</span>
    </div>

    <!-- 选中/悬停信息条：位置、长度、mm/cm 坐标 -->
    <div class="info-line" :class="{ active: activeIns || hoverIns }">
      <template v-if="activeIns || hoverIns">
        <b>{{ activeIns || hoverIns ? infoText(activeIns || hoverIns) : '' }}</b>
        <small>位置坐标 mm 取整 · cm 保留 1 位 · {{ pm.scheme }}</small>
      </template>
      <template v-else>
        <span>点灯体上任一根篾 → 构件表落到对应行；点表中一行 → 此根高亮。</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.preview {
  width: 100%;
  height: 100%;
  min-height: 240px;
  background: radial-gradient(circle at 50% 30%, #fffdf7, #f6efe3 70%);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.svg {
  width: 100%;
  flex: 1;
  min-height: 220px;
  display: block;
  touch-action: none;
}

.bg-hit {
  fill: transparent;
}

.grid line {
  stroke: rgba(160, 140, 110, 0.22);
  stroke-width: 0.3;
}

.grid-label {
  font-size: 7px;
  fill: #a08c6e;
}

.dim line {
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.dim text {
  font-size: 9px;
  fill: #2f5f8a;
}

.ctrl line {
  stroke: #2f7a63;
  stroke-width: 0.4;
  stroke-dasharray: 2 1.5;
}

.handle {
  fill: #fff;
  stroke: #2f7a63;
  stroke-width: 1.4;
  cursor: grab;
  pointer-events: all;
}

.handle.active {
  fill: #2f7a63;
  cursor: grabbing;
}

.ctrl-label {
  font-size: 7.5px;
  fill: #2f7a63;
}

.plan-grid line,
.plan-grid circle {
  stroke: rgba(160, 140, 110, 0.5);
  stroke-width: 0.4;
}

.dim-text {
  font-size: 8px;
  fill: #6a5c52;
}

.layer-marks circle {
  fill: rgba(122, 43, 28, 0.55);
}

.layer-label {
  font-size: 6.5px;
  fill: #8a5a44;
}

/* ---------- 统一位置段 ---------- */
.seg {
  fill: none;
  cursor: pointer;
  transition: stroke-width 0.08s, opacity 0.08s;
}

.seg-body {
  stroke: rgba(60, 30, 20, 0.55);
  stroke-width: 0.7;
}

.seg-mouth {
  stroke: #b3241f;
  stroke-width: 1.0;
}

.seg-base {
  stroke: #6a3fb5;
  stroke-width: 1.0;
}

.seg-shoulder {
  stroke: #2f7a63;
  stroke-width: 0.8;
  stroke-dasharray: 3 2;
}

.seg-spoke {
  stroke: #b8891f;
  stroke-width: 0.7;
  stroke-dasharray: 2.5 1.8;
}

.seg-solid {
  stroke: rgba(60, 30, 20, 0.6);
  stroke-width: 0.8;
}

.seg-cap {
  stroke: #2f5f8a;
  stroke-width: 0.8;
}

.seg.faint {
  opacity: 0.16;
}

.seg.on {
  stroke: #e01914 !important;
  stroke-width: 2.4 !important;
  stroke-dasharray: none !important;
  opacity: 1;
  filter: drop-shadow(0 0 1.2px rgba(224, 25, 20, 0.6));
}

.seg:hover {
  stroke-width: 1.8;
}

.edge-dots .dot {
  fill: #b3241f;
  stroke: #fff;
  stroke-width: 0.6;
  cursor: pointer;
}

.edge-dots .dot.on {
  fill: #e01914;
  r: 4.2;
}

.edge-no {
  font-size: 6px;
  fill: #8a5a44;
  pointer-events: none;
}

.edge-no.on {
  fill: #e01914;
  font-weight: 700;
}

/* ---------- 档位牌 ---------- */
.bucket {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 10px;
  background: rgba(246, 227, 186, 0.55);
  border-top: 1px dashed #d9c18c;
  font-size: 11px;
}

.bucket-title {
  color: #8a6d3b;
}

.bucket-empty {
  color: #b0a089;
}

.chip {
  font: inherit;
  font-size: 11px;
  border: 1px dashed #b8891f;
  background: #fffdf5;
  color: #6a4a12;
  border-radius: 999px;
  padding: 1px 10px;
  cursor: pointer;
}

.chip em {
  font-style: normal;
  color: #b3241f;
  margin-left: 4px;
}

.chip.on {
  background: #e01914;
  border-color: #e01914;
  color: #fff;
}

.chip.on em {
  color: #fff;
}

.info-line {
  font-size: 11px;
  color: #6a5c52;
  padding: 3px 10px 5px;
  min-height: 15px;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.info-line b {
  color: #8f1c19;
  font-weight: 600;
}

.info-line small {
  color: #a08c6e;
}
</style>
