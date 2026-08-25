<template>
  <div
    class="overlay fixed inset-0 flex items-center justify-center bg-black/60 z-40"
    @click.self="onClose"
  >
    <div class="modal bg-gray-50 rounded-lg shadow-xl overflow-auto p-4 w-full"
        style="max-width: 500px;">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold text-gray-700">工作流参数</h2>
        <button
          @click="onClose"
          class="text-gray-500 hover:text-gray-800 text-2xl"
        >
          &times; </button>
      </div>
      <WorkflowForm
        :selected-ids="props.selectedIds"
        :is-generating="props.isGenerating"
        :initial-module-id="props.initialModuleId"
        :initial-workflow-type="props.initialWorkflowType" @generate="onGenerate"
        @upload="onUpload"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// (导入 WorkflowForm, 它现在是这个组件的子组件)
import WorkflowForm from './WorkflowForm.vue';

// 1. 定义 Props (从 App.vue 接收)
const props = defineProps<{
  selectedIds: string[];
  isGenerating: boolean;
  initialModuleId: string | null;
  initialWorkflowType: 'preprocess' | 'image' | 'video' | null; // <-- (核心修改) 添加新 prop
}>()
// 2. 定义 Emits (向 App.vue 转发)
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'generate', moduleId: string, parameters: Record<string, any>): void;
  (e: 'upload', file: File): void;
}>()

// 3. 事件转发：当 WorkflowForm 触发 generate 时，我们把它再 emit 给 App.vue
function onGenerate(moduleId: string, parameters: Record<string, any>) {
  emit('generate', moduleId, parameters);
}

// 4. 事件转发：处理上传
function onUpload(file: File) {
  emit('upload', file);
}

// 5. 事件转发：关闭弹窗
function onClose() {
  emit('close');
}
</script>
