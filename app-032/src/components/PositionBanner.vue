<script setup lang="ts">
/**
 * 位置过期横幅：灯样的位置指纹与当前参数不符时显示。
 * 点明受牵连的五处：骨架构件表 / 参数与预览描线 / 备料批量用量 / 三份导出单子 / 本机存档。
 * 已发清单与放样图、已裁料须作废重出；确认重做完成后点按钮刷新存档指纹。
 */
import { computed } from 'vue'
import { acknowledgePosition, state } from '../core/store'
import type { Lantern } from '../core/types'

const props = defineProps<{ lantern: Lantern }>()
const info = computed(() => state.stale[props.lantern.id] || null)
</script>

<template>
  <div v-if="info" class="pos-banner">
    <div class="t">⚠ 位置编号已变更，以下五处仍挂老位置，须随新位置刷新：</div>
    <ul>
      <li>骨架构件表的每一行（第几层·第几棱/上口圈/底盘圈）</li>
      <li>参数与灯体预览页上描出的那一段</li>
      <li>备料与批量用料里按位置分开的用量</li>
      <li>三份导出单子（构件清单 CSV / 备料单 CSV / 可打印构件清单）的构件位置列</li>
      <li>本机存档里记录的这一份位置（旧指纹 {{ info.saved || '无' }} → 新指纹 {{ info.current }}）</li>
    </ul>
    <p class="r">
      变更原因：{{ info.reasons.join('；') }}。
      <b>据此已导出的构件清单与 1:1 放样图全部作废重出；照旧位置描过线、裁好的那几根料退回重新对位。</b>
    </p>
    <button class="ack" @click="acknowledgePosition(lantern)">
      单据图纸已作废、料已退回重对，确认以新位置为准并刷新存档指纹
    </button>
  </div>
</template>

<style scoped>
.pos-banner {
  background: #fdecea;
  border: 1px solid #e7c3bb;
  border-left: 4px solid var(--red);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12.5px;
  color: #6d2320;
}

.t {
  font-weight: 700;
  margin-bottom: 6px;
}

ul {
  margin: 0 0 6px;
  padding-left: 18px;
  line-height: 1.7;
}

.r {
  margin: 0 0 8px;
}

.ack {
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--red);
  background: var(--red);
  color: #fff;
  border-radius: 6px;
  padding: 5px 12px;
}

.ack:hover {
  background: #9c1f1b;
}
</style>
