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
              :disabled="settingsLoading || settingsSaving || directorySelecting"
            />
            <button
              class="action-btn secondary data-browse-button"
              data-testid="data-browse-directory"
              type="button"
              :disabled="settingsLoading || settingsSaving || directorySelecting"
              @click="browseDirectory"
            >
              {{ directorySelecting ? "选择中…" : "浏览" }}
            </button>
            <button
              class="action-btn data-save-button"
              data-testid="data-save-settings"
              type="submit"
              :disabled="settingsLoading || settingsSaving || directorySelecting || !savePath.trim()"
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

    <section class="card data-tasks-card" aria-labelledby="data-tasks-title">
      <div class="data-section-heading data-tasks-heading">
        <div>
          <p class="data-eyebrow">任务数据</p>
          <h3 id="data-tasks-title">试验数据输出进度</h3>
          <p class="data-section-copy">默认显示任务编号及任务级操作，双击任务后可查看进度并操作单项试验。</p>
        </div>
        <form class="data-task-search" role="search" @submit.prevent="searchTaskOutputs">
          <input
            id="test-data-task-query"
            v-model="tasksQuery"
            aria-label="搜索任务编号"
            data-testid="data-task-query"
            type="search"
            autocomplete="off"
            placeholder="搜索任务编号"
          />
          <button class="action-btn secondary" data-testid="data-task-search" type="submit" :disabled="tasksLoading">
            查询
          </button>
        </form>
      </div>

      <AppFeedback
        v-if="tasksError || taskActionError"
        :message="tasksError || taskActionError"
        tone="error"
        :auto-dismiss-ms="0"
        data-testid="data-tasks-error"
        @close="tasksError = ''; taskActionError = ''"
      />
      <AppFeedback
        v-if="taskActionSuccess"
        :message="taskActionSuccess"
        tone="success"
        data-testid="data-task-action-success"
        @close="taskActionSuccess = ''"
      />
      <div v-if="shareFallbackUrl" class="data-share-fallback" data-testid="data-share-fallback">
        <label for="test-data-share-url">局域网下载地址</label>
        <input id="test-data-share-url" :value="shareFallbackUrl" type="text" readonly @focus="$event.target.select()" />
      </div>

      <div
        v-if="tasksLoading && !taskOutputs.length"
        class="data-empty-state data-task-loading-frame"
        data-testid="data-tasks-loading"
        role="status"
      >
        正在读取任务数据…
      </div>
      <div v-else-if="!taskOutputs.length" class="data-empty-state" data-testid="data-tasks-empty">
        <strong>暂无任务数据输出记录</strong>
        <span>试验开始执行后，可在这里查看任务进度和 PDF 输出情况。</span>
      </div>
      <div v-else class="data-task-results" :aria-busy="tasksLoading">
        <div class="data-task-list" data-testid="data-task-list">
          <article
            v-for="task in taskOutputs"
            :key="task.taskCode"
            class="data-task-item"
            :class="{ 'is-expanded': isTaskExpanded(task.taskCode) }"
          >
            <div class="data-task-summary-row">
              <button
                class="data-task-toggle"
                :aria-controls="`data-task-details-${task.taskCode}`"
                :aria-expanded="isTaskExpanded(task.taskCode)"
                :aria-label="`${task.taskCode}，${isTaskExpanded(task.taskCode) ? '单击收起' : '双击展开'}试验数据`"
                :data-testid="`data-task-toggle-${task.taskCode}`"
                :title="isTaskExpanded(task.taskCode) ? '单击收起试验数据' : '双击展开试验数据'"
                type="button"
                @click="handleTaskClick(task.taskCode)"
                @dblclick="handleTaskDoubleClick(task.taskCode)"
                @keydown.enter.prevent="toggleTaskExpansion(task.taskCode)"
                @keydown.space.prevent="toggleTaskExpansion(task.taskCode)"
              >
                <strong class="data-code">{{ task.taskCode }}</strong>
              </button>
              <div class="data-task-level-actions" aria-label="任务数据操作">
                <button
                  class="action-link data-output-action"
                  :data-testid="`data-task-open-${task.taskCode}`"
                  type="button"
                  :disabled="!task.canOpen || isOpeningTask(task.taskCode)"
                  @click="openTaskFolder(task.taskCode)"
                >
                  {{ isOpeningTask(task.taskCode) ? "打开中…" : "打开" }}
                </button>
                <button
                  class="action-link data-output-action"
                  :data-testid="`data-task-url-${task.taskCode}`"
                  type="button"
                  :disabled="!task.canShare || isSharingTask(task.taskCode)"
                  @click="copyTaskUrl(task.taskCode)"
                >
                  {{ isSharingTask(task.taskCode) ? "生成中…" : "URL" }}
                </button>
              </div>
            </div>

            <div
              v-if="isTaskExpanded(task.taskCode)"
              :id="`data-task-details-${task.taskCode}`"
              class="data-task-details"
            >
            <header class="data-task-item__header">
              <div class="data-task-identity">
                <span>试验完成 {{ task.completedExperimentCount }}/{{ task.totalExperimentCount }}</span>
              </div>
              <div class="data-task-health" aria-label="PDF 输出统计">
                <span class="is-success">{{ task.successfulPdfCount }} 成功</span>
                <span class="is-missing">{{ task.missingPdfCount }} 缺失</span>
                <span class="is-failed">{{ task.failedPdfCount }} 失败</span>
              </div>
              <strong class="data-task-percent">{{ task.progressPercent }}%</strong>
            </header>
            <div
              class="data-task-progress"
              role="progressbar"
              :aria-label="`${task.taskCode} 试验完成进度`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="task.progressPercent"
            >
              <span :style="{ width: `${task.progressPercent}%` }"></span>
            </div>
            <div class="data-experiment-list">
              <div
                v-for="experiment in task.experiments"
                :key="experiment.experimentCode"
                class="data-experiment-row"
              >
                <div class="data-experiment-name">
                  <strong>{{ experiment.experimentName }}</strong>
                  <span class="data-code">{{ experiment.experimentCode }}</span>
                </div>
                <span class="data-experiment-status" :class="`is-${experiment.status}`">
                  {{ formatExperimentStatus(experiment.status) }}
                </span>
                <div class="data-experiment-pdfs">
                  <span>PDF {{ experiment.pdfCount }}</span>
                  <span v-if="experiment.failedPdfCount" class="is-failed">失败 {{ experiment.failedPdfCount }}</span>
                  <span v-if="experiment.missingPdfCount" class="is-missing">缺失 {{ experiment.missingPdfCount }}</span>
                </div>
                <div class="data-experiment-actions">
                  <button
                    class="action-link data-output-action"
                    :data-testid="`data-open-${task.taskCode}-${experiment.experimentCode}`"
                    type="button"
                    :disabled="!experiment.canOpen || isOpeningExperiment(task.taskCode, experiment.experimentCode)"
                    @click="openExperimentFolder(task.taskCode, experiment.experimentCode)"
                  >
                    {{ isOpeningExperiment(task.taskCode, experiment.experimentCode) ? "打开中…" : "打开" }}
                  </button>
                  <button
                    class="action-link data-output-action"
                    :data-testid="`data-url-${task.taskCode}-${experiment.experimentCode}`"
                    type="button"
                    :disabled="!experiment.canShare || isSharingExperiment(task.taskCode, experiment.experimentCode)"
                    @click="copyExperimentUrl(task.taskCode, experiment.experimentCode)"
                  >
                    {{ isSharingExperiment(task.taskCode, experiment.experimentCode) ? "生成中…" : "URL" }}
                  </button>
                </div>
              </div>
            </div>
            </div>
          </article>
        </div>
        <div v-if="tasksLoading" class="data-task-refresh-overlay" data-testid="data-tasks-refreshing" role="status">
          正在读取任务数据…
        </div>
      </div>

      <div v-if="tasksTotal > 0" class="data-task-pagination" aria-label="任务数据分页">
        <span>共 {{ tasksTotal }} 个任务</span>
        <div>
          <button class="action-btn secondary" data-testid="data-task-prev" type="button" :disabled="tasksLoading || tasksPage <= 1" @click="goToTaskPage(tasksPage - 1)">上一页</button>
          <span>第 {{ tasksPage }} / {{ tasksPageCount }} 页</span>
          <button class="action-btn secondary" data-testid="data-task-next" type="button" :disabled="tasksLoading || tasksPage >= tasksPageCount" @click="goToTaskPage(tasksPage + 1)">下一页</button>
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
import { formatAxisLabel, formatExperimentStatus, formatExportRange } from "./model";
import { useDataPage } from "./useDataPage";

const {
  browseDirectory,
  copyExperimentUrl,
  copyTaskUrl,
  defaultPath,
  directorySelecting,
  exportsError,
  exportsLoading,
  failedCount,
  failedExports,
  goToTaskPage,
  handleTaskClick,
  handleTaskDoubleClick,
  isOpeningExperiment,
  isOpeningTask,
  isRetrying,
  isSharingExperiment,
  isSharingTask,
  isTaskExpanded,
  openExperimentFolder,
  openTaskFolder,
  pathStatusClass,
  pathStatusLabel,
  retryAllFailed,
  retryFailed,
  retryingAll,
  savePath,
  saveSettings,
  searchTaskOutputs,
  shareFallbackUrl,
  settingsError,
  settingsLoading,
  settingsSaving,
  settingsSuccess,
  taskActionError,
  taskActionSuccess,
  taskOutputs,
  tasksError,
  tasksLoading,
  tasksPage,
  tasksPageCount,
  tasksQuery,
  tasksTotal,
  toggleTaskExpansion,
} = useDataPage();
</script>
