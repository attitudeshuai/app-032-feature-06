<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern, isPositionStale, restampPosition } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { downloadText, materialsCsv, positionStockCsv } from '../core/exporter'
import { coveringSpec, CRAFT } from '../core/craft'
import { panelCutArea } from '../core/panels'
import { POSITION_POLICY_TEXT } from '../core/positions'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})
const stale = computed(() => (lantern.value ? isPositionStale(lantern.value) : false))
const showPosRows = ref(false)

const batchN = computed(() => Math.max(1, Math.round(lantern.value?.batchCount || 1)))
const waste = computed(() => lantern.value?.wasteRatio || 0)
/** 按位置分开的批量用量（每根/每圈一行；与构件表、图、存档同一份位置） */
const posRows = computed(() =>
  (full.value?.stockRows || []).map((r) => ({
    ...r,
    batchLenMm: r.lengthMm * batchN.value * (1 + waste.value)
  }))
)
const posBatchTotal = computed(() => posRows.value.reduce((s, r) => s + r.batchLenMm, 0))

const cov = computed(() => (lantern.value ? coveringSpec(lantern.value.covering) : null))

const layerFabric = computed(() => {
  const l = lantern.value
  if (!l || !full.value) return []
  return l.layers.map((ly, i) => {
    const ps = full.value!.panels.panels.filter((p) => p.layerIndex === i)
    const area = ps.reduce((s, p) => s + panelCutArea(p) * p.qty, 0)
    return {
      i: i + 1,
      color: l.layerColors[i] || l.color,
      height: ly.heightMm,
      diameter: ly.diameterMm,
      kinds: ps.length,
      perPiece: ps.length ? panelCutArea(ps[0]) : 0,
      qty: ps.reduce((s, p) => s + p.qty, 0),
      areaM2: area / 1e6
    }
  })
})

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-备料单.csv`, materialsCsv(l, full.value.materials, full.value.batch))
}

function exportStockCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-备料按位置分列.csv`, positionStockCsv(l, full.value.stockRows, batchN.value, waste.value))
}

function doRestamp() {
  const l = lantern.value
  if (!l) return
  if (window.confirm('重认位置后：此前已导出的三份单子与 1:1 放样图全部作废需重出；已裁好的中轴/顶盖/底盘料退回重新对位。确认重认？')) {
    restampPosition(l)
  }
}
</script>

<template>
  <div v-if="!lantern || !full || !cov" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="materials">
    <section v-if="stale" class="stale-banner">
      <div>
        <b>⚠ 此灯样还挂着老位置（无 POS-A1 戳）。</b>
        按老位置备的料、已导出的备料单/构件清单/裁片清单与放样图全部需重认后重出；已裁好的中轴/顶盖/底盘料退回重新对位。
      </div>
      <button class="primary" @click="doRestamp">重认位置并盖戳</button>
    </section>

    <section class="head">
      <div>
        <h2>材料统计与备料单 · {{ lantern.name }}</h2>
        <p class="sub">
          竹篾按<b>含绑扎余量</b>长度备料；蒙面按<b>含缝份</b>的裁片面积备料；
          批量总量 = 单灯 × 数量 × (1 + 损耗率)。
        </p>
        <p class="sub policy">{{ POSITION_POLICY_TEXT }} 下表「按位置分开的用量」与构件表行、预览图段、三份导出单子同一套位置。</p>
      </div>
      <div class="ops">
        <button @click="exportStockCsv">导出按位置分列 CSV</button>
        <button @click="exportCsv">导出备料单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印备料 / 清单</button>
      </div>
    </section>

    <section class="batch">
      <div class="field">
        <label>批量数量（个）</label>
        <input v-model.number="lantern.batchCount" type="number" min="1" max="500" step="1" />
      </div>
      <div class="field">
        <label>损耗率 <em>{{ (lantern.wasteRatio * 100).toFixed(0) }}%</em></label>
        <input v-model.number="lantern.wasteRatio" type="range" min="0" max="0.2" step="0.01" />
      </div>
      <p class="formula mono">
        批量 = 单灯 × {{ Math.max(1, Math.round(lantern.batchCount)) }} × {{ (1 + lantern.wasteRatio).toFixed(2) }}
      </p>
    </section>

    <section class="tables">
      <table class="tally">
        <thead>
          <tr>
            <th>项目</th>
            <th class="num">单灯</th>
            <th class="num">批量 {{ full.batch.count }} 个（含损耗）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>竹篾 / 铁丝（含绑扎余量）</td>
            <td class="num mono">{{ full.materials.frameM.toFixed(3) }} m</td>
            <td class="num mono strong">{{ full.batch.frameM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>构件净长合计</td>
            <td class="num mono">{{ full.materials.frameRawM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.frameRawM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>蒙面 {{ cov.name }}（含缝份）</td>
            <td class="num mono">{{ full.materials.coveringM2.toFixed(3) }} m²</td>
            <td class="num mono strong">{{ full.batch.coveringM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>蒙面净面积（不含缝份）</td>
            <td class="num mono">{{ full.materials.coveringNetM2.toFixed(3) }} m²</td>
            <td class="num mono">{{ full.batch.coveringNetM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>扎线（{{ full.materials.lashJoints }} 处绑扎 × {{ CRAFT.lashPerJointM }}m/处）</td>
            <td class="num mono">{{ full.materials.lashM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.lashM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>胶（{{ cov.name }} {{ cov.gluePerM2 }}g/m²）</td>
            <td class="num mono">{{ full.materials.glueG.toFixed(1) }} g</td>
            <td class="num mono">{{ full.batch.glueG.toFixed(1) }} g</td>
          </tr>
          <tr class="led">
            <td>LED 灯珠建议</td>
            <td class="num mono">{{ full.materials.ledCount }} 颗</td>
            <td class="num mono">{{ full.batch.ledCount }} 颗</td>
          </tr>
        </tbody>
      </table>

      <div class="side">
        <div class="stat"><span>灯体体积</span><b>{{ full.materials.volumeL.toFixed(3) }} L</b></div>
        <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
        <div class="stat"><span>构件总根数</span><b>{{ full.frame.totalQty }}</b></div>
        <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
        <p class="rule">LED 建议规则：{{ CRAFT.led.rule }}</p>
      </div>
    </section>

    <section class="pos-stock">
      <div class="pos-head">
        <h3>备料按位置分开（每根/每圈一行，与图、表同一套位置）</h3>
        <label class="chk"><input type="checkbox" v-model="showPosRows" /> 展开全部 {{ posRows.length }} 行</label>
      </div>
      <table>
        <thead>
          <tr>
            <th>位置（层/棱/圈口/档）</th>
            <th>构件</th>
            <th>棱/圈序号</th>
            <th class="num">单根净长 (mm)</th>
            <th class="num">单根截取 (mm)</th>
            <th class="num">单根 (cm)</th>
            <th class="num">批量 {{ batchN }} 个含损耗 (mm)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in showPosRows ? posRows : posRows.slice(0, 12)" :key="i">
            <td>{{ r.posText }}</td>
            <td>{{ r.label }}</td>
            <td class="mono">{{ r.edgeNo == null ? '整圈' : r.edgeNo }}</td>
            <td class="num mono">{{ r.rawLengthMm.toFixed(1) }}</td>
            <td class="num mono strong">{{ r.lengthMm.toFixed(1) }}</td>
            <td class="num mono">{{ (r.lengthMm / 100).toFixed(1) }}</td>
            <td class="num mono">{{ r.batchLenMm.toFixed(1) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" class="num">合计（批量 {{ batchN }} 个，含 {{ (waste * 100).toFixed(0) }}% 损耗）</td>
            <td class="num mono strong">{{ posBatchTotal.toFixed(1) }} mm（{{ (posBatchTotal / 1000).toFixed(3) }} m）</td>
          </tr>
        </tfoot>
      </table>
      <small v-if="!showPosRows && posRows.length > 12" class="more-hint">仅显示前 12 行，勾选展开查看全部 {{ posRows.length }} 处位置；导出 CSV 含全部行。</small>
    </section>

    <section class="palette">
      <h3>分层蒙面用量（按层买布/买纸用）</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>颜色</th>
            <th class="num">分段高 (mm)</th>
            <th class="num">该层直径 (mm)</th>
            <th class="num">裁片种类</th>
            <th class="num">每块面积 (m²)</th>
            <th class="num">块数</th>
            <th class="num">合计面积 (m²)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in layerFabric" :key="r.i">
            <td class="mono">第 {{ r.i }} 层</td>
            <td>
              <span class="dot" :style="{ background: r.color }" />
              <span class="mono">{{ r.color }}</span>
            </td>
            <td class="num mono">{{ r.height.toFixed(1) }}</td>
            <td class="num mono">{{ r.diameter.toFixed(1) }}</td>
            <td class="num mono">{{ r.kinds }}</td>
            <td class="num mono">{{ (r.perPiece / 1e6).toFixed(4) }}</td>
            <td class="num mono">{{ r.qty }}</td>
            <td class="num mono">{{ r.areaM2.toFixed(3) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <ChecksPanel
      :checks="full.checks.filter((c) => ['CHK-04', 'CHK-07', 'CHK-09', 'CHK-10'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="备料与统一位置自检"
    />
  </div>
</template>

<style scoped>
.materials {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
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

.pos-stock {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.pos-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 6px;
}

.pos-head h3 {
  margin: 0;
  font-size: 14px;
}

.chk {
  font-size: 12px;
  color: var(--ink-soft);
  display: flex;
  gap: 6px;
}

.pos-stock table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.pos-stock th {
  text-align: left;
  padding: 6px 14px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.pos-stock td {
  padding: 5px 14px;
  border-bottom: 1px dashed var(--line);
}

.pos-stock tfoot td {
  background: #fff9ec;
  font-weight: 600;
  border-top: 1px solid var(--line);
}

.more-hint {
  display: block;
  padding: 6px 14px 10px;
  color: var(--ink-soft);
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

.batch {
  display: flex;
  gap: 24px;
  align-items: flex-end;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

label {
  font-size: 12px;
  color: var(--ink-soft);
}

label em {
  font-style: normal;
  font-family: var(--mono);
  color: var(--blue);
}

input[type='number'] {
  font: inherit;
  font-size: 13px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  width: 120px;
  font-family: var(--mono);
}

input[type='range'] {
  width: 180px;
  accent-color: var(--red);
}

.formula {
  margin: 0 0 4px auto;
  font-size: 13px;
  color: #8f1c19;
  background: #fbeae6;
  padding: 5px 12px;
  border-radius: 6px;
}

.tables {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 300px);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .tables {
    grid-template-columns: 1fr;
  }
}

.tally,
.palette table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  box-shadow: var(--shadow);
}

.tally th,
.palette th {
  text-align: left;
  padding: 8px 14px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-bottom: 1px solid var(--line);
}

.tally td,
.palette td {
  padding: 8px 14px;
  border-bottom: 1px dashed var(--line);
}

.tally tr:last-child td,
.palette tr:last-child td {
  border-bottom: none;
}

tr.led td {
  background: #fff9ec;
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

.side {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 9px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.stat span {
  font-size: 11.5px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 14px;
}

.rule {
  margin: 0;
  background: var(--surface);
  padding: 10px 14px;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.palette {
  box-shadow: var(--shadow);
  border-radius: 10px;
}

.palette h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  margin-right: 5px;
  border: 1px solid var(--line-strong);
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
