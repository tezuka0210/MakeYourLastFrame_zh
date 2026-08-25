# 前端说明

本目录是 Make Your Last Frame 中文版前端，基于 Vue 3、Vite 和 TypeScript。

## 安装依赖

```sh
npm install
```

## 开发运行

```sh
npm run dev
```

## 构建检查

```sh
npm run build
```

## 代码质量

```sh
npm run lint
```

主要源码位于 `src/`：

- `components/`：页面组件、弹窗、左右面板、时间线。
- `lib/`：画布拖拽、节点图渲染、工作流表单、语音输入、素材卡片等逻辑。
- `composables/`：前端状态管理和后端 API 调用。
