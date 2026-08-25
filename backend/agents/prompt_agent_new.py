import json
import re
from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState
from .llm_config import create_chat_llm


IMAGE_SYSTEM_PROMPT = """
你是资深视觉策略师和 AI 图像提示词导演，具备广告视觉与电影美术指导经验。请把用户请求改写为只含英文内容的图像 prompt，用于 FLUX、Stable Diffusion XL、Midjourney 风格图像模型和 ComfyUI 文本编码器。

输入：
- 用户请求：{user_input}
- 意图：{intent}
- 现有场景/全局上下文：{global_context}
- 上传图像说明：{image_caption}
- 期望风格：{style}
- 实体知识：{knowledge}

任务：生成一个 positive prompt 和一个 negative prompt。输出要适合 ComfyUI 正/负文本编码器，同时具备明确的电影感、美术方向、材质细节和商业视觉冲击力。

规则：
1. 用户请求是当前编辑指令，优先于冲突的场景上下文。
2. 保持/保留/不变类指令必须被视为一等编辑需求，并明确写入 positive。
3. 现有场景、图像说明和实体知识描述默认应被保留，除非用户明确要求改变。
4. 不要编造未提供的人名、品牌、文字、logo 或精确史实。
5. 如果是编辑，既要写 requested change，也要写 unchanged constraints。
6. 如果是新图，补全主体、动作、环境、构图、灯光、材质、风格、镜头感。
7. 最终 prompt 内容必须是英文，不要输出中文。
8. 每个短语用普通圆括号包裹，不使用权重或数字权重。
9. 只返回 JSON：{{ "positive": "...", "negative": "..." }}。
"""


IMAGE_TO_IMAGE_SYSTEM_PROMPT = """
你是专业 AI 图生图提示词工程师。请把用户请求改写为只含英文内容的 image-to-image prompt，用于 FLUX、Stable Diffusion XL 和 ComfyUI 文本编码器。

输入：
- 用户请求：{user_input}
- 意图：{intent}
- 现有场景/全局上下文：{global_context}
- 上传图像说明：{image_caption}
- 期望风格：{style}
- 实体知识：{knowledge}
- 已选工作流：{selected_workflow}

核心目标：把上传图像作为视觉事实来源，生成精确、可控、忠实于原图的英文 prompt。只改变用户要求改变的目标区域、主体、风格或属性。

规则：
1. 上传图像说明是主要视觉参考，必须提取并保留其中可见细节。
2. 用户请求是当前编辑指令，只作用于明确要求的内容。
3. 保持/保留/不变类指令必须以明确英文 preservation phrases 写入 positive。
4. 不要编造源图或用户请求中不存在的新主体、地点、物体、文字或 logo。
5. 不要描述水印。
6. 如需保留清晰可读文字，保留原文并加英文引号，不翻译。
7. 最终 prompt 内容必须是英文，不要输出中文。
8. 每个短语用普通圆括号包裹，不使用权重或数字权重。
9. 只返回 JSON：{{ "positive": "...", "negative": "..." }}。
"""


VIDEO_SYSTEM_PROMPT = """
你是 AI 视频生成和图生视频工作流的生产级 prompt 改写器。请把用户请求改写为简洁的英文括号短语。

输入：
- 用户请求：{user_input}
- 意图：{intent}
- 现有场景/全局上下文：{global_context}
- 上传图像说明：{image_caption}
- 期望风格：{style}
- 实体知识：{knowledge}
- 已选工作流：{selected_workflow}

任务：生成一个视频 positive prompt 和一个 negative prompt。positive 要优先表达主体、场景、动作、镜头运动、运动质量、构图、灯光和风格。

规则：
1. 用户请求是当前指令，优先于冲突上下文。
2. 保持/保留/不变类指令必须被写成运动约束。
3. 图生视频或镜头控制默认保留原始主体、构图、身份和场景，除非用户明确要求改变。
4. 使用一个清晰的主动作，不要混合多个无关动作。
5. 最终 prompt 内容必须是英文。
6. 每个短语用普通圆括号包裹，不使用权重。
7. 只返回 JSON：{{ "positive": "...", "negative": "..." }}。
"""


FIRST_LAST_FRAME_VIDEO_SYSTEM_PROMPT = """
你是专业首帧到尾帧视频提示词工程师。请把用户请求改写为只含英文内容的 prompt，用于生成从第一帧过渡到最终帧的视频。

输入：
- 用户请求：{user_input}
- 意图：{intent}
- 现有场景/全局上下文：{global_context}
- 上传图像说明：{image_caption}
- 期望风格：{style}
- 实体知识：{knowledge}
- 已选工作流：{selected_workflow}

核心目标：第一帧是起点，最终帧是目标锚点。prompt 必须描述两帧之间如何运动，同时保持主体身份、脸、服装、比例、场景逻辑、灯光方向和风格连续。

规则：
1. 用户请求用于澄清转场、动作或镜头运动。
2. 保持/保留/不变类指令必须明确写入 positive。
3. 强调从第一帧到最终帧的变化：move toward、turn into、appear、disappear、transform、push in、pull back 等。
4. 不要编造两帧或用户请求中不存在的新主体、地点、文字、logo 或事件。
5. 最终 prompt 内容必须是英文，不要输出中文。
6. 每个短语用普通圆括号包裹，不使用权重。
7. 只返回 JSON：{{ "positive": "...", "negative": "..." }}。
"""


AUDIO_SYSTEM_PROMPT = """
你是 AI 背景音乐生成的生产级 prompt 改写器。请把用户请求改写成自然的英文音乐描述。

输入：
- 用户请求：{user_input}
- 意图：{intent}
- 场景/全局上下文：{global_context}
- 上传图像说明：{image_caption}
- 期望情绪或风格：{style}
- 实体知识：{knowledge}

任务：生成一句或两句简洁背景音乐 prompt，使其匹配视觉场景和情绪。

规则：
1. 只描述音乐，不描述画面本身；从场景推断情绪、速度、乐器、质感和强度。
2. 除非用户明确要求，不写歌词、旁白、对话或音效。
3. 不使用权重标签或数字权重。
4. 最终内容必须是英文。
5. 只返回 JSON：{{ "text": "one or two smooth English sentences for background music" }}。
"""


VIDEO_WORKFLOWS = {
    "TextGenerateVideo.json",
    "ImageGenerateVideo.json",
    "CameraControl.json",
}

FIRST_LAST_FRAME_VIDEO_WORKFLOWS = {
    "FLFrameToVideo.json",
    "FrameInterpolation.json",
}

IMAGE_TO_IMAGE_WORKFLOWS = {
    "ImageGenerateImage_Basic.json",
    "ImageGenerateImage_Canny.json",
    "ImageInpainting.json",
    "PartialRepainting.json",
    "Put_It_Here.json",
    "RemovePeople.json",
}


def _select_system_prompt(selected_workflow: str):
    selected_workflow = selected_workflow or ""
    if "Audio" in selected_workflow or "TextToAudio.json" in selected_workflow:
        return "AUDIO", AUDIO_SYSTEM_PROMPT
    if any(workflow in selected_workflow for workflow in FIRST_LAST_FRAME_VIDEO_WORKFLOWS):
        return "FIRST_LAST_FRAME_VIDEO", FIRST_LAST_FRAME_VIDEO_SYSTEM_PROMPT
    if any(workflow in selected_workflow for workflow in VIDEO_WORKFLOWS):
        return "VIDEO", VIDEO_SYSTEM_PROMPT
    if any(workflow in selected_workflow for workflow in IMAGE_TO_IMAGE_WORKFLOWS):
        return "IMAGE_TO_IMAGE", IMAGE_TO_IMAGE_SYSTEM_PROMPT
    return "IMAGE", IMAGE_SYSTEM_PROMPT


def _fallback_prompt(mode: str):
    if mode == "AUDIO":
        return {
            "error": "failed to generate valid audio prompt",
            "text": "Soft ambient background music with a restrained cinematic mood.",
        }
    if mode == "VIDEO":
        return {
            "error": "failed to generate valid video prompt",
            "positive": "(cinematic video), (smooth natural motion), (stable subject identity), (stable framing), (consistent lighting), (clean frame detail)",
            "negative": "(jerky motion), (frame stutter), (flicker), (low quality), (identity drift), (warped subject)",
        }
    if mode == "FIRST_LAST_FRAME_VIDEO":
        return {
            "error": "failed to generate valid first-last-frame video prompt",
            "positive": "(0-2s match first frame composition), (2-4s smooth transition toward final frame), (4-6s match final frame composition), (preserve same subject identity across frames), (preserve scene continuity), (smooth temporal consistency), (stable lighting continuity)",
            "negative": "(jump cut), (failed transition), (does not reach final frame), (identity mismatch between frames), (scene discontinuity), (frame stutter), (flicker)",
        }
    if mode == "IMAGE_TO_IMAGE":
        return {
            "error": "failed to generate valid image-to-image prompt",
            "positive": "(faithfully reconstruct uploaded image), (preserve original subject), (preserve original composition), (preserve original lighting), (accurate material texture), (high image fidelity)",
            "negative": "(low quality), (blurry), (changed subject), (changed composition), (changed background), (invented objects), (warped structure)",
        }
    return {
        "error": "failed to generate valid image prompt",
        "positive": "(high quality image), (clear subject), (balanced composition), (clean lighting), (natural texture), (detailed finish)",
        "negative": "(low quality), (blurry), (bad anatomy), (text artifacts), (distorted details)",
    }


def _strip_prompt_weights(text: str):
    text = re.sub(r"\(([^():]+):\s*\d+(?:\.\d+)?\)", r"(\1)", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _ensure_parenthesized_phrases(text: str):
    text = _strip_prompt_weights(text)
    raw_phrases = re.split(r"\s*[,;]\s*", text)
    phrases = []
    for phrase in raw_phrases:
        phrase = phrase.strip()
        phrase = phrase.strip("() ")
        if phrase:
            phrases.append(f"({phrase})")
    return ", ".join(phrases)


def _normalize_output(mode: str, parsed: dict):
    if mode == "AUDIO":
        text = _strip_prompt_weights(str(parsed.get("text", "")))
        if not text:
            raise ValueError("audio output missing text")
        return {"text": text}

    positive = _ensure_parenthesized_phrases(str(parsed.get("positive", "")))
    negative = _ensure_parenthesized_phrases(str(parsed.get("negative", "")))
    if not positive or not negative:
        raise ValueError(f"{mode.lower()} output missing positive or negative")
    return {"positive": positive, "negative": negative}


def prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent (New Rewrite Mode) ---")

    user_input = state.get("user_input", "")
    intent = state.get("intent", "")
    style = state.get("style", "")
    image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "") or ""
    global_context = state.get("global_context", "")

    mode, system_prompt = _select_system_prompt(selected_workflow)
    print(f"Selected Workflow: {selected_workflow}")
    print(f"Prompt Mode: {mode}")

    llm = create_chat_llm(
        default_model="gpt-4o",
        temperature=0.35,
        model_kwargs={"response_format": {"type": "json_object"}},
    )

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            (
                "user",
                "请按要求改写为 JSON prompt。用户请求：{user_input}",
            ),
        ]
    )

    chain = prompt | llm
    result = chain.invoke(
        {
            "user_input": user_input,
            "intent": intent,
            "style": style,
            "image_caption": image_caption,
            "knowledge": knowledge,
            "selected_workflow": selected_workflow,
            "global_context": global_context,
        }
    )

    try:
        parsed = json.loads(result.content)
        final_prompts = _normalize_output(mode, parsed)
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        print(f"Error: Prompt rewrite failed - {str(e)}")
        final_prompts = _fallback_prompt(mode)

    print(f"AGENCY: Prompt Agent Generated: {final_prompts}")
    return {"final_prompt": final_prompts}

