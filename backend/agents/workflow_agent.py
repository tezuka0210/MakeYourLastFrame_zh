import json
from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState
from .llm_config import create_chat_llm

WORKFLOW_METADATA = {
    "ImageGenerateImage_Basic.json": "通用图生图。仅用于图像融合或修改，不用于线稿生成。",
    "ImageGenerateImage_Canny.json": "专用图生图。仅用于从线稿生成图像，不用于融合或普通修改。",
    "ImageCanny.json": "通过提取边缘图生成线稿。",
    "LayerStacking.json": "把一个对象叠放到另一张图像上。仅用于叠放，不用于融合或线稿。",
    "TextToAudio.json": "生成音频、语音或旁白。用户提到 narration、voice、say、speak、旁白、配音、说话、音频时优先选择。",
    "TextGenerateImage.json": "根据文本生成静态图像。用于视觉画面描述，不用于旁白或音频。",
    "TextGenerateVideo.json": "根据文本生成视频或动画。",
    "ImageGenerateVideo.json": "根据图像生成视频或动画。",
    "FLFrameToVideo.json": "根据视频首帧和尾帧生成中间过渡视频。",
    "CameraControl.json": "控制镜头运动方向。",
    "ImageInpainting.json": "对图像蒙版区域进行局部重绘。"
}

def format_workflow_list(file_list):
    formatted_lines = []
    for f in file_list:
        desc = WORKFLOW_METADATA.get(f, "通用工作流。只有在没有更具体匹配时使用。")
        formatted_lines.append(f"- {f}: {desc}")
    return "\n".join(formatted_lines)

def workflow_selector_node(state: AgentState):
    print("--- Running Workflow Agent ---")
    # 1. 打印所有关键变量（调试用，可后续删除）
    print(f"[DEBUG] intent: {state.get('intent')}")
    print(f"[DEBUG] user_input: {state.get('user_input')}")
    print(f"[DEBUG] workflow_files: {state.get('workflow_list')}")
    print(f"[DEBUG] parent_workflow: {state.get('parent_workflow')}")

    intent = state.get("intent", "")
    user_input = state.get("user_input", "")
    workflow_files = state.get("workflow_list", []) 
    parent_workflow = state.get("parent_workflow", "None")

    # 【关键优化】强制用user_input（而非intent）做核心匹配，避免intent字段污染
    # 同时合并intent+user_input，双重兜底
    combined_input = f"{intent} {user_input}".lower().strip()
    print(f"[DEBUG] combined_input (lowercase): {combined_input}")

    if not workflow_files:
        return {"selected_workflow": "Error", "workflow_title": "Error"}

    # 【强化硬规则】宽松匹配+强制优先级
    # 匹配关键词：generate line draft / line draft / generate line art draft
    line_draft_keywords = ["generate line draft", "generate line art draft"]
    if any(keyword in combined_input for keyword in line_draft_keywords):
        if "ImageCanny.json" in workflow_files:
            print("AGENCY: Matched line draft keyword -> Selected: ImageCanny.json | Title: 生成线稿")
            return {
                "selected_workflow": "ImageCanny.json",
                "workflow_title": "生成线稿"
            }
        else:
            print(f"AGENCY: Line draft matched but ImageCanny.json NOT in workflow_files: {workflow_files}")
            return {"selected_workflow": "Error", "workflow_title": "ImageCanny.json not available"}

    # 未触发硬规则才走LLM逻辑
    llm = create_chat_llm(
        default_model="gpt-4o-mini",
        env_name="OPENAI_FAST_MODEL",
        temperature=0,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    formatted_file_list = format_workflow_list(workflow_files)

    system_prompt = """
    你是 ComfyUI 工作流编排引擎。你的任务是分析用户意图，并选择最合适的 workflow 文件。

    可用工作流与规则：
    {file_list}

    当前上下文：
    - 用户意图："{input}"
    - 父节点："{parent_info}"

    关键决策逻辑（按顺序执行）：
    0. 禁用规则：任何情况下都不要选择 "ImageMerging.json"。
    1. 识别模态关键词：
       - 音频/旁白：如果意图提到 narration、voice、speak、audio、sound、旁白、配音、说话、音频、声音，必须选择 TextToAudio.json。
       - 视频：如果意图提到 video、movie、motion、seconds、视频、动画、运动、镜头、秒数，选择视频工作流（TextGenerateVideo.json / FLFrameToVideo.json）。
       - 图像：如果意图主要描述视觉画面且没有音频/旁白需求，选择图像工作流，并继续参考第 2 条。
    2. 图像子规则：
       - 线稿/草图：只使用 ImageCanny.json；如果是基于线稿继续生成，再考虑 ImageGenerateImage_Canny.json。
       - 融合/修改：使用 ImageGenerateImage_Basic.json。
       - 叠放对象：使用 LayerStacking.json。
    3. 输出要求：
       - 只返回 JSON：{{ "filename": "...", "title": "..." }}
       - filename 必须是可用工作流文件名；title 用简洁中文概括本次工作流。
    """

    prompt = ChatPromptTemplate.from_messages([("system", system_prompt)])
    chain = prompt | llm

    result = chain.invoke({
        "file_list": formatted_file_list,
        "input": combined_input,
        "parent_info": parent_workflow
    })

    try:
        parsed_result = json.loads(result.content)
        selected_file = parsed_result.get("filename", "default.json")
        generated_title = parsed_result.get("title", "New Workflow")
    except json.JSONDecodeError as e:
        print(f"AGENCY: JSON解析失败 - {str(e)} | LLM返回内容: {result.content}")
        selected_file = "error.json"
        generated_title = "JSON Parse Error"

    print(f"AGENCY: LLM Selected: {selected_file} | Title: {generated_title}")

    return {
        "selected_workflow": selected_file,
        "workflow_title": generated_title
    }
