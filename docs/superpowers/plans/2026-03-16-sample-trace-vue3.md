# Sample Trace Vue3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy sample trace panel in `SamplesPage.vue` with Vue3 state and template rendering while keeping fields, layout, and button semantics unchanged.

**Architecture:** Add a focused trace model to derive summary text and timeline items from `samples` and `schedules`, wrap it in a composable for query/reset state, and wire only the bottom trace section of `SamplesPage.vue` to Vue state. Reuse existing timeline CSS and legacy event semantics.

**Tech Stack:** Vue 3 Composition API, Vitest, existing localStorage-backed storage snapshot helpers.

---

## Chunk 1: Trace Model + UI Wiring

### Task 1: Add failing tests
- [x] Add runtime tests for query/reset and timeline rendering in `frontend/src/pages/SamplesPage.runtime.test.js`
- [x] Add model tests for summary/timeline derivation in `frontend/src/lib/sampleTraceModel.test.js`
- [x] Run `npm run test:run -- src/pages/SamplesPage.runtime.test.js src/lib/sampleTraceModel.test.js` and confirm failure

### Task 2: Implement model/composable
- [x] Create `frontend/src/lib/sampleTraceModel.js` for event extraction, summary text, and sorted timeline items
- [x] Create `frontend/src/composables/useSampleTrace.js` for query/reset/load state
- [x] Re-run targeted tests and confirm green

### Task 3: Wire SamplesPage trace section
- [x] Modify only the `样品全生命周期追踪` section in `frontend/src/pages/SamplesPage.vue`
- [x] Keep labels, field order, and button semantics unchanged
- [x] Run `npm run test:run -- src/pages/SamplesPage.runtime.test.js src/lib/sampleTraceModel.test.js src/lib/samplesFlowModel.test.js src/lib/samplesProcessModel.test.js`
- [x] Run `npm run build`
