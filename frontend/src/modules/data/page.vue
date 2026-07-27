<template>
  <div class="data-page">
    <section class="card data-settings-card" aria-labelledby="data-settings-title">
      <div class="data-section-heading">
        <div>
          <p class="data-eyebrow">PDF 自动归档</p>
          <h3 id="data-settings-title">试验数据保存设置</h3>
          <p class="data-section-copy">试验或当前轴向完成后，系统会为本批次的每个样品自动生成一份 PDF。</p>
        </div>
        <span class="data-path-status" :class="pathStatusClass" data-testid="data-path-status" role="status">
          <span class="data-path-status__dot" aria-hidden="true"></span>
          {{ pathStatusLabel }}
        </span>
      </div>

      <form class="data-path-form" @submit.prevent="saveSettings">
        <div class="form-field data-path-field">
          <label for="test-data-save-path">保存地址</label>
          <div class="data-path-control">
            <input
              id="test-data-save-path"
              v-model="savePath"
              data-testid="data-save-path"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="请输入后端服务器上的绝对文件夹路径"
              :aria-invalid="Boolean(settingsError)"
              :disabled="settingsLoading || settingsSaving"
            />
            <button
              class="action-btn data-save-button"
              data-testid="data-save-settings"
              type="submit"
              :disabled="settingsLoading || settingsSaving || !savePath.trim()"
            >
              {{ settingsSaving ? "正在检测…" : "保存并检测目录" }}
            </button>
          </div>
          <p class="helper data-path-helper">
            此路径位于运行 MES 后端的电脑上。默认地址：<span class="data-code">{{ defaultPath || "桌面\\MES试验数据" }}</span>
          </p>
        </div>
      </form>

      <AppFeedback
        v-if="settingsError"
        :message="settingsError"
        tone="error"
        :auto-dismiss-ms="0"
        data-testid="data-settings-error"
        @close="settingsError = ''"
      />
      <AppFeedback
        v-if="settingsSuccess"
        :message="settingsSuccess"
        tone="success"
        data-testid="data-settings-success"
        @close="settingsSuccess = ''"
      />

      <div class="data-archive-guide" aria-label="自动归档目录结构">
        <div class="data-guide-item">
          <span>普通试验</span>
          <code>任务编号 / 试验名称 / 日期 起止时间 / 样品编号.pdf</code>
        </div>
        <div class="data-guide-item">
          <span>轴向试验</span>
          <code>任务编号 / 试验名称 / X+轴向 / 日期 起止时间 / 样品编号.pdf</code>
        </div>
      </div>
    </section>

    <section class="card data-failures-card" aria-labelledby="data-failures-title">
      <div class="data-section-heading data-failures-heading">
        <div>
          <p class="data-eyebrow">异常处理</p>
          <h3 id="data-failures-title">PDF 生成失败</h3>
          <p class="data-section-copy">试验完成状态不会受文件写入失败影响，可在问题处理后重新生成。</p>
        </div>
        <button
          v-if="failedExports.length"
          class="action-btn secondary"
          data-testid="data-retry-all"
          type="button"
          :disabled="retryingAll"
          @click="retryAllFailed"
        >
          {{ retryingAll ? "正在重试…" : `全部重试（${failedCount}）` }}
        </button>
      </div>

      <AppFeedback
        v-if="exportsError"
        :message="exportsError"
        tone="error"
        :auto-dismiss-ms="0"
        data-testid="data-exports-error"
        @close="exportsError = ''"
      />

      <div v-if="exportsLoading" class="data-empty-state" data-testid="data-exports-loading" role="status">正在读取失败记录…</div>
      <div v-else-if="!failedExports.length" class="data-empty-state data-empty-state--success" data-testid="data-exports-empty">
        <span class="data-empty-state__mark" aria-hidden="true">✓</span>
        <strong>暂无生成失败的 PDF</strong>
        <span>后续出现写入异常时，可在这里查看原因并重试。</span>
      </div>
      <div v-else class="data-table-wrap">
        <table class="table data-failures-table" data-testid="data-failed-exports">
          <thead>
            <tr>
              <th>任务 / 试验</th>
              <th>样品</th>
              <th>轴向</th>
              <th>批次时间</th>
              <th>失败原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in failedExports" :key="item.exportKey">
              <td>
                <strong>{{ item.taskCode || "-" }}</strong>
                <span>{{ item.experimentName || item.experimentCode || "-" }}</span>
              </td>
              <td><span class="data-code">{{ item.sampleCode || "-" }}</span></td>
              <td>{{ formatAxisLabel(item.axisCode) }}</td>
              <td>{{ formatExportRange(item) }}</td>
              <td class="data-error-cell" :title="item.error || ''">{{ item.error || "未知错误" }}</td>
              <td>
                <button
                  class="action-link data-retry-button"
                  :data-testid="`data-retry-${item.exportKey}`"
                  type="button"
                  :disabled="isRetrying(item.exportKey)"
                  @click="retryFailed(item.exportKey)"
                >
                  {{ isRetrying(item.exportKey) ? "重试中…" : "重新生成" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup>
defineOptions({
  name: "DataPage",
});

import AppFeedback from "@/components/shared/AppFeedback.vue";
import { formatAxisLabel, formatExportRange } from "./model";
import { useDataPage } from "./useDataPage";

const {
  defaultPath,
  exportsError,
  exportsLoading,
  failedCount,
  failedExports,
  isRetrying,
  pathStatusClass,
  pathStatusLabel,
  retryAllFailed,
  retryFailed,
  retryingAll,
  savePath,
  saveSettings,
  settingsError,
  settingsLoading,
  settingsSaving,
  settingsSuccess,
} = useDataPage();
</script>
