<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import LanternPreview from '../components/LanternPreview.vue'
import PositionBanner from '../components/PositionBanner.vue'
import { getLantern } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { groupMembers } from '../core/frame'
import { membersCsv, downloadText } from '../core/exporter'
import { cm1 } from '../core/position'
import type { FrameMember } from '../core/types'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})
const groups = computed(() => (full.value ? groupMembers(full.value.frame.members) : []))

/** 表↔图联动：当前位置身份键；点表行图上那一根显出来，点图上表落到那一行 */
const selectedKey = ref<string | null>(null)
const previewMode = ref<'front' | 'top'>('front')
const selected = computed(() => full.value?.frame.members.find((m) => m.pos.key === selectedKey.value) || null)

function selectRow(m: FrameMember) {
  selectedKey.value = selectedKey.value === m.pos.key ? null : m.pos.key
}

function onSelectFromFigure(key: string | null) {
  selectedKey.value = key
}

function bendText(m: FrameMember): string {
  if (m.bendRadiusMm) return `R${m.bendRadiusMm.toFixed(1)}mm`
  if (m.bendAngleDeg) return `${m.bendAngleDeg.toFixed(1)}°`
  return '—'
}

function coordText(m: FrameMember): string {
  const a = m.pos.anchorMm
  if (!a) return '无层无棱档（不落坐标）'
  return `x${a.x} y${a.y} z${a.z}mm / ${cm1(a.x)} ${cm1(a.y)} ${cm1(a.z)}cm`
}

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-构件清单.csv`, membersCsv(l, full.value.frame.members))
}
</script>

<template>
  <div v-if="!lantern || !full" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="frame-view">
    <PositionBanner :lantern="lantern" />
    <section class="head">
      <div>
        <h2>骨架件表 · {{ lantern.name }}</h2>
        <p class="sub">
          {{ full.frame.members.length }} 根逐根列出，每根写明<b>第几层 · 第几棱</b>（上口圈第 {{ lantern.layers.length }} 层、底盘圈第 0 层）。
          点表行，右侧预览那一根显出来；点预览里一根，表落到那一行。
          旋转体母线根数 = 等分数 {{ lantern.kind === 'revolution' ? lantern.divisions : lantern.sides }}，序号绕一圈首尾相接。
          位置坐标 mm 取整，括号内换算 cm 保留 1 位。
        </p>
      </div>
      <div class="ops">
        <button @click="exportCsv">导出构件清单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印构件清单</button>
      </div>
    </section>

    <section class="stats">
      <div class="stat"><span>构件总根数</span><b>{{ full.frame.totalQty }}</b></div>
      <div class="stat"><span>备料总长（含余量）</span><b>{{ (full.frame.stockLengthMm / 1000).toFixed(3) }} m</b></div>
      <div class="stat"><span>净长合计</span><b>{{ (full.frame.rawLengthMm / 1000).toFixed(3) }} m</b></div>
      <div class="stat"><span>绑扎余量合计</span><b>{{ full.frame.lashExtraMm.toFixed(1) }} mm</b></div>
    </section>

    <div class="body-grid">
      <div class="tables-col">
        <section v-for="grp in groups" :key="grp.group" class="group">
          <h3>{{ grp.group }}</h3>
          <table>
            <thead>
              <tr>
                <th>构件名称</th>
                <th>第几层</th>
                <th>第几棱 / 圈</th>
                <th>上口 / 底盘</th>
                <th class="num">净长 (mm)</th>
                <th class="num">截取长 (mm)</th>
                <th>弯曲 / 折角</th>
                <th>位置坐标</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in grp.items"
                :key="m.id"
                :class="{ sel: selectedKey === m.pos.key, notier: m.pos.inNoTier, nearest: m.pos.nearestDerived }"
                @click="selectRow(m)"
              >
                <td class="name">{{ m.label }}</td>
                <td>{{ m.pos.layerText }}</td>
                <td>{{ m.pos.edgeText }}</td>
                <td>{{ m.pos.rim === 'mouth' ? '上口圈' : m.pos.rim === 'base' ? '底盘圈' : '—' }}</td>
                <td class="num mono">{{ m.rawLengthMm.toFixed(1) }}</td>
                <td class="num mono strong">{{ m.lengthMm.toFixed(1) }}</td>
                <td class="mono small">{{ bendText(m) }}</td>
                <td class="mono small coord">{{ coordText(m) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <aside class="preview-col">
        <div class="pv-head">
          <h3>灯体预览（点图选根）</h3>
          <div class="pv-tabs">
            <button :class="{ on: previewMode === 'front' }" @click="previewMode = 'front'">正视</button>
            <button :class="{ on: previewMode === 'top' }" @click="previewMode = 'top'">俯视</button>
          </div>
        </div>
        <div class="pv-canvas">
          <LanternPreview
            :lantern="lantern"
            :mode="previewMode"
            :members="full.frame.members"
            :selected-key="selectedKey"
            selectable
            @select="onSelectFromFigure"
          />
        </div>
        <p v-if="selected" class="pv-info">
          <b>{{ selected.label }}</b><br />
          {{ selected.pos.positionText }}<br />
          净长 {{ selected.rawLengthMm.toFixed(1) }}mm · 截取 {{ selected.lengthMm.toFixed(1) }}mm
          <template v-if="selected.pos.inNoTier"><br />无层无棱档：图上不落到具体层棱</template>
          <template v-else-if="selected.pos.nearestDerived"><br />位置为就近折算：层/棱数变更会挪动</template>
        </p>
        <p v-else class="pv-hint">点左侧任意一行，或点图上一根篾，两边落到同一根。</p>
      </aside>
    </div>

    <ChecksPanel
      :checks="full.checks.filter((c) => ['CHK-01', 'CHK-02', 'CHK-04', 'CHK-08', 'CHK-09'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="骨架计算自检"
    />
  </div>
</template>

<style scoped>
.frame-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}

h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #8f1c19;
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  max-width: 900px;
}

.ops {
  display: flex;
  gap: 8px;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  padding: 6px 12px;
  font-size: 12.5px;
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}

button.primary:hover {
  background: #9c1f1b;
  color: #fff;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
}

.stat span {
  font-size: 11px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 15px;
}

.group {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.group h3 {
  margin: 0;
  padding: 8px 14px;
  font-size: 13px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  color: var(--ink);
}

.body-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 14px;
  align-items: start;
}

@media (max-width: 1200px) {
  .body-grid {
    grid-template-columns: 1fr;
  }
}

.tables-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

tbody tr {
  cursor: pointer;
}

tbody tr.sel {
  background: #fbe3df;
}

tbody tr.notier td {
  color: #8a6a12;
}

tbody tr.nearest td {
  font-style: normal;
}

td.coord {
  white-space: nowrap;
}

.preview-col {
  position: sticky;
  top: 76px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  padding: 10px 12px 12px;
}

.pv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.pv-head h3 {
  margin: 0;
  font-size: 13px;
}

.pv-tabs {
  display: flex;
  gap: 4px;
}

.pv-tabs button {
  padding: 3px 10px;
  font-size: 12px;
}

.pv-tabs button.on {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}

.pv-canvas {
  height: 380px;
}

.pv-info {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink);
}

.pv-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

th {
  text-align: left;
  padding: 7px 12px;
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

td {
  padding: 7px 12px;
  border-bottom: 1px dashed var(--line);
  vertical-align: top;
}

tr:last-child td {
  border-bottom: none;
}

.num {
  text-align: right;
}

.mono {
  font-family: var(--mono);
}

.strong {
  font-weight: 700;
  color: #8f1c19;
}

.small {
  font-size: 12px;
}

.name {
  font-weight: 600;
}

.note {
  color: var(--ink-soft);
  font-size: 12px;
  max-width: 340px;
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
