import json
from langchain_core.messages import HumanMessage,SystemMessage
from .state import AgentState
from .llm_config import create_chat_llm

def master_agent_node(state: AgentState):
    print("--- Running Master Agent ---")

    image_data = state.get("image_data", None)
    print(state.get("user_input",None))

    # 1. Initialize LLM (GPT-4o is required for Image Vision)
    llm = create_chat_llm(
        default_model="gpt-4o",
        env_name="OPENAI_VISION_MODEL",
        temperature=0,
        model_kwargs={"response_format":{"type": "json_object"}}
    )


    # 2. Construct the System Prompt
    system_prompt = """
    你是创意 AI 系统的“主控大脑”。你的任务是分析用户输入（文本 + 可选图像），并提取结构化信息。

    重要要求：
    1. 用户输入可能是中文或其它语言。
    2. 必须把请求拆成三个清晰类别：entities、attributes、relations。
    3. 为了便于下游图像/视频模型处理，提取出的具体值请翻译成英文；JSON key 必须保持英文。

    拆解规则（请严格区分）：
    - "entities"：主要主体或物体，只写名词，例如 "child"、"display case"、"artifact"。
    - "attributes"：只属于单个实体的特征，如颜色、材质、纹理、大小、状态。每项最好写明所属实体，例如 "wooden display case"、"glowing orb"。
    - "relations"：两个或多个实体之间的空间或逻辑关系；每项必须至少提到两个实体，或一个实体加视角，例如 "child stands in front of the display case"。

    单个物体的特征是 ATTRIBUTE，不是 relation。
    两个物体之间的连接或位置关系是 RELATION，不是 attribute。
    如果短语只提到一个实体且没有视角关系，就归入 attributes。
    不要编造用户输入里没有的内容；没有就返回空列表。

    只返回如下 JSON，不要输出额外文字：
    {
        "intent": "核心动作，例如 text_to_image、image_to_video、modify_image",
        "entities": ["visual subjects in English"],
        "attributes": ["single-entity traits in English"],
        "relations": ["links between entities in English"],
        "style": "visual style in English",
        "image_caption": "brief uploaded image caption in English, or empty string"
    }
    """

    # 3. Construct the User Message (Text + Image)
    content_blocks = [{"type": "text", "text": state["user_input"]}]

    if image_data:
        content_blocks.append({
            "type": "image_url",
            "image_url": {"url": image_data}
        })

    messages = [SystemMessage(content=system_prompt), HumanMessage(content=content_blocks)]

    # 4. Execute
    response = llm.invoke(messages)

    # 5. Parse JSON
    try:
        parsed_data = json.loads(response.content)
    except json.JSONDecodeError:
        print("❌ Master Agent: JSON Parse Error")
        parsed_data = {
            "intent": state["user_input"],
            "entities": [],
            "attributes": [],
            "relations": [],
            "style": "General",
            "image_caption": ""
        }

    def _as_str_list(value):
        """Downstream code assumes a flat list of strings. The model occasionally
        returns a bare string, None, or a list of dicts; normalise all of those."""
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, dict):
            return [str(v) for v in value.values() if str(v).strip()]
        if isinstance(value, list):
            out = []
            for item in value:
                if isinstance(item, str):
                    if item.strip():
                        out.append(item.strip())
                elif isinstance(item, dict):
                    out.append(", ".join(f"{k}: {v}" for k, v in item.items()))
                elif item is not None:
                    out.append(str(item))
            return out
        return [str(value)]

    entities = _as_str_list(parsed_data.get("entities"))
    attributes = _as_str_list(parsed_data.get("attributes"))
    relations = _as_str_list(parsed_data.get("relations"))

    print(f"AGENCY: Master Agent Intent: {parsed_data.get('intent')}")
    print(f"AGENCY: Entities({len(entities)}) {entities}")
    print(f"AGENCY: Attributes({len(attributes)}) {attributes}")
    print(f"AGENCY: Relations({len(relations)}) {relations}")

    # 6. Update State
    return {
        "intent": parsed_data.get("intent"),
        "entities": entities,
        "attributes": attributes,
        "relations": relations,
        "style": parsed_data.get("style"),
        "image_caption": parsed_data.get("image_caption")
    }
