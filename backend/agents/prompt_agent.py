import json
import re
from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState
from .llm_config import create_chat_llm

# --- 0. 三种模式共用的「改写 + 分解」规则 ---
# 目标：
#   1) 用户那句自然语言必须被完整改写，不能原样塞进 prompt
#   2) 改写结果拆成短语级 cue，每条只表达一件事
#   3) 每条 cue 标注 relation / entity / attribute，关系单列
#   4) cue 可以保留自然语言标点；结构化列表是前端的首选数据源
CUE_DECOMPOSITION_RULES = """

### 改写与线索拆解（必须先执行）

步骤 1：完整改写。
不要把用户原句原样塞进 prompt。请理解用户真正想要的画面或操作，把它改写成适合生成模型理解的英文视觉语言；补足必要的具体视觉细节，去掉口语化废话。

步骤 2：拆成短语线索。
把改写后的描述拆成独立 cue。每条 cue：
- 只表达一个概念；
- 是简短名词/形容词短语，最好 2-8 个英文词，不要写成长句；
- 可以保留必要标点来表达关系；
- 不能包含冒号，冒号仅用于权重格式。

步骤 3：为每条 cue 标注类型。
- "relation"：两个或更多实体之间的空间/逻辑关系，或一个实体与视角的关系，例如 "child in front of display case"。
- "entity"：独立主体或物体，例如 "child"、"display case"、"astronaut"。
- "attribute"：单个实体的特征或整体观感，例如 "wooden case"、"warm rim light"。
单个物体的特征是 attribute，不是 relation；两个物体之间的位置或连接才是 relation。

步骤 4：按重要性赋权。
关系最容易被扩散模型忽略，因此权重最高。
- 来自用户请求的 relation：1.4 - 1.6
- entity：1.2 - 1.4
- 来自用户请求的 attribute：1.1 - 1.3
- 来自上下文/知识的 attribute：1.0 - 1.1
前端会按权重排序显示，权重也决定阅读顺序。

### 输出契约
只返回合法 JSON，必须包含以下四个 key。`positive` / `negative` 是生成器消费的扁平字符串；`positive_cues` / `negative_cues` 是同一内容的结构化列表，顺序必须一一对应。

{{
    "positive": "(cue text:1.5) | (cue text:1.2)",
    "negative": "(cue text:1.3)",
    "positive_cues": [
        {{"text": "child in front of display case", "weight": 1.5, "type": "relation"}},
        {{"text": "wooden display case", "weight": 1.2, "type": "attribute"}}
    ],
    "negative_cues": [
        {{"text": "child behind the case", "weight": 1.3, "type": "relation"}}
    ]
}}
"""

# --- 1. 定义三套完全独立的 System Prompt ---

# A. 生图模式提示词 (用于图像生成/编辑)
IMAGE_SYSTEM_PROMPT = """
你是面向 ComfyUI 的 Stable Diffusion / FLUX 专业提示词工程师。请根据输入生成适合图像生成或图像编辑的英文加权提示词。

上下文输入：
- 全局上下文：{global_context}
- 本次局部指令：{user_input}
- 视觉风格：{style}
- 知识补充：{knowledge}
- 实体：{entities}
- 属性：{attributes}
- 关系：{relations}

处理重点：
1. 用户本次输入优先级最高，其次是全局上下文，再其次是知识补充。
2. relations 表示实体之间的位置、包含、遮挡、连接、视线或镜头关系，必须逐条保留为独立英文短语，不要合并或改写成单个实体属性。
3. 如果用户要求保持、保留、不变、不要改变等，必须在 positive 中显式加入英文 preservation cues，例如 "preserve original face"、"preserve original pose"、"keep object in the same position"。
4. negative 中加入对应失败模式，例如 changed identity、changed pose、wrong spatial relation、blurry、bad anatomy。
5. 最终 prompt 内容必须是英文，便于下游图像模型处理；但你可以用中文理解输入。
6. 总长度控制在 512 tokens 内。

输出格式：只返回 JSON，包含 positive、negative、positive_cues、negative_cues。
""" + CUE_DECOMPOSITION_RULES

# B. 生视频模式提示词 (用于视频生成)
VIDEO_SYSTEM_PROMPT = """
你是 AI 视频生成模型的专业提示词工程师。请根据输入生成适合文生视频、图生视频、镜头控制或补帧工作流的英文加权提示词。

上下文输入：
- 全局上下文：{global_context}
- 本次局部指令：{user_input}
- 视觉风格：{style}
- 知识补充：{knowledge}
- 实体：{entities}
- 属性：{attributes}
- 关系：{relations}

处理重点：
1. 视频 prompt 要优先表达主体、场景、动作、镜头运动、运动质量、构图、灯光和风格。
2. relations 必须在整个视频片段中保持，而不只是第一帧成立；可写成 "subject stays in front of object throughout" 这类英文短语。
3. 图生视频/镜头控制默认保留原图主体身份、构图、位置、尺度、灯光方向和场景，除非用户明确要求改变。
4. 如果用户要求保持不变，positive 必须加入明确 preservation cues，negative 加入相反风险，如 identity drift、relative position changing、scene drift。
5. 最终 prompt 内容必须是英文；输出只允许 JSON。

输出格式：只返回 JSON，包含 positive、negative、positive_cues、negative_cues。
""" + CUE_DECOMPOSITION_RULES

# C. 音频模式提示词 (用于生旁白/TTS)
AUDIO_SYSTEM_PROMPT = """
你是 AI 背景音乐生成的音乐指导。请根据场景、风格和用户要求，写出自然、沉浸的英文音乐描述。

上下文输入：
- 场景上下文：{global_context}
- 用户要求：{user_input}
- 情绪/风格：{style}
- 知识补充：{knowledge}
- 实体：{entities}
- 属性：{attributes}
- 关系：{relations}

要求：
1. 只描述音乐，不直接描述画面；从画面关系中推断情绪、节奏、乐器、质感和强度。
2. 不写歌词、旁白、对话或音效，除非用户明确要求。
3. 不使用权重语法，不输出关键词列表。
4. 最终内容必须是英文自然句。
5. 只返回 JSON：{{ "text": "one or two smooth English sentences for background music" }}
"""

# 定义视频工作流名称常量（便于维护）
VIDEO_WORKFLOWS = {
    "TextGenerateVideo.json",
    "ImageGenerateVideo.json",
    "CameraControl.json",
    "FLFrameToVideo.json",
    "FrameInterpolation.json"
}

VALID_CUE_TYPES = ("relation", "entity", "attribute")

# 关系类的判别词。模型漏标 type 时用它兜底，也用来纠正明显的误标。
_RELATION_HINTS = (
    " in front of", " behind", " next to", " beside", " above", " below", " under",
    " on top of", " inside", " enclosed", " through", " looking at", " facing",
    " holding", " connected", " between", " around", " toward", " towards",
    " overlapping", " occluding", " partially hidden", " seen from", " viewed from",
    " orbiting", " centered in", " relative to", " closer to", " farther from",
)


def _infer_cue_type(text):
    """模型没给 type 或给了非法值时的兜底判别。"""
    low = f" {str(text).lower().strip()} "
    if any(h in low for h in _RELATION_HINTS):
        return "relation"
    # 单个名词短语（不含动词性连接）视为实体，其余归属性
    return "entity" if len(low.split()) <= 2 else "attribute"


def _clean_cue_text(text):
    """清理 cue 外层格式，但保留自然语言内部的逗号和冒号。"""
    s = str(text or "").strip().strip("()").strip()
    return " ".join(s.split())


def _normalize_cue_list(raw_list, fallback_string=""):
    """把模型返回的 cue 列表规范化成 [{text, weight, type}]。
    模型没返回结构化列表时，从扁平字符串回退解析。"""
    cues = []

    if isinstance(raw_list, list) and raw_list:
        for item in raw_list:
            if isinstance(item, dict):
                text = _clean_cue_text(item.get("text"))
                if not text:
                    continue
                try:
                    weight = float(item.get("weight", 1.0))
                except (TypeError, ValueError):
                    weight = 1.0
                ctype = str(item.get("type", "")).strip().lower()
                if ctype not in VALID_CUE_TYPES:
                    ctype = _infer_cue_type(text)
                cues.append({"text": text, "weight": round(weight, 1), "type": ctype})
            elif isinstance(item, str):
                text = _clean_cue_text(item)
                if text:
                    cues.append({"text": text, "weight": 1.0, "type": _infer_cue_type(text)})

    if not cues and fallback_string:
        # 新格式使用不会与自然语言逗号冲突的分隔符；旧记录仍兼容
        # "(a:1.5), (b:1.0)"，最后再兜底处理无括号的逗号格式。
        raw = str(fallback_string).strip()
        if " | " in raw:
            chunks = raw.split(" | ")
        elif re.search(r"\)\s*,\s*\(", raw):
            chunks = re.split(r"\)\s*,\s*\(", raw)
        elif raw.startswith("(") and raw.endswith(")"):
            # 单条带括号的关系 cue 可以合法包含逗号。
            chunks = [raw]
        else:
            chunks = raw.split(",")
        for chunk in chunks:
            body = chunk.strip().strip("()").strip()
            if not body:
                continue
            weight = 1.0
            if ":" in body:
                head, _, tail = body.rpartition(":")
                try:
                    weight = float(tail.strip())
                    body = head
                except ValueError:
                    pass
            text = _clean_cue_text(body)
            if text:
                cues.append({"text": text, "weight": round(weight, 1), "type": _infer_cue_type(text)})

    # 按权重从大到小排，前端直接照此顺序渲染
    cues.sort(key=lambda c: c["weight"], reverse=True)
    return cues


def _serialize_cues(cues):
    return " | ".join(f"({c['text']}:{c['weight']:.1f})" for c in cues)

def prompt_agent_node(state: AgentState):
    print("--- Running Prompt Agent ---")

    # 1. Gather all context
    user_input = state.get("user_input", "")
    intent = state.get("intent", "")
    style = state.get("style", "")
    image_caption = state.get("image_caption", "")
    knowledge = state.get("knowledge_context", "")
    selected_workflow = state.get("selected_workflow", "")
    global_context = state.get("global_context","")

    # 语义分解：实体 / 属性 / 关系。三者分开传入，避免关系被稀释成又一组形容词。
    def _fmt_cues(items):
        items = [str(i).strip() for i in (items or []) if str(i).strip()]
        return "; ".join(items) if items else "(none provided)"

    entities_str = _fmt_cues(state.get("entities"))
    attributes_str = _fmt_cues(state.get("attributes"))
    relations_str = _fmt_cues(state.get("relations"))

    print(f"Selected Workflow: {selected_workflow}")
    print("global_context_prompt", global_context)
    print(f"  - Relations passed to prompt agent: {relations_str}")

    # 2. Initialize LLM
    llm = create_chat_llm(
        default_model="gpt-4o",
        temperature=0.7,
        model_kwargs={"response_format": {"type": "json_object"}}
    )

    # 3. 【核心优化】精准匹配视频工作流
    system_prompt = None
    # 优先匹配音频工作流
    if "Audio" in selected_workflow or "TextToAudio.json" in selected_workflow:
        print("  - Mode: AUDIO Scripting")
        system_prompt = AUDIO_SYSTEM_PROMPT
    # 精准匹配所有视频相关工作流
    elif any(workflow in selected_workflow for workflow in VIDEO_WORKFLOWS):
        print("  - Mode: VIDEO Prompting")
        system_prompt = VIDEO_SYSTEM_PROMPT
    # 默认匹配生图模式
    else:
        print("  - Mode: IMAGE Prompting")
        system_prompt = IMAGE_SYSTEM_PROMPT

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "User Request: {user_input}")
    ])

    # 4. Execute - 根据不同视频子模式调整参数
    invoke_kwargs = {
        "style": style,
        "knowledge": knowledge,
        "global_context": global_context,
        "user_input": user_input,
        "entities": entities_str,
        "attributes": attributes_str,
        "relations": relations_str
    }
    
    chain = prompt | llm
    result = chain.invoke(invoke_kwargs)

    # 5. Parse and Return
    try:
        final_prompts = json.loads(result.content)
    except json.JSONDecodeError as e:
        print(f"Error: JSON Decode Failed - {str(e)}")
        # 针对不同模式返回对应默认错误提示
        if system_prompt == VIDEO_SYSTEM_PROMPT:
            final_prompts = {
                "error": "failed to generate valid video prompt",
                "positive": "(default video:1.0)",
                "negative": "(jerky motion:1.0, low frame rate:1.0)"
            }
        elif system_prompt == AUDIO_SYSTEM_PROMPT:
            final_prompts = {
                "error": "failed to generate valid audio script",
                "text": "Failed to generate narration script."
            }
        else:
            final_prompts = {
                "error": "failed to generate valid image prompt",
                "positive": "(default image:1.0)",
                "negative": "(blurry:1.0, bad anatomy:1.0)"
            }

    # 6. 规范化结构化 cue。音频模式没有 cue 概念，跳过。
    if system_prompt != AUDIO_SYSTEM_PROMPT:
        pos_cues = _normalize_cue_list(
            final_prompts.get("positive_cues"),
            final_prompts.get("positive", "")
        )
        neg_cues = _normalize_cue_list(
            final_prompts.get("negative_cues"),
            final_prompts.get("negative", "")
        )
        final_prompts["positive_cues"] = pos_cues
        final_prompts["negative_cues"] = neg_cues
        # 扁平字符串按规范化后的顺序重写，保证两种表示一致
        if pos_cues:
            final_prompts["positive"] = _serialize_cues(pos_cues)
        if neg_cues:
            final_prompts["negative"] = _serialize_cues(neg_cues)

        by_type = {}
        for c in pos_cues:
            by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        print(f"AGENCY: Positive cues by type -> {by_type}")

    print(f"AGENCY: Prompt Agent Generated: {final_prompts}")

    return {"final_prompt": final_prompts}

