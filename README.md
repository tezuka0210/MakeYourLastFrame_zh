# Make Your Last Frame 中文版

Make Your Last Frame 是一个迭代式视频创作系统，用于把抽象创意意图逐步转化为可控的图像、视频、音频和关键帧资产。系统把生成结果拆解为可再次编辑的视觉资产，让用户可以在生成流程中持续干预空间布局、主体结构和时间连续性。

## 系统架构

本项目采用前后端分离架构：

- Make Your Last Frame 前端：基于 Vue / Vite，负责节点树、画布、素材暂存区、关键帧取景框和视频拼接时间线。
- Python 后端：提供节点管理、资产上传、ComfyUI 调用、拼接导出、语音识别和多 Agent 提示词处理。
- ComfyUI 后端：独立运行的生成后端，通过 API 执行图像、视频、音频等工作流。
- SAM / 实体分割：用于根据视觉实体生成分割结果，支持后续资产再编辑。

## 模型与工作流

项目通过 `backend/workflows/` 中的 ComfyUI API JSON 调用不同生成流程。常见模型包括：

```text
flux-2-klein-base-9b-fp8.safetensors
flux1-fill-dev.safetensors
z_image_turbo_bf16.safetensors
Wan2_1-T2V-14B_fp8_e4m3fn.safetensors
wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors
wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors
wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors
wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors
wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors
wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors
wan2.2_fun_control_high_noise_14B_fp8_scaled.safetensors
wan2.2_fun_control_low_noise_14B_fp8_scaled.safetensors
```

## 目录结构

```text
MakeYourLastFrame_ZH/
├── backend/                 # Python 后端、Agent、数据库、工作流 JSON
│   ├── agents/              # 多 Agent 与提示词处理
│   ├── workflows/           # ComfyUI API JSON 文件
│   └── templates/           # 后端模板
├── frontend/                # Vue / Vite 前端
│   ├── src/components/      # 页面组件
│   ├── src/lib/             # 画布、节点图、语音、拼接等逻辑
│   └── src/composables/     # 前端状态与 API 调用
└── README.md
```

## 核心功能

- 节点式创作树：记录每次生成、上传、编辑、合并和反馈。
- 可编辑画布：拖入图像、视频帧、分割实体和手绘内容，支持移动、缩放、翻转、分层和组合。
- 关键帧取景框：在同一大画布上裁出多个关键帧视口，保持连续帧之间的空间一致性。
- Prompt Agent：把用户自然语言拆解为实体、属性、关系和可编辑提示词线索。
- 实体分割：根据视觉主体生成独立资产，便于再次排布。
- 底部时间线：暂存素材、视频轨、音频轨，并导出拼接结果。
- 语音输入：浏览器录音后发送到后端转写，可用于提示词输入。

## 本地运行

### 前置要求

- Python 3.10.14
- Node.js 18 或更高版本
- 可访问的 ComfyUI 服务
- 如需生成大模型工作流，建议使用 NVIDIA GPU

### 后端

```powershell
cd backend
python -m pip install -r requirements.txt
python app.py
```

### 前端

```powershell
cd frontend
npm install
npm run dev
```

启动后根据终端输出访问 Vite 开发服务器地址。

## 语音输入配置

浏览器端麦克风会录制音频并发送到后端。后端默认使用 DMXAPI 的 Qwen Omni 音频输入接口，同时保留 `gpt-4o-transcribe` 作为可配置兼容路径。

请复制 `backend/.env.example` 为 `backend/.env`，并设置：

```text
SPEECH_TRANSCRIBE_API_KEY=你的 API Key
```

后端主机需要安装 FFmpeg，用于把浏览器录制的 WebM 转为 WAV。领域热词、别名和识别后修正规则配置在 `backend/speech_glossary.json`。

## 中文化说明

当前版本已将主要前端页面、交互提示、节点卡片、画布菜单、工作流表单、README 和后端 Agent system prompt 改为中文。为保证下游 ComfyUI / FLUX / Wan 等模型效果，后端 Agent 仍会要求最终传给生成模型的 positive / negative prompt 使用英文内容。
