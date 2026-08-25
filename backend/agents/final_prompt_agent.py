import json
import re
from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState
from .llm_config import create_chat_llm
from .prompt_agent import _normalize_cue_list, _serialize_cues

PRESERVATION_KEYWORDS = (
    "keep", "preserve", "retain", "maintain", "unchanged", "same", "original",
    "do not change", "don't change", "without changing",
    "保持", "保留", "不变", "不要改变", "不能改变", "不修改", "不移动", "原样"
)

PRESERVATION_DEFAULT_CUES = [
    "preserve original subject identity",
    "preserve original face",
    "preserve original clothing",
    "preserve original pose",
    "preserve original position",
    "preserve original scale",
    "preserve original composition",
    "preserve original camera angle",
    "preserve original lighting direction",
]

PRESERVATION_NEGATIVE_CUES = [
    "changed identity",
    "changed face",
    "changed clothing",
    "changed pose",
    "changed position",
    "changed scale",
    "changed composition",
    "changed camera angle",
    "inconsistent lighting",
    "subject drift",
]


def _contains_preservation_request(text: str) -> bool:
    lowered = (text or "").lower()
    return any(keyword in lowered for keyword in PRESERVATION_KEYWORDS)


def _append_unique_cue(cues, text: str, weight: float, cue_type: str = "relation"):
    key = text.strip().lower()
    if not key:
        return
    for cue in cues:
        if str(cue.get("text", "")).strip().lower() == key:
            cue["weight"] = max(float(cue.get("weight", 1.0)), weight)
            cue["type"] = cue.get("type") or cue_type
            return
    cues.append({"text": text, "weight": weight, "type": cue_type})


def _reinforce_preservation_cues(final_prompts: dict, user_input: str) -> dict:
    if not _contains_preservation_request(user_input):
        return final_prompts

    positive_cues = list(final_prompts.get("positive_cues") or [])
    negative_cues = list(final_prompts.get("negative_cues") or [])

    for cue in PRESERVATION_DEFAULT_CUES:
        _append_unique_cue(positive_cues, cue, 1.6, "relation")
    for cue in PRESERVATION_NEGATIVE_CUES:
        _append_unique_cue(negative_cues, cue, 1.4, "attribute")

    positive_cues.sort(key=lambda c: c["weight"], reverse=True)
    negative_cues.sort(key=lambda c: c["weight"], reverse=True)
    final_prompts["positive_cues"] = positive_cues
    final_prompts["negative_cues"] = negative_cues
    final_prompts["positive"] = _serialize_cues(positive_cues)
    final_prompts["negative"] = _serialize_cues(negative_cues)
    return final_prompts

def final_prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent (Plain Text Mode) ---")

    # 1. 获取输入
    user_input = state.get("user_input", "") 
    intent = state.get("intent", "")  # 保留但未使用，兼容原有状态结构
    style = state.get("style", "")
    knowledge = state.get("knowledge_context", "")  # 保留但未使用
    global_context = state.get("global_context", "")

    # =========================================================================
    # 步骤 A: 直接处理纯文本输入，不解析权重，原样保留所有词汇
    # =========================================================================
    # 仅做简单的空值处理，不修改任何用户输入的词汇
    llm_view_input = user_input.strip() if user_input.strip() else "no visual elements"
    
    print(f"DEBUG: Input to LLM -> {llm_view_input}")
    # =========================================================================

    # 2. 初始化 LLM
    llm = create_chat_llm(
        default_model="gpt-4o",
        temperature=0.3, 
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. System Prompt (移除权重相关逻辑，仅保留纯文本描述规则)
    system_prompt = """
    你是负责描述视觉场景的艺术指导。请把输入内容整理成适合图像/视频生成模型使用的英文 positive / negative prompt。
    
    ### 输入数据
    - 视觉元素：{masked_input}
    - 上下文：{global_context}
    - 风格：{style}

    ### 关键格式规则
    1. positive 必须是英文视觉描述，可以以 "The image features..."、"The scene displays..." 或 "A view of..." 这类表达开头。
    2. 必须完整保留 {masked_input} 中的视觉元素，不要丢词、改词或凭空增删核心对象。
    3. 如果输入包含 keep、preserve、retain、unchanged、same、original、do not change、保持、保留、不变、不移动等含义，必须视为最高优先级编辑约束。positive 里要明确写出需要保持不变的主体身份、脸、服装、姿态、位置、尺度、构图、镜头角度和光照方向。
    4. 图生图/上传图编辑时，源图是视觉锚点。不要省略 "person unchanged"、"position unchanged"、"keep objects in the same place"、"keep the scene unchanged" 这类约束，要改写成具体 preservation phrases。
    5. 禁止写成剧情叙事，例如 discussing、talking、thinking；除非关键词明确是 person，不要把元素当成人物角色。

    ### 输出 JSON
    {{
        "positive": "The image features [all input elements], preserve original subject identity, preserve original pose, preserve original position...",
        "negative": "low quality, changed identity, changed pose, changed position..."
    }}
    """

    # 4. 创建模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "请使用给定视觉元素生成英文 positive / negative prompt，并严格返回 JSON。")
    ])

    chain = prompt | llm

    # 5. 执行
    result = chain.invoke({
        "masked_input": llm_view_input,  # 直接传入纯文本用户输入
        "global_context": global_context,
        "style": style
    })

    # 6. 解析结果（移除权重还原逻辑，直接使用LLM输出）
    try:
        final_prompts = json.loads(result.content)
        # 确保positive字段存在，且不修改用户输入的任何词汇
        positive_text = final_prompts.get("positive", llm_view_input)
        negative_text = final_prompts.get("negative", "low quality, blurry, distorted")
        
        final_prompts = {
            "positive": positive_text,
            "negative": negative_text
        }

    except Exception as e:
        print(f"Error: {e}")
        final_prompts = {
            "positive": user_input,  # 异常时直接返回原始用户输入
            "negative": "bad quality"
        }

    # 这条路径是「用户已手工编辑过 cue，再重新生成」。
    # 用户改过的文字不能被改写，因此结构化 cue 直接从用户输入反解，
    # 只补上类型与权重，不动 text 本身。
    incoming_cues = state.get("positive_cues")
    final_prompts["positive_cues"] = _normalize_cue_list(incoming_cues, user_input)
    final_prompts["negative_cues"] = _normalize_cue_list(
        state.get("negative_cues"),
        state.get("negative_prompt", "")
    )
    if final_prompts["positive_cues"]:
        final_prompts["positive"] = _serialize_cues(final_prompts["positive_cues"])
    if final_prompts["negative_cues"]:
        final_prompts["negative"] = _serialize_cues(final_prompts["negative_cues"])

    final_prompts = _reinforce_preservation_cues(final_prompts, user_input)

    print(f"AGENCY: Final Prompt Output: {final_prompts['positive']}")
    print(f"AGENCY: Preserved {len(final_prompts['positive_cues'])} user-edited cues")
    return {"final_prompt": final_prompts}

