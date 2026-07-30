<template>
  <AppModal
    :open="open"
    content-class="system-operation-scope-wizard-modal"
    data-testid="operation-log-scope-selector"
    title="设置工作日志查询范围"
    @close="cancel"
  >
    <div class="system-operation-scope-wizard">
      <section v-if="step === 'employee'" class="system-operation-scope-pane" data-testid="operation-log-employee-step">
        <div class="system-operation-scope-toolbar">
          <label class="system-operation-scope-search">
            <span>搜索员工</span>
            <input v-model="employeeQuery" type="search" placeholder="输入姓名或账号" />
          </label>
          <div class="system-operation-scope-actions">
            <button class="action-btn secondary" data-testid="operation-log-employee-select-all" type="button" @click="selectAllEmployees">
              {{ employeeQuery.trim() ? "全选当前结果" : "全选" }}
            </button>
            <button class="action-btn secondary" data-testid="operation-log-employee-clear" type="button" @click="employeeDraft = []">清空</button>
          </div>
        </div>
        <div class="system-operation-scope-options" role="listbox" aria-label="选择员工" aria-multiselectable="true">
          <button
            v-for="employee in paginatedEmployeeOptions"
            :key="employee.id"
            class="system-operation-scope-option"
            :class="{ 'is-selected': employeeDraft.includes(employee.employeeName) }"
            :data-testid="`operation-log-employee-option-${employee.id}`"
            type="button"
            role="option"
            :aria-selected="employeeDraft.includes(employee.employeeName)"
            @click="toggleEmployee(employee.employeeName)"
          >
            <span class="system-operation-scope-option__check" aria-hidden="true">{{ employeeDraft.includes(employee.employeeName) ? "✓" : "" }}</span>
            <span class="system-operation-scope-option__copy">
              <strong>{{ employee.employeeName }}</strong>
              <small>{{ [employee.username, employee.roleName].filter(Boolean).join(" · ") || "员工账号" }}</small>
            </span>
          </button>
          <div v-if="filteredEmployeeOptions.length === 0" class="system-operation-scope-empty">没有匹配的员工，请更换关键词。</div>
        </div>
        <div v-if="filteredEmployeeOptions.length" class="system-operation-scope-pagination">
          <span data-testid="operation-log-employee-pagination-range">
            显示第 {{ employeePageStart }}–{{ employeePageEnd }} 名，共 {{ filteredEmployeeOptions.length }} 名
          </span>
          <AppPagination
            :current-page="employeePage"
            :page-count="employeePageCount"
            :show-jump-controls="false"
            data-testid="operation-log-employee-pagination"
            @change="employeePage = $event"
          />
        </div>
      </section>

      <section v-else class="system-operation-scope-pane" data-testid="operation-log-lab-step">
        <div class="system-operation-scope-toolbar">
          <label class="system-operation-scope-search">
            <span>搜索试验间</span>
            <input v-model="labQuery" type="search" placeholder="输入试验间名称" />
          </label>
          <div class="system-operation-scope-actions">
            <button class="action-btn secondary" data-testid="operation-log-lab-select-all" type="button" @click="selectAllLabs">
              {{ labQuery.trim() ? "全选当前结果" : "全选" }}
            </button>
            <button class="action-btn secondary" data-testid="operation-log-lab-clear" type="button" @click="labDraft = []">清空</button>
          </div>
        </div>
        <div class="system-operation-scope-options" role="listbox" aria-label="选择试验间" aria-multiselectable="true">
          <button
            v-for="labName in filteredLabOptions"
            :key="labName"
            class="system-operation-scope-option"
            :class="{ 'is-selected': labDraft.includes(labName) }"
            :data-testid="`operation-log-lab-option-${labName}`"
            type="button"
            role="option"
            :aria-selected="labDraft.includes(labName)"
            @click="toggleLab(labName)"
          >
            <span class="system-operation-scope-option__check" aria-hidden="true">{{ labDraft.includes(labName) ? "✓" : "" }}</span>
            <span class="system-operation-scope-option__copy">
              <strong>{{ labName }}</strong>
              <small>试验间</small>
            </span>
          </button>
          <div v-if="filteredLabOptions.length === 0" class="system-operation-scope-empty">没有匹配的试验间，请更换关键词。</div>
        </div>
      </section>
    </div>

    <template #footer>
      <button class="action-btn secondary" data-testid="cancel-operation-log-scope" type="button" @click="cancel">取消</button>
      <button class="action-btn" data-testid="confirm-operation-log-scope" type="button" @click="confirm">确认</button>
    </template>
  </AppModal>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";

const EMPLOYEE_PAGE_SIZE = 10;

const props = defineProps({
  employeeNames: {
    type: Array,
    default: () => [],
  },
  employeeOptions: {
    type: Array,
    default: () => [],
  },
  initialStep: {
    type: String,
    default: "employee",
  },
  labNames: {
    type: Array,
    default: () => [],
  },
  labOptions: {
    type: Array,
    default: () => [],
  },
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close", "confirm"]);
const employeeDraft = ref([]);
const employeePage = ref(1);
const employeeQuery = ref("");
const labDraft = ref([]);
const labQuery = ref("");
const step = ref("employee");

const normalizeText = (value) => String(value || "").trim();
const uniqueTexts = (values) => Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean)));

const filteredEmployeeOptions = computed(() => {
  const query = normalizeText(employeeQuery.value).toLocaleLowerCase("zh-Hans-CN");
  return props.employeeOptions.filter((employee) => {
    if (!query) {
      return true;
    }
    return [employee?.employeeName, employee?.username, employee?.roleName]
      .some((value) => normalizeText(value).toLocaleLowerCase("zh-Hans-CN").includes(query));
  });
});

const filteredLabOptions = computed(() => {
  const query = normalizeText(labQuery.value).toLocaleLowerCase("zh-Hans-CN");
  return props.labOptions.filter((labName) => !query || normalizeText(labName).toLocaleLowerCase("zh-Hans-CN").includes(query));
});

const employeePageCount = computed(() => Math.max(Math.ceil(filteredEmployeeOptions.value.length / EMPLOYEE_PAGE_SIZE), 1));
const employeePageStart = computed(() => filteredEmployeeOptions.value.length
  ? (employeePage.value - 1) * EMPLOYEE_PAGE_SIZE + 1
  : 0);
const employeePageEnd = computed(() => Math.min(employeePageStart.value + EMPLOYEE_PAGE_SIZE - 1, filteredEmployeeOptions.value.length));
const paginatedEmployeeOptions = computed(() => {
  const start = (employeePage.value - 1) * EMPLOYEE_PAGE_SIZE;
  return filteredEmployeeOptions.value.slice(start, start + EMPLOYEE_PAGE_SIZE);
});

const resetDraft = () => {
  employeeDraft.value = uniqueTexts(props.employeeNames);
  labDraft.value = uniqueTexts(props.labNames);
  employeeQuery.value = "";
  employeePage.value = 1;
  labQuery.value = "";
  step.value = props.initialStep === "lab" ? "lab" : "employee";
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetDraft();
    }
  },
);

watch(employeeQuery, () => {
  employeePage.value = 1;
});

watch(employeePageCount, (pageCount) => {
  employeePage.value = Math.min(employeePage.value, pageCount);
});

const toggleText = (draft, value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return;
  }
  draft.value = draft.value.includes(normalized)
    ? draft.value.filter((item) => item !== normalized)
    : [...draft.value, normalized];
};

const toggleEmployee = (employeeName) => toggleText(employeeDraft, employeeName);
const toggleLab = (labName) => toggleText(labDraft, labName);
const selectAllEmployees = () => {
  employeeDraft.value = uniqueTexts([
    ...employeeDraft.value,
    ...filteredEmployeeOptions.value.map((employee) => employee?.employeeName),
  ]);
};
const selectAllLabs = () => {
  labDraft.value = uniqueTexts([...labDraft.value, ...filteredLabOptions.value]);
};

const cancel = () => emit("close");
const confirm = () => emit("confirm", {
  scope: step.value,
  employeeNames: uniqueTexts(employeeDraft.value),
  labNames: uniqueTexts(labDraft.value),
});
</script>
