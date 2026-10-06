<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import LanternPreview from '../components/LanternPreview.vue'
import { getLantern, isPositionStale, restampPosition } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { groupMembers } from '../core/frame'
import { kindName, membersCsv, positionStockCsv, downloadText } from '../core/exporter'
import { styleLabel } from '../core/craft'
import { instanceKey, memberKey, POSITION_POLICY_TEXT, positionText } from '../core/positions'
import { clearSelection, selectInstance, selectMember, selectedKey } from '../core/selection'
import type { FrameMember } from '../core/types'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const mode = ref<'front' | 'top' | 'iso'>('front')
/** 展开后按棱列每根（备料按位置分开也看这里） */
const expanded = ref<Set<string>>(new Set())
const showAllInstances = ref(false)

const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})
const groups = computed(() => (full.value ? groupMembers(full.value.frame.members) : []))
const stale = computed(() => (lantern.value ? isPositionStale(lantern.value) : false))
const selKey = computed(() => (lantern.value ? selectedKey(lantern.value.id) : ''))

function bendText(m: FrameMember): string {
  if (m.bendRadiusMm) return `R${m.bendRadiusMm.toFixed(1)}mm`
  if (m.bendAngleDeg) return `${m.bendAngleDeg.toFixed(1)}°`
  return '—'
}

/** 某构件展开后按棱的每根行（位置实例） */
function instancesOf(m: FrameMember) {
  if (!full.value) return []
  return full.value.positions.byMember.get(m.id) || []
}

function isExpanded(m: FrameMember) {
  return expanded.value.has(m.id)
}
function toggleExpand(m: FrameMember) {
  const next = new Set(expanded.value)
  if (next.has(m.id)) next.delete(m.id)
  else next.add(m.id)
  expanded.value = next
}

function rowClass(m: FrameMember) {
  if (!lantern.value || !selKey.value) return ''
  return selKey.value === memberKey(m.id) || selKey.value.startsWith(`I:${m.id}:`) ? 'row-on' : ''
}

function onRowClick(m: FrameMember) {
  if (!lantern.value) return
  selectMember(lantern.value.id, m.id)
}

function onInstanceClick(m: FrameMember, edgeNo: number | null) {
  if (!lantern.value) return
  selectInstance(lantern.value.id, m.id, edgeNo)
}

function onPick(memberId: string, edgeNo: number | null) {
  if (!lantern.value) return
  if (!memberId) {
    clearSelection(lantern.value.id)
    return
  }
  selectInstance(lantern.value.id, memberId, edgeNo)
  // 顶盖/底盘裁片属于「无层无棱档」：只在档位牌高亮，灯体上不落位（方案 POS-A1）
}

function instanceRowBg(m: FrameMember, edgeNo: number | null) {
  if (!lantern.value) return ''
  const key = instanceKey(m.id, edgeNo)
  return selKey.value === key ? 'inst-on' : ''
}

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-构件清单.csv`, membersCsv(l, full.value.frame.members))
}

function exportStockCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-备料按位置分列.csv`, positionStockCsv(l, full.value.stockRows, Math.max(1, Math.round(l.batchCount)), l.wasteRatio))
}

function doRestamp() {
  const l = lantern.value
  if (!l) return
  if (window.confirm('重认位置后：本机存档按 POS-A1 重新盖戳；此前已导出的构件清单、裁片清单、备料单与 1:1 放样图全部作废需重出；照旧位置裁好的中轴/顶盖/底盘料要退回重新对位。确认重认？')) {
    restampPosition(l)
  }
}

function getSelInfo() {
  if (!full.value || !selKey.value) return ''
  const ins = full.value.positions.instances.find((x) => selKey.value === instanceKey(x.memberId, x.edgeNo) || selKey.value === memberKey(x.memberId))
  if (!ins) return ''
  const m = full.value.frame.members.find((x) => x.id === ins.memberId)
  if (selKey.value.startsWith('I:')) {
    return `已选中单根：${ins.label} · ${ins.posText}`
  }
  return `已选中整行位置：${m?.label || ins.label}（共 ${m?.qty ?? 1} 根，图上同时高亮）`
}
</script>

<template>
  <div v-if="!lantern || !full" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="frame-view">
    <!-- 老位置横幅：点名哪几处作废 -->
    <section v-if="stale" class="stale-banner">
      <div>
        <b>⚠ 此灯样还挂着老位置（存档无 POS-A1 位置戳）。</b>
        下列各处全部失效，需重认位置后重出：① 本机存档里的位置；② 已导出的构件清单 / 裁片清单 / 备料单；
        ③ 1:1 放样图；照旧位置描线、裁好的中轴、顶盖、底盘料要退回重新对位。
      </div>
      <button class="primary" @click="doRestamp">按当前层/棱重认位置并盖戳</button>
    </section>

    <section class="head">
      <div>
        <h2>骨架件表 · {{ lantern.name }}</h2>
        <p class="sub">
          {{ styleLabel(lantern.mouthStyle) }} / {{ styleLabel(lantern.bottomStyle) }} ·
          最大直径 {{ lantern.maxDiameterMm }}mm · 总高 {{ lantern.totalHeightMm }}mm ·
          {{ lantern.layers.length }} 层 ·
          {{ lantern.kind === 'revolution' ? `${lantern.divisions} 等分（=母线篈根数）` : `${lantern.sides} 棱` }} ·
          每根篾两端各留 <b>{{ lantern.lashAllowanceMm }}mm</b> 绑扎余量。
        </p>
        <p class="sub policy">{{ POSITION_POLICY_TEXT }} 位置坐标 mm 取整，显示 cm 保留 1 位；棱/母线序号自俯视正上方 1 号顺时针、末号接 1 号。</p>
      </div>
      <div class="ops">
        <button @click="exportStockCsv">导出备料按位置分列 CSV</button>
        <button @click="exportCsv">导出构件清单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印构件清单</button>
      </div>
    </section>

    <!-- 表 ↔ 图：同一套位置，双向落位 -->
    <section class="linkage">
      <div class="preview-box">
        <div class="tabs">
          <button :class="{ on: mode === 'front' }" @click="mode = 'front'">正视</button>
          <button :class="{ on: mode === 'top' }" @click="mode = 'top'">俯视（看棱号）</button>
          <button :class="{ on: mode === 'iso' }" @click="mode = 'iso'">等轴测</button>
        </div>
        <div class="canvas">
          <LanternPreview
            :lantern="lantern"
            :mode="mode"
            :model="full.positions"
            :members="full.frame.members"
            :selected="selKey"
            @pick="onPick"
          />
        </div>
      </div>
      <div class="link-side">
        <p class="hint">
          点灯体上任一根 → 下表落到对应构件行；点表中一行 → 图上该位置全部根数高亮；
          点展开后的「第 k 棱」→ 图上只显那一根。紫色=底盘圈，红色=上口圈，金色虚线=辐条，绿色虚线=收口支撑圈。
        </p>
        <p class="sel-info" v-if="getSelInfo()">{{ getSelInfo() }}</p>
        <label class="chk"><input type="checkbox" v-model="showAllInstances" /> 全部按棱展开（每根一行）</label>
      </div>
    </section>

    <section class="stats">
      <div class="stat"><span>构件总根数</span><b>{{ full.frame.totalQty }}</b></div>
      <div class="stat"><span>位置实例（含顶盖/底盘档）</span><b>{{ full.positions.instances.length }}</b></div>
      <div class="stat"><span>备料总长（含余量）</span><b>{{ (full.frame.stockLengthMm / 1000).toFixed(3) }} m</b></div>
      <div class="stat"><span>净长合计</span><b>{{ (full.frame.rawLengthMm / 1000).toFixed(3) }} m</b></div>
      <div class="stat"><span>绑扎余量合计</span><b>{{ full.frame.lashExtraMm.toFixed(1) }} mm</b></div>
    </section>

    <section v-for="grp in groups" :key="grp.group" class="group">
      <h3>{{ grp.group }}</h3>
      <table>
        <thead>
          <tr>
            <th>构件名称</th>
            <th>类别</th>
            <th>位置（第几层·第几棱/圈口/档）</th>
            <th class="num">净长 (mm)</th>
            <th class="num">截取长度 (mm，含余量)</th>
            <th class="num">余量处数</th>
            <th class="num">数量</th>
            <th class="num">总截取长 (mm)</th>
            <th>弯曲半径 / 折角</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="m in grp.items" :key="m.id">
            <tr
              class="member-row"
              :class="rowClass(m)"
              :style="{ cursor: 'pointer' }"
              @click="onRowClick(m)"
            >
              <td class="name">
                <button
                  v-if="(full.positions.byMember.get(m.id)?.length || 0) > 1"
                  class="exp"
                  @click.stop="toggleExpand(m)"
                >
                  {{ isExpanded(m) || showAllInstances ? '−' : '+' }}
                </button>
                <span v-else class="exp placeholder"></span>
                {{ m.label }}
              </td>
              <td>{{ kindName(m.kind) }}</td>
              <td class="pos-cell">{{ positionText(m.pos) }}</td>
              <td class="num mono">{{ m.rawLengthMm.toFixed(1) }}</td>
              <td class="num mono strong">{{ m.lengthMm.toFixed(1) }}</td>
              <td class="num mono">×{{ m.lashJoints }}</td>
              <td class="num mono">{{ m.qty }}</td>
              <td class="num mono">{{ (m.lengthMm * m.qty).toFixed(1) }}</td>
              <td class="mono small">{{ bendText(m) }}</td>
            </tr>
            <template v-if="(isExpanded(m) || showAllInstances) && instancesOf(m).length > 1">
              <tr
                v-for="ins in instancesOf(m)"
                :key="ins.memberId + ':' + (ins.edgeNo ?? 'H')"
                class="inst-row"
                :class="instanceRowBg(m, ins.edgeNo)"
                @click.stop="onInstanceClick(m, ins.edgeNo)"
              >
                <td class="name small">└ {{ ins.edgeNo == null ? '整圈' : `第 ${ins.edgeNo} 棱` }}</td>
                <td></td>
                <td class="pos-cell small">{{ ins.posText }}</td>
                <td class="num mono small">{{ m.rawLengthMm.toFixed(1) }}</td>
                <td class="num mono small">{{ m.lengthMm.toFixed(1) }}</td>
                <td class="num small">×{{ m.lashJoints }}</td>
                <td class="num mono small">1</td>
                <td class="num mono small">{{ m.lengthMm.toFixed(1) }}</td>
                <td class="small">截取 {{ (m.lengthMm / 100).toFixed(1) }} cm</td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </section>

    <ChecksPanel
      :checks="full.checks.filter((c) => ['CHK-01', 'CHK-02', 'CHK-04', 'CHK-08', 'CHK-09', 'CHK-10'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="骨架与位置自检"
    />
  </div>
</template>

<style scoped>
.frame-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stale-banner {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  background: #fdecea;
  border: 1px solid #e3b3ae;
  color: #8f1c19;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12.5px;
  line-height: 1.6;
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
  margin: 0 0 4px;
  font-size: 12.5px;
  color: var(--ink-soft);
  max-width: 900px;
}

.sub.policy {
  font-size: 11.5px;
  color: #8a6d3b;
}

.ops {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

.linkage {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) 280px;
  gap: 14px;
  align-items: stretch;
}

@media (max-width: 1000px) {
  .linkage {
    grid-template-columns: 1fr;
  }
}

.preview-box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  gap: 6px;
  padding: 8px 10px 0;
}

.tabs button {
  padding: 3px 12px;
  font-size: 12px;
}

.tabs button.on {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}

.canvas {
  height: 420px;
  padding: 6px;
}

.link-side {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}

.sel-info {
  margin: 0;
  font-size: 12px;
  color: #8f1c19;
  background: #fbeae6;
  border-radius: 6px;
  padding: 6px 10px;
}

.chk {
  font-size: 12px;
  color: var(--ink-soft);
  display: flex;
  gap: 6px;
  align-items: center;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

.member-row:hover {
  background: #fdf6f2;
}

.member-row.row-on {
  background: #fde6e3;
}

.member-row.row-on td {
  font-weight: 600;
}

.inst-row {
  background: #fbf7f1;
  cursor: pointer;
}

.inst-row:hover {
  background: #f7ede2;
}

.inst-row.inst-on {
  background: #fdd6d2;
}

.pos-cell {
  font-size: 12px;
  color: #4a3a30;
  white-space: normal;
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
  font-size: 11.5px;
}

.name {
  font-weight: 600;
  white-space: nowrap;
}

.name.small {
  font-weight: 500;
  color: #6a5c52;
}

.exp {
  width: 20px;
  height: 20px;
  padding: 0;
  margin-right: 4px;
  font-size: 13px;
  line-height: 1;
  border-radius: 4px;
}

.exp.placeholder {
  display: inline-block;
  visibility: hidden;
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
