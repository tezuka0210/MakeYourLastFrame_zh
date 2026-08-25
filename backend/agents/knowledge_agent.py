from langchain_core.prompts import ChatPromptTemplate
from .state import AgentState
from .llm_config import create_chat_llm

def knowledge_agent_node(state: AgentState):
    print("--- Running Knowledge Agent (Internal Brain) ---")

    # 1. 获取数据
    entities = state.get("entities", []) or []
    attributes = state.get("attributes", []) or []
    relations = state.get("relations", []) or []
    style = state.get("style", "")
    user_input = state.get("user_input", "") # 多拿一个原始输入作为备用

    # 2. 调试打印：看看 Master Agent 到底传了什么过来
    print(f"DEBUG: Master传来的 Style: '{style}' | Entities: {entities} | Relations: {relations}")

    # 3. 兜底逻辑：如果 Master 没提取出东西，就用原始 User Input
    # 这样保证 Knowledge Agent 永远有活干
    target_info = ""
    if entities or style or relations:
        parts = [f"Entities: {', '.join(entities)}", f"Style: {style}"]
        if attributes:
            parts.append(f"Attributes: {', '.join(attributes)}")
        if relations:
            # 关系单列一行，避免被当成又一组形容词
            parts.append(f"Spatial/logical relations between entities: {', '.join(relations)}")
        target_info = "\n".join(parts)
    else:
        print("⚠️ Master没提取到有效信息，使用原始输入兜底...")
        target_info = f"User Context: {user_input}"

    # 4. 调用 LLM
    llm = create_chat_llm(default_model="gpt-4o", temperature=0.5)

    system_prompt = """
    你是艺术生成系统的视觉知识专家。请根据给定上下文补充有用的视觉描述和背景信息。

    目标：增强服装、灯光、建筑、材质、时代氛围和整体画面感。
    请保持简洁，输出 3-5 句；内容可用中文说明，但涉及模型提示词的关键视觉名词建议保留英文或中英兼容表达。
    """

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "上下文信息：\n{info}\n\n请提供用于增强画面表现的视觉知识。")
    ])

    chain = prompt | llm

    result = chain.invoke({"info": target_info})

    print(f"AGENCY: Knowledge generated :{result.content} ")
    return {"knowledge_context": result.content}
