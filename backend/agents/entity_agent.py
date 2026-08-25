import json
import os
import base64
from langchain_core.messages import HumanMessage, SystemMessage
from .llm_config import create_chat_llm

class EntityAgent:
    def __init__(self):
        # 初始化 GPT-4o 视觉模型
        self.llm = create_chat_llm(
            default_model="gpt-4o",
            env_name="OPENAI_VISION_MODEL",
            temperature=0,
            model_kwargs={"response_format": {"type": "json_object"}}
        )

    def _encode_image(self, image_path):
        """将本地物理路径图片转为 Base64 供 Vision 使用"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    def detect_entities_from_vision(self, image_path, original_prompt):
        """
        核心逻辑：结合生成图和原始 Prompt，提取出适合分割的实体数组
        """
        print(f"--- Running Entity Vision Agent ---")
        
        if not os.path.exists(image_path):
            print(f"❌ EntityAgent: 找不到图片 {image_path}")
            return ["object"]

        # 1. 准备图片数据 (Base64)
        base64_image = self._encode_image(image_path)

        # 2. 构建 System Prompt
        # 强调：不要拆分附属物（如衣服），要提取独立、完整的视觉主体
        system_prompt = """
        你是具备优先级判断能力的视觉实体分析器。你的目标是在图像中识别清晰、独立、完整、适合分割的视觉主体。

        核心优先级规则（必须遵守）：
        1. 最高优先级：有生命或会运动的对象，如人、动物、鸟、鱼、昆虫等，必须优先识别。
        2. 中等优先级：突出的独立建筑/结构/物体，如房屋、桥、道路、汽车、家具等。
        3. 最低优先级（通常排除）：花、草、树、植物。除非它们是画面的绝对核心主体，否则不要列出。

        补充规则：
        1. 主体完整性：如果人物穿着裙子，实体应是 "woman" 或 "person"，不要拆成 "dress"。不要把附属配件从主体上拆开。
        2. 语义参考：可以利用 original_prompt 理解用户意图，但只能列出图像中真实可见的实体。
        3. 适合分割：返回简单、清晰的英文名词，尽量用单数，便于 SAM 等分割模型理解，例如 "man"、"dog"、"house"。
        4. 不要重复：不要返回重叠实体，如 ["man", "head", "arm"]；只返回最完整的主体，例如 ["man"]。
        5. 最小列表：只返回符合优先级规则的实体，避免琐碎背景元素。

        只返回如下 JSON，不要输出额外文字：
        {
            "entities": ["entity1", "entity2"]
        }
        """

        # 3. 构建消息
        content_blocks = [
            {"type": "text", "text": f"生成图像使用的原始 Prompt: {original_prompt}"},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{base64_image}"}
            }
        ]

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=content_blocks)
        ]

        # 4. 执行并解析
        try:
            response = self.llm.invoke(messages)
            parsed_data = json.loads(response.content)
            entities = parsed_data.get("entities", [])
            print(f"👁️ Entity Vision Agent 识别到: {entities}")
            return entities
        except Exception as e:
            print(f"❌ EntityAgent Error: {e}")
            return ["object"]
