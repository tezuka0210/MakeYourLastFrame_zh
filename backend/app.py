import os
import json
import requests
import uuid
import time
import urllib.parse
import websocket # 用于与ComfyUI进行实时通信
import shutil
import mimetypes
import re
import tempfile
import subprocess
import io
from flask import Flask, request, jsonify, send_from_directory, render_template, send_file, abort, Response
from flask_cors import CORS
from dotenv import load_dotenv
from typing import Optional
from moviepy import VideoFileClip, concatenate_videoclips,ImageClip,AudioFileClip,concatenate_audioclips
# 导入之前设计的数据库操作模块
from database import update_node, get_tree_as_json
import database
import random
import sys
import base64
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from http import HTTPStatus
# 将agents文件夹添加到Python路径（确保能导入）
sys.path.append(str(Path(__file__).parent / "agents"))
from agents.utils import get_all_workflow_names
from agents.master_agent import master_agent_node
from agents.knowledge_agent import knowledge_agent_node
from agents.workflow_agent import workflow_selector_node
from agents.prompt_agent import prompt_agent_node
from agents.final_prompt_agent import final_prompt_agent_node 
# --- 模式开关 ----
APP_MODE = os.getenv('APP_MODE', 'local')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAM_SERVER_URL = os.getenv("SAM_SERVER_URL", "").strip().rstrip("/")
print(f"--- 应用程序正在以 {APP_MODE.upper()} 模式运行 ---")

if APP_MODE != 'local':
    from agents.entity_agent import EntityAgent
    if not SAM_SERVER_URL:
        from agents.sam_agent import SAMAgent
else:
    # 本地模式定义空类，避免导入报错
    class SAMAgent:
        pass
    class EntityAgent:
        pass


# --- 1. 初始化与配置 ---

load_dotenv()
app = Flask(__name__, template_folder='templates')
CORS(app)
database.init_db()
if APP_MODE != 'local':
    sam_service = None if SAM_SERVER_URL else SAMAgent()
    entity_v_agent = EntityAgent()
else:
    sam_service = None  # 本地模式置空
    entity_v_agent = None





# --- 配置常量 ---
COMFYUI_SERVER_ADDRESS = "223.193.6.178:8188" # ComfyUI后端的地址和端口
CLIENT_ID = str(uuid.uuid4()) # 为我们的后端应用生成一个唯一的客户端ID
# UPLOAD_FOLDER = 'assets'
# os.makedirs(UPLOAD_FOLDER, exist_ok=True)
COMFYUI_SERVER_ADDRESS = os.getenv("COMFYUI_SERVER_ADDRESS", COMFYUI_SERVER_ADDRESS)

if APP_MODE == 'local':
    # 本地模式：使用 backend/local_assets 文件夹
    LOCAL_ASSETS_PATH = os.path.join(BASE_DIR, 'local_assets')
    COMFYUI_INPUT_PATH = os.path.join(LOCAL_ASSETS_PATH, 'input')
    COMFYUI_OUTPUT_PATH = os.path.join(LOCAL_ASSETS_PATH, 'output')
    print(f"本地模式：使用 '{LOCAL_ASSETS_PATH}' 作为资源根目录")
else:
    BASE_COMFYUI_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'comfyui', 'ComfyUI'))
    COMFYUI_INPUT_PATH = os.path.join(BASE_COMFYUI_PATH, 'input')
    COMFYUI_OUTPUT_PATH = os.path.join(BASE_COMFYUI_PATH, 'output')
    print(f"服务器模式：使用 '{BASE_COMFYUI_PATH}' 作为 ComfyUI 根目录")

if APP_MODE != 'local' and SAM_SERVER_URL:
    LOCAL_ASSETS_PATH = os.path.join(BASE_DIR, 'local_assets')
    COMFYUI_INPUT_PATH = os.path.join(LOCAL_ASSETS_PATH, 'input')
    COMFYUI_OUTPUT_PATH = os.path.join(LOCAL_ASSETS_PATH, 'output')

print(f"ComfyUI的输入目录被设置为: {COMFYUI_INPUT_PATH}")
print(f"ComfyUI的输出目录被设置为: {COMFYUI_OUTPUT_PATH}")
os.makedirs(COMFYUI_INPUT_PATH, exist_ok=True)
# 图片目录
IMAGE_DIR = os.path.join(COMFYUI_OUTPUT_PATH)
# 视频目录
VIDEO_DIR = os.path.join(IMAGE_DIR, "video")
STITCHED_OUTPUT_FOLDER = os.path.join(os.path.dirname(__file__), 'stitched_videos') # 存放拼接结果
os.makedirs(STITCHED_OUTPUT_FOLDER, exist_ok=True)

# --- 2. 核心辅助函数 ---

def comfyui_http_url(path: str = "") -> str:
    base = COMFYUI_SERVER_ADDRESS.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = f"http://{base}"
    return f"{base}{path}"

def comfyui_ws_url(path: str = "") -> str:
    base = COMFYUI_SERVER_ADDRESS.strip().rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    else:
        base = f"ws://{base}"
    return f"{base}{path}"

def upload_bytes_to_comfyui_input(file_bytes: bytes, filename: str, content_type: str = "application/octet-stream") -> None:
    response = requests.post(
        comfyui_http_url("/upload/image"),
        files={"image": (filename, io.BytesIO(file_bytes), content_type)},
        data={"type": "input", "overwrite": "true"},
        timeout=60
    )
    response.raise_for_status()

def fetch_comfyui_view(filename: str, subfolder: str = "", file_type: str = "output") -> requests.Response:
    return requests.get(
        comfyui_http_url("/view"),
        params={"filename": filename, "subfolder": subfolder, "type": file_type},
        stream=True,
        timeout=60
    )

def copy_comfyui_output_to_input(filename: str, subfolder: str = "") -> None:
    response = fetch_comfyui_view(filename, subfolder, "output")
    response.raise_for_status()
    upload_bytes_to_comfyui_input(
        response.content,
        filename,
        response.headers.get("Content-Type", "application/octet-stream")
    )

def ensure_local_comfyui_input_file(filename: str) -> str:
    local_path = os.path.join(COMFYUI_INPUT_PATH, filename)
    if os.path.exists(local_path):
        return local_path
    os.makedirs(COMFYUI_INPUT_PATH, exist_ok=True)
    response = fetch_comfyui_view(filename, "", "input")
    response.raise_for_status()
    with open(local_path, "wb") as f:
        f.write(response.content)
    return local_path

def ensure_local_comfyui_output_file(filename: str, subfolder: str = "", file_type: str = "output", force_refresh: bool = False) -> str:
    candidates = [
        os.path.join(COMFYUI_OUTPUT_PATH, subfolder, filename),
        os.path.join(COMFYUI_OUTPUT_PATH, filename),
        os.path.join(COMFYUI_OUTPUT_PATH, "video", filename),
        os.path.join(COMFYUI_OUTPUT_PATH, "audio", filename),
    ]
    if not force_refresh:
        for candidate in candidates:
            if os.path.exists(candidate):
                return candidate

    if APP_MODE == "local":
        raise FileNotFoundError(f"视频/图片文件未找到: {filename} (尝试路径: {candidates})")

    target_dir = os.path.join(COMFYUI_OUTPUT_PATH, subfolder or "")
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, filename)

    response = fetch_comfyui_view(filename, subfolder, file_type or "output")
    response.raise_for_status()
    with open(target_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
    return target_path

def resolve_stitch_media_path(asset_url: str) -> str:
    filename, subfolder, file_type, local_path = resolve_asset_file_path(asset_url)
    if not filename:
        raise ValueError(f"Cannot parse media filename from path: {asset_url}")

    if APP_MODE != "local" and file_type != "input":
        return ensure_local_comfyui_output_file(
            filename,
            subfolder or "",
            file_type or "output",
            force_refresh=True
        )

    if local_path and os.path.exists(local_path):
        return local_path

    if file_type == "input":
        return ensure_local_comfyui_input_file(filename)

    return ensure_local_comfyui_output_file(filename, subfolder or "", file_type or "output")

def parse_segment_subjects_from_prompt(prompt_text: str) -> list[str]:
    text = (prompt_text or "").strip()
    if not text:
        return []

    normalized = re.sub(
        r"\s+and\s+(?:her|his|their|its|the|a|an)\s+",
        ", ",
        text,
        flags=re.IGNORECASE
    )
    parts = re.split(r"[,，\n;；]+", normalized)

    subjects = []
    seen = set()
    for item in parts:
        subject = re.sub(
            r"^\s*(?:the|a|an|her|his|their|its)\s+",
            "",
            item.strip(),
            flags=re.IGNORECASE
        ).strip()
        key = subject.lower()
        if subject and key not in seen:
            subjects.append(subject)
            seen.add(key)
    return subjects

def seconds_to_video_length(seconds, fps=16) -> int:
    try:
        target_frames = max(1, int(round(float(seconds) * float(fps))))
    except (TypeError, ValueError):
        target_frames = 81

    if target_frames <= 1:
        return 1

    # Wan/Hunyuan video nodes generally expect frame counts in the 8n+1 family.
    return int(((target_frames - 1 + 7) // 8) * 8 + 1)

def append_prompt_text(base_prompt: str, extra_prompt: str) -> str:
    base = str(base_prompt or "").strip()
    extra = str(extra_prompt or "").strip()
    if not base:
        return extra
    if not extra:
        return base
    return f"{base}, {extra}"

def build_segment_background_prompt(parameters: dict, target_subjects: list[str]) -> str:
    explicit_prompt = (
        parameters.get("background_prompt")
        or parameters.get("remove_people_prompt")
        or ""
    ).strip()
    if explicit_prompt:
        return explicit_prompt

    subject_text = ", ".join(target_subjects or ["foreground subjects"])
    return (
        f"Remove {subject_text} from the image and reconstruct the original background "
        "behind them. Preserve the camera angle, lighting, composition, color tone, "
        "and scene context. Do not add new subjects."
    )

def segment_with_sam(image_path: str, text_prompt: str, output_dir: str = "entities") -> list[dict]:
    if SAM_SERVER_URL:
        with open(image_path, "rb") as image_file:
            response = requests.post(
                f"{SAM_SERVER_URL}/api/sam/segment",
                files={"image": (os.path.basename(image_path), image_file, mimetypes.guess_type(image_path)[0] or "image/png")},
                data={"prompt": text_prompt, "output_dir": output_dir},
                timeout=180
            )
        response.raise_for_status()
        return response.json().get("segments", [])
    return sam_service.segment_by_text(
        image_path=image_path,
        text_prompt=text_prompt,
        output_dir=output_dir
    )

def find_node_id_by_title(workflow: dict, target_title: str) -> Optional[str]:
    """遍历工作流JSON，根据自定义的节点标题查找节点ID。"""
    for node_id, node_info in workflow.items():
        if '_meta' in node_info and node_info['_meta'].get('title') == target_title:
            return node_id
    return None

def load_workflow(module_id: str) -> Optional[dict]:
    """根据模块ID从workflows文件夹加载对应的工作流JSON文件。"""
    workflow_path = os.path.join('workflows', f"{module_id}.json")
    if not os.path.exists(workflow_path):
        return None
    with open(workflow_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def queue_comfyui_prompt(workflow: dict) -> dict:
    """将工作流提交到ComfyUI的队列中。"""
    prompt_data = {"prompt": workflow, "client_id": CLIENT_ID}
    print(">>> 正在向ComfyUI提交工作流...")
    
    # 【关键调试代码】打印最终要发送的工作流JSON
    print("--- 最终发送给 ComfyUI 的工作流 (可复制用于调试) ---")
    print(json.dumps(workflow, indent=2, ensure_ascii=False))
    print("----------------------------------------------------")
    
    response = requests.post(comfyui_http_url("/prompt"), json=prompt_data)
    response.raise_for_status()
    print("<<< ComfyUI已接受任务。")
    return response.json()

def get_comfyui_outputs(prompt_id: str) -> dict:
    """
    通过WebSocket连接，等待ComfyUI任务执行完成，并获取输出结果。
    这是处理耗时任务的关键。
    """
    ws = websocket.WebSocket()
    ws.connect(comfyui_ws_url(f"/ws?clientId={CLIENT_ID}"))
    
    while True:
        try:
            out = ws.recv()
            if isinstance(out, str):
                message = json.loads(out)
                if message['type'] == 'executing':
                    data = message['data']
                    if data['node'] is None and data['prompt_id'] == prompt_id:
                        # 执行完成的标志
                        break 
        except websocket.WebSocketConnectionClosedException:
            print("WebSocket连接已关闭，任务可能已完成或中断。")
            break
    ws.close()

    # 从/history API获取最终的输出信息
    history_response = requests.get(comfyui_http_url(f"/history/{prompt_id}"))
    history_response.raise_for_status()
    history = history_response.json()
    # --- 【请在这里添加关键调试代码】---
    print("--- ComfyUI History Output (DEBUG) ---")
    print(json.dumps(history, indent=2, ensure_ascii=False))
    print("---------------------------------------")
    outputs = {}
    # 遍历历史记录中的输出
    for node_id, node_output in history[prompt_id]['outputs'].items():
        if 'images' in node_output:
            image_list = []
            for image in node_output['images']:
                cache_buster = int(time.time())
                # ComfyUI的/view API可以获取图片，我们需要构建完整的URL
                image_url = f"/view?filename={urllib.parse.quote_plus(image['filename'])}&subfolder={urllib.parse.quote_plus(image['subfolder'])}&type={image['type']}&_cache_buster={cache_buster}"
                image_list.append(image_url)
            outputs['images'] = image_list
        # 在这里添加对视频等其他输出类型的处理
        if 'audio' in node_output:
            audio_list = []
            for audio_file in node_output['audio']:
                cache_buster = int(time.time())
                # 构建 URL，与图片/视频相同
                audio_url = f"/view?filename={urllib.parse.quote_plus(audio_file['filename'])}&subfolder={urllib.parse.quote_plus(audio_file['subfolder'])}&type={audio_file['type']}&_cache_buster={cache_buster}"
                audio_list.append(audio_url)
            outputs['audio'] = audio_list

        if 'videos' in node_output: 
            video_list = []
            for video in node_output['videos']:
                cache_buster = int(time.time())
                # ComfyUI的/view API可以获取图片，我们需要构建完整的URL
                video_url = f"/view?filename={urllib.parse.quote_plus(video['filename'])}&subfolder={urllib.parse.quote_plus(video['subfolder'])}&type={video['type']}&_cache_buster={cache_buster}"
                video_list.append(video_url)
            outputs['videos'] = video_list

    return outputs

import urllib.parse

def get_input_image_filenames_from_db(node_id: str) -> list[str]:
    """
    从数据库加载节点数据，提取 assets.input.images 中图片的文件名（仅 filename）
    Args: node_id: 节点ID   
    Returns: list[str]: 图片文件名列表（若不存在则返回空列表）
    """
    try:
        # 1. 从数据库获取节点数据
        node_data = database.get_node(node_id)
        if not node_data:
            print(f"节点 {node_id} 不存在于数据库中")
            return []
        
        # 2. 层级解析 assets.input.images 字段
        assets = node_data.get('assets', {})
        input_assets = assets.get('input', {})
        images_urls = input_assets.get('images', [])
        
        # 3. 确保是列表类型
        if not isinstance(images_urls, list):
            print(f"节点 {node_id} 的 assets.input.images 不是列表类型")
            return []
        
        # 4. 提取每个URL中的filename参数（仅保留文件名）
        filenames = []
        for url in images_urls:
            if not isinstance(url, str):
                continue  # 跳过非字符串类型的URL
            parsed_url = urllib.parse.urlparse(url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get('filename', [None])[0]
            if filename:
                filenames.append(filename)
        
        return filenames
    
    except Exception as e:
        print(f"获取节点 {node_id} 的 input.images 文件名时出错: {str(e)}")
        return []

def get_input_image_count_from_db(node_id: str) -> int:
    """
    从数据库加载节点数据，计算 assets.input.images 中的图片数量
    Args:
        node_id: 节点ID
    Returns:
        int: 图片数量（不存在则返回0）
    """
    try:
        # 1. 从数据库加载节点数据
        node_data = database.get_node(node_id)
        if not node_data:
            print(f"节点 {node_id} 不存在于数据库中")
            return 0
        
        # 2. 解析 assets 字段（兼容可能的空值或缺失）
        assets = node_data.get('assets', {})
        input_assets = assets.get('input', {})  # 获取 input 子字段
        images_list = input_assets.get('images', [])  # 获取 images 列表
        
        # 3. 确保是列表类型，避免非列表数据导致错误
        if not isinstance(images_list, list):
            print(f"节点 {node_id} 的 assets.input.images 不是列表类型")
            return 0
        
        # 4. 返回列表长度（即图片数量）
        return len(images_list)
    
    except Exception as e:
        print(f"计算节点 {node_id} 的 input.images 数量时出错: {str(e)}")
        return 0

def make_input_asset_url(filename: str) -> str:
    return f"/view?filename={urllib.parse.quote_plus(filename)}&subfolder=&type=input"

def get_asset_bucket(filename: str, content_type: str = "") -> str:
    mime = (content_type or mimetypes.guess_type(filename or "")[0] or "").lower()
    ext = os.path.splitext(filename or "")[1].lower()
    if mime.startswith("video/") or ext in {".mp4", ".mov", ".avi", ".webm", ".mkv"}:
        return "videos"
    if mime.startswith("audio/") or ext in {".mp3", ".wav", ".flac", ".m4a", ".ogg"}:
        return "audio"
    return "images"

def resolve_asset_file_path(asset_url: str) -> tuple[str | None, str | None, str | None, str | None]:
    parsed_url = urllib.parse.urlparse(asset_url or "")
    query_params = urllib.parse.parse_qs(parsed_url.query)
    filename = query_params.get("filename", [None])[0]
    if not filename:
        return None, None, None, None

    filename = urllib.parse.unquote_plus(filename)
    subfolder = urllib.parse.unquote_plus(query_params.get("subfolder", [""])[0] or "")
    file_type = query_params.get("type", ["output"])[0] or "output"

    if file_type == "input":
        return filename, subfolder, file_type, os.path.join(COMFYUI_INPUT_PATH, filename)

    candidates = [
        os.path.join(COMFYUI_OUTPUT_PATH, subfolder, filename),
        os.path.join(COMFYUI_OUTPUT_PATH, filename),
        os.path.join(COMFYUI_OUTPUT_PATH, "video", filename),
        os.path.join(COMFYUI_OUTPUT_PATH, "audio", filename),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return filename, subfolder, file_type, candidate

    return filename, subfolder, file_type, candidates[0]

def ensure_asset_in_comfyui_input(asset_url: str) -> str:
    filename, subfolder, file_type, source_path = resolve_asset_file_path(asset_url)
    if not filename:
        return asset_url

    target_path = os.path.join(COMFYUI_INPUT_PATH, filename)
    os.makedirs(COMFYUI_INPUT_PATH, exist_ok=True)

    if file_type == "input":
        if APP_MODE != 'local':
            return make_input_asset_url(filename)
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Input asset not found: {target_path}")
        return make_input_asset_url(filename)

    if APP_MODE != 'local':
        copy_comfyui_output_to_input(filename, subfolder)
        return make_input_asset_url(filename)

    if not source_path or not os.path.exists(source_path):
        raise FileNotFoundError(f"Source asset not found for input copy: {asset_url}")

    if os.path.abspath(source_path) != os.path.abspath(target_path):
        shutil.copy2(source_path, target_path)
        print(f"Copied asset into ComfyUI input: {source_path} -> {target_path}")

    return make_input_asset_url(filename)

def normalize_input_assets_for_comfyui(input_assets: dict | None) -> dict:
    if not isinstance(input_assets, dict):
        return {}

    normalized = {}
    for media_key in ("images", "videos", "audio"):
        urls = input_assets.get(media_key, [])
        if not isinstance(urls, list):
            urls = []
        normalized[media_key] = [
            ensure_asset_in_comfyui_input(url)
            for url in urls
            if isinstance(url, str) and url.strip()
        ]

    return normalized

def sync_request_input_assets(node_id: str, input_assets: dict | None) -> dict:
    target_node = database.get_node(node_id)
    if (not isinstance(input_assets, dict) or not any(input_assets.get(key) for key in ("images", "videos", "audio"))) and target_node:
        input_assets = (target_node.get("assets", {}) or {}).get("input", {})

    normalized_input = normalize_input_assets_for_comfyui(input_assets)
    if not any(normalized_input.values()):
        return normalized_input

    if not target_node:
        return normalized_input

    updated_assets = target_node.get("assets", {}) or {}
    updated_assets["input"] = normalized_input
    database.update_node(
        node_id=node_id,
        payload={
            "assets": updated_assets,
            "parameters": target_node.get("parameters", {})
        }
    )
    return normalized_input

def encode_image_to_base64(path):
    mime, _ = mimetypes.guess_type(path)
    if not mime:
        mime = "image/png"

    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    return f"data:{mime};base64,{encoded}"

def resolve_chat_completions_url(base_url: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    if not url:
        return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    if url.endswith("/chat/completions"):
        return url
    return f"{url}/chat/completions"

SPEECH_POLISH_MODEL = os.getenv("SPEECH_POLISH_MODEL") or os.getenv("OPENAI_MODEL", "qwen-plus")
SPEECH_POLISH_BASE_URL = resolve_chat_completions_url(
    os.getenv("SPEECH_POLISH_BASE_URL") or os.getenv("OPENAI_BASE_URL")
)
SPEECH_POLISH_MAX_CHARS = 800
# DMXAPI's gpt-4o-transcribe endpoint is OpenAI compatible at the request level,
# but it expects the API key directly in the Authorization header (no "Bearer").
# Keep these configurable so another OpenAI-compatible speech provider can still
# be used without changing application code.
SPEECH_TRANSCRIBE_MODEL = os.getenv("SPEECH_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
SPEECH_TRANSCRIBE_BASE_URL = os.getenv(
    "SPEECH_TRANSCRIBE_BASE_URL",
    "https://www.dmxapi.cn/v1/audio/transcriptions"
)
SPEECH_TRANSCRIBE_AUTH_SCHEME = os.getenv("SPEECH_TRANSCRIBE_AUTH_SCHEME", "raw").strip().lower()
SPEECH_TRANSCRIBE_TIMEOUT_SECONDS = float(os.getenv("SPEECH_TRANSCRIBE_TIMEOUT_SECONDS", "25"))
SPEECH_TRANSCRIBE_FALLBACK_ENABLED = os.getenv(
    "SPEECH_TRANSCRIBE_FALLBACK_ENABLED", "true"
).strip().lower() == "true"
SPEECH_TRANSCRIBE_USE_FALLBACK_AS_PRIMARY = os.getenv(
    "SPEECH_TRANSCRIBE_USE_FALLBACK_AS_PRIMARY", "true"
).strip().lower() == "true"
SPEECH_TRANSCRIBE_FALLBACK_MODEL = os.getenv(
    "SPEECH_TRANSCRIBE_FALLBACK_MODEL", "qwen3-omni-flash-all"
)
SPEECH_TRANSCRIBE_FALLBACK_BASE_URL = os.getenv(
    "SPEECH_TRANSCRIBE_FALLBACK_BASE_URL",
    "https://www.dmxapi.cn/v1/responses"
)
SPEECH_TRANSCRIBE_FALLBACK_TIMEOUT_SECONDS = float(
    os.getenv("SPEECH_TRANSCRIBE_FALLBACK_TIMEOUT_SECONDS", "45")
)
SPEECH_TRANSCRIBE_CONVERT_WEBM_TO_WAV = os.getenv(
    "SPEECH_TRANSCRIBE_CONVERT_WEBM_TO_WAV", "true"
).strip().lower() == "true"
SPEECH_TRANSCRIBE_FFMPEG_BIN = os.getenv("SPEECH_TRANSCRIBE_FFMPEG_BIN", "ffmpeg")
SPEECH_TRANSCRIBE_FFMPEG_TIMEOUT_SECONDS = float(
    os.getenv("SPEECH_TRANSCRIBE_FFMPEG_TIMEOUT_SECONDS", "30")
)
SPEECH_TRANSCRIBE_DEFAULT_LANGUAGE = os.getenv(
    "SPEECH_TRANSCRIBE_DEFAULT_LANGUAGE", "auto"
).strip().lower()
LOCAL_WHISPER_MODEL = os.getenv("LOCAL_WHISPER_MODEL", "base")
LOCAL_WHISPER_DEVICE = os.getenv("LOCAL_WHISPER_DEVICE", "cpu")
LOCAL_WHISPER_COMPUTE_TYPE = os.getenv("LOCAL_WHISPER_COMPUTE_TYPE", "int8")
LOCAL_WHISPER_INITIAL_PROMPT = os.getenv("LOCAL_WHISPER_INITIAL_PROMPT", "以下是普通话语音转写，请输出简体中文。")
LOCAL_WHISPER_TO_SIMPLIFIED = os.getenv("LOCAL_WHISPER_TO_SIMPLIFIED", "true").strip().lower() == "true"
SPEECH_GLOSSARY_PATH = os.getenv(
    "SPEECH_GLOSSARY_PATH",
    os.path.join(BASE_DIR, "speech_glossary.json")
)
SPEECH_GLOSSARY_MAX_PROMPT_TERMS = int(os.getenv("SPEECH_GLOSSARY_MAX_PROMPT_TERMS", "80"))
SPEECH_GLOSSARY_MAX_PROMPT_CHARS = int(os.getenv("SPEECH_GLOSSARY_MAX_PROMPT_CHARS", "1600"))
_local_whisper_model = None
_opencc_converter = None

def resolve_transcriptions_url(base_url: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    if not url:
        return "https://api.openai.com/v1/audio/transcriptions"
    if url.endswith("/audio/transcriptions"):
        return url
    if url.endswith("/v1"):
        return f"{url}/audio/transcriptions"
    return f"{url}/v1/audio/transcriptions"

def normalize_transcription_language(language: str) -> str:
    lang = (language or "").strip().lower()
    if lang in ("auto", "auto-detect", "detect"):
        lang = SPEECH_TRANSCRIBE_DEFAULT_LANGUAGE
    if not lang:
        lang = SPEECH_TRANSCRIBE_DEFAULT_LANGUAGE
    lang = (lang or "").strip().lower()
    if lang in ("auto", "auto-detect", "detect"):
        return ""
    if not lang:
        return ""
    return lang.split("-", 1)[0].lower()

def build_transcription_auth_header(api_key: str) -> str:
    key = (api_key or "").strip()
    if not key:
        return ""
    if key.lower().startswith("bearer "):
        return key
    transcribe_base_url = (SPEECH_TRANSCRIBE_BASE_URL or "").lower()
    if SPEECH_TRANSCRIBE_AUTH_SCHEME in ("raw", "token", "none") or "dmxapi" in transcribe_base_url:
        return key
    return f"Bearer {key}"

def get_local_whisper_model():
    global _local_whisper_model
    if _local_whisper_model is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "Local Whisper is not installed. Run: pip install faster-whisper"
            ) from exc

        _local_whisper_model = WhisperModel(
            LOCAL_WHISPER_MODEL,
            device=LOCAL_WHISPER_DEVICE,
            compute_type=LOCAL_WHISPER_COMPUTE_TYPE
        )
    return _local_whisper_model

def convert_to_simplified_chinese(text: str) -> str:
    if not LOCAL_WHISPER_TO_SIMPLIFIED or not text:
        return text

    global _opencc_converter
    try:
        if _opencc_converter is None:
            from opencc import OpenCC
            _opencc_converter = OpenCC("t2s")
        return _opencc_converter.convert(text)
    except ImportError:
        print("opencc is not installed; skipping traditional-to-simplified conversion.")
        return text

def clean_speech_glossary_text(value) -> str:
    """Convert a glossary field to a safe, compact text value."""
    return re.sub(r"\s+", " ", str(value or "").strip())


def normalize_speech_hotword(item, index: int) -> dict | None:
    """Accept both legacy strings and the richer hotword-object schema."""
    if isinstance(item, str):
        canonical = clean_speech_glossary_text(item)
        aliases = []
        category = ""
        note = ""
        priority = 0
    elif isinstance(item, dict):
        canonical = clean_speech_glossary_text(
            item.get("term") or item.get("canonical") or item.get("text")
        )
        raw_aliases = item.get("aliases", [])
        if isinstance(raw_aliases, str):
            raw_aliases = [raw_aliases]
        if not isinstance(raw_aliases, list):
            raw_aliases = []
        aliases = [clean_speech_glossary_text(alias) for alias in raw_aliases]
        category = clean_speech_glossary_text(item.get("category"))
        note = clean_speech_glossary_text(item.get("note") or item.get("context"))
        try:
            priority = int(item.get("priority", 0))
        except (TypeError, ValueError):
            priority = 0
    else:
        return None

    if not canonical:
        return None

    # Keep aliases unique. An alias matching the canonical spelling is useful for
    # case normalization in English, so it is deliberately not discarded here.
    clean_aliases = []
    seen_aliases = set()
    for alias in aliases:
        if alias and alias.casefold() not in seen_aliases:
            clean_aliases.append(alias)
            seen_aliases.add(alias.casefold())

    return {
        "term": canonical,
        "aliases": clean_aliases,
        "category": category,
        "note": note,
        "priority": priority,
        "index": index,
    }


def load_speech_glossary() -> dict:
    if not SPEECH_GLOSSARY_PATH or not os.path.exists(SPEECH_GLOSSARY_PATH):
        return {"hotwords": [], "terms": [], "corrections": {}}

    try:
        with open(SPEECH_GLOSSARY_PATH, "r", encoding="utf-8") as f:
            glossary = json.load(f)
    except Exception as exc:
        print(f"Failed to load speech glossary: {exc}")
        return {"hotwords": [], "terms": [], "corrections": {}}

    terms = glossary.get("terms", [])
    hotwords = glossary.get("hotwords", [])
    corrections = glossary.get("corrections", {})
    if not isinstance(terms, list):
        terms = []
    if not isinstance(hotwords, list):
        hotwords = []
    if not isinstance(corrections, dict):
        corrections = {}

    # `terms` is kept for backward compatibility. New entries should use
    # `hotwords`, which additionally supports aliases, category and priority.
    parsed_hotwords = []
    seen_terms = set()
    for index, item in enumerate([*hotwords, *terms]):
        hotword = normalize_speech_hotword(item, index)
        if not hotword:
            continue
        term_key = hotword["term"].casefold()
        if term_key in seen_terms:
            continue
        seen_terms.add(term_key)
        parsed_hotwords.append(hotword)

    parsed_hotwords.sort(key=lambda item: (-item["priority"], item["index"]))
    clean_corrections = {
        clean_speech_glossary_text(wrong): clean_speech_glossary_text(correct)
        for wrong, correct in corrections.items()
        if clean_speech_glossary_text(wrong) and clean_speech_glossary_text(correct)
    }
    return {
        "hotwords": parsed_hotwords,
        "terms": [item["term"] for item in parsed_hotwords],
        "corrections": clean_corrections,
    }


def build_glossary_replacements(glossary: dict) -> dict:
    """Create deterministic post-recognition corrections from the hotword list."""
    replacements = {}
    for hotword in glossary["hotwords"]:
        term = hotword["term"]
        # Canonical English words are also normalized to the configured casing.
        replacements[term] = term
        spaced_term = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", term)
        spaced_term = re.sub(r"([A-Z])([A-Z][a-z])", r"\1 \2", spaced_term)
        if spaced_term != term and re.search(r"[A-Za-z]", term):
            # Most speech models insert a space in CamelCase names (Control Net,
            # Open AI, Comfy UI). Generate that safe variant automatically so
            # users do not have to add it to every hotword by hand.
            replacements[spaced_term] = term
        for alias in hotword["aliases"]:
            replacements[alias] = term

    # Explicit corrections override automatic alias mappings.
    replacements.update(glossary["corrections"])
    return replacements


def replace_glossary_phrase(text: str, source: str, target: str) -> str:
    """Replace Chinese phrases directly and English phrases with word boundaries.

    Word boundaries avoid turning an unrelated word such as `workflowing` into a
    hotword merely because it contains `workflow`. Matching English
    case-insensitively also restores configured capitalization (for example,
    `open ai` -> `OpenAI`).
    """
    if not source or source == target and not re.search(r"[A-Za-z]", source):
        return text

    if re.search(r"[A-Za-z0-9]", source):
        pattern = rf"(?<![A-Za-z0-9]){re.escape(source)}(?![A-Za-z0-9])"
        return re.sub(pattern, target, text, flags=re.IGNORECASE)
    return text.replace(source, target)


def build_speech_transcribe_prompt(language: str = "") -> str:
    """Build a constrained prompt so online audio models use domain hotwords."""
    if language == "zh":
        base_prompt = """
请将音频中的人声逐字转写为简体中文。
只输出转写出的文字，不要描述音频、不要总结、不要添加标题或解释。
保留说话者实际使用的中文、英文、数字、字母和标点；英文术语不要翻译。
若没有清晰可辨的人声，则只输出空字符串。
""".strip()
        hotword_instruction = (
            "以下是本领域热词。若音频中确实说到其标准词、别名或明显同音表达，"
            "请输出标准词的准确写法和大小写；没有足够语音依据时不要臆造热词："
        )
    elif language == "en":
        base_prompt = """
Transcribe the spoken English audio verbatim into English text.
Output only the transcript. Do not translate, summarize, describe the audio, or add a title.
Preserve words, numbers, punctuation, and the exact casing of domain terms when clear.
If there is no intelligible speech, output an empty string.
""".strip()
        hotword_instruction = (
            "These are domain hotwords. Use their canonical spelling and casing only when "
            "the audio clearly contains the term, an alias, or an obvious homophone; do not invent hotwords:"
        )
    else:
        base_prompt = """
Transcribe the spoken audio verbatim in its original language.
Detect the spoken language automatically. For English speech, output English; for Chinese speech,
output Simplified Chinese. Do not translate, summarize, describe the audio, or add a title.
Preserve words, numbers, punctuation, and the exact casing of domain terms when clear.
If there is no intelligible speech, output an empty string.
""".strip()
        hotword_instruction = (
            "These are domain hotwords. Use their canonical spelling and casing only when "
            "the audio clearly contains the term, an alias, or an obvious homophone; do not invent hotwords:"
        )

    glossary = load_speech_glossary()
    rendered_items = []
    current_length = len(base_prompt)

    for hotword in glossary["hotwords"][:SPEECH_GLOSSARY_MAX_PROMPT_TERMS]:
        item = hotword["term"]
        if hotword["aliases"]:
            item += f"（可能被识别为：{'、'.join(hotword['aliases'][:5])}）"
        if hotword["category"]:
            item += f"［{hotword['category']}］"
        if hotword["note"]:
            item += f"：{hotword['note']}"
        line = f"- {item}"
        if current_length + len(line) + 1 > SPEECH_GLOSSARY_MAX_PROMPT_CHARS:
            break
        rendered_items.append(line)
        current_length += len(line) + 1

    if not rendered_items:
        return base_prompt

    return (
        f"{base_prompt}\n\n"
        f"{hotword_instruction}\n"
        + "\n".join(rendered_items)
    )

def build_local_whisper_prompt() -> str:
    glossary = load_speech_glossary()
    terms = glossary["terms"][:SPEECH_GLOSSARY_MAX_PROMPT_TERMS]
    if not terms:
        return LOCAL_WHISPER_INITIAL_PROMPT

    terms_text = "、".join(terms)
    return f"{LOCAL_WHISPER_INITIAL_PROMPT}\n可能出现的专有名词包括：{terms_text}。"

def apply_speech_glossary(text: str) -> str:
    if not text:
        return text

    replacements = build_glossary_replacements(load_speech_glossary())
    corrected = text
    for wrong, correct in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
        corrected = replace_glossary_phrase(corrected, wrong, correct)
    return corrected

def ms_between(start: float, end: float) -> float:
    return round((end - start) * 1000, 2)

def transcribe_with_local_whisper(audio_file, language: str, request_received_at: float | None = None) -> tuple[str, dict]:
    request_start = request_received_at or time.perf_counter()
    suffix = Path(audio_file.filename or "speech.webm").suffix or ".webm"
    temp_path = None
    audio_processing_start = time.perf_counter()

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_audio:
            audio_file.save(temp_audio)
            temp_path = temp_audio.name
        audio_processing_end = time.perf_counter()

        # Keep model loading outside per-request inference timing.
        model_load_start = time.perf_counter()
        model = get_local_whisper_model()
        model_load_end = time.perf_counter()
        whisper_start = time.perf_counter()
        segments, _ = model.transcribe(
            temp_path,
            language=language or None,
            task="transcribe",
            initial_prompt=build_local_whisper_prompt(),
            vad_filter=True
        )
        segment_texts = [segment.text for segment in segments]
        whisper_end = time.perf_counter()

        result_processing_start = time.perf_counter()
        text = "".join(segment_texts).strip()
        text = convert_to_simplified_chinese(text)
        text = apply_speech_glossary(text)
        result_processing_end = time.perf_counter()
        response_ready_at = time.perf_counter()

        timing = {
            "audioDurationMs": None,
            "audioProcessingTimeMs": ms_between(audio_processing_start, audio_processing_end),
            "modelLoadTimeMs": ms_between(model_load_start, model_load_end),
            "whisperInferenceTimeMs": ms_between(whisper_start, whisper_end),
            "resultProcessingTimeMs": ms_between(result_processing_start, result_processing_end),
            "backendTotalTimeMs": ms_between(request_start, response_ready_at)
        }
        return text, timing
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

def prepare_speech_audio_upload(audio_file) -> tuple[object, str, str, list[str]]:
    """Return an upload stream, converting browser WebM to a compatible WAV when needed."""
    filename = Path(audio_file.filename or "speech.webm").name
    content_type = audio_file.mimetype or "audio/webm"
    is_webm = filename.lower().endswith(".webm") or "webm" in content_type.lower()

    if not SPEECH_TRANSCRIBE_CONVERT_WEBM_TO_WAV or not is_webm:
        audio_file.stream.seek(0)
        return audio_file.stream, filename, content_type, []

    source_path = None
    wav_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as source_file:
            audio_file.stream.seek(0)
            audio_file.save(source_file)
            source_path = source_file.name

        wav_path = f"{source_path}.wav"
        completed = subprocess.run(
            [
                SPEECH_TRANSCRIBE_FFMPEG_BIN,
                "-nostdin", "-v", "error", "-y",
                "-i", source_path,
                "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                wav_path,
            ],
            capture_output=True,
            text=True,
            timeout=SPEECH_TRANSCRIBE_FFMPEG_TIMEOUT_SECONDS,
            check=False,
        )
        if completed.returncode != 0 or not os.path.exists(wav_path):
            error_detail = (completed.stderr or "Unknown FFmpeg error").strip()[-1000:]
            raise RuntimeError(f"Could not convert browser audio to WAV: {error_detail}")

        return open(wav_path, "rb"), "speech.wav", "audio/wav", [source_path, wav_path]
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        for path in (source_path, wav_path):
            if path and os.path.exists(path):
                os.remove(path)
        raise RuntimeError("FFmpeg is required to convert browser WebM audio before transcription") from exc
    except Exception:
        for path in (source_path, wav_path):
            if path and os.path.exists(path):
                os.remove(path)
        raise


def audio_format_from_filename(filename: str, content_type: str) -> str:
    suffix = Path(filename).suffix.lstrip(".").lower()
    if suffix:
        return suffix
    if "/" in content_type:
        return content_type.split("/", 1)[1].split(";", 1)[0].lower()
    return "wav"


def transcribe_with_omni_fallback(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    api_key: str,
    request_start: float,
    primary_error: str,
) -> tuple[str, dict]:
    """Use the verified Qwen Omni audio-input model when the primary STT line is unavailable."""
    encoded_audio = base64.b64encode(audio_bytes).decode("ascii")
    fallback_start = time.perf_counter()
    try:
        response = requests.post(
            SPEECH_TRANSCRIBE_FALLBACK_BASE_URL,
            headers={
                "Authorization": build_transcription_auth_header(api_key),
                "Content-Type": "application/json",
            },
            json={
                "model": SPEECH_TRANSCRIBE_FALLBACK_MODEL,
                "input": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": f"data:;base64,{encoded_audio}",
                                "format": audio_format_from_filename(filename, content_type),
                            },
                        },
                        {"type": "text", "text": build_speech_transcribe_prompt(language)},
                    ],
                }],
                "stream": True,
                "modalities": ["text"],
            },
            stream=True,
            timeout=SPEECH_TRANSCRIBE_FALLBACK_TIMEOUT_SECONDS,
        )
        if response.status_code != HTTPStatus.OK:
            error_detail = response.text.strip().replace("\n", " ")[:1000]
            raise RuntimeError(
                f"Speech provider error ({primary_error}); fallback error: {response.status_code} {error_detail}"
            )

        text_chunks = []
        completed_text = ""
        for raw_line in response.iter_lines():
            if not raw_line:
                continue
            if isinstance(raw_line, bytes):
                raw_line = raw_line.decode("utf-8", errors="replace")
            if not raw_line.startswith("data: "):
                continue
            try:
                event = json.loads(raw_line[6:])
            except json.JSONDecodeError:
                continue
            event_type = event.get("type", "")
            if event_type == "response.output_text.delta":
                text_chunks.append(str(event.get("delta", "")))
            elif event_type == "response.output_text.done":
                completed_text = str(event.get("text", ""))
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Speech provider did not respond ({primary_error}); fallback request failed: {exc}"
        ) from exc

    fallback_end = time.perf_counter()
    text = "".join(text_chunks).strip() or completed_text.strip()

    response_ready_at = time.perf_counter()
    return apply_speech_glossary(text), {
        "audioDurationMs": None,
        "audioProcessingTimeMs": None,
        "modelLoadTimeMs": None,
        "whisperInferenceTimeMs": ms_between(fallback_start, fallback_end),
        "resultProcessingTimeMs": None,
        "backendTotalTimeMs": ms_between(request_start, response_ready_at),
        "model": SPEECH_TRANSCRIBE_FALLBACK_MODEL,
        "fallbackUsed": True,
        "primaryError": primary_error,
    }


def transcribe_with_speech_api(audio_file, language: str, request_received_at: float | None = None) -> tuple[str, dict]:
    request_start = request_received_at or time.perf_counter()
    api_key = os.getenv("SPEECH_TRANSCRIBE_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("SPEECH_TRANSCRIBE_API_KEY or OPENAI_API_KEY is not configured")

    audio_processing_start = time.perf_counter()
    # Keep the multipart form exactly aligned with DMXAPI's documented request:
    # the required fields are only `model` and `file`.
    payload = {"model": SPEECH_TRANSCRIBE_MODEL}
    upload_stream, filename, content_type, cleanup_paths = prepare_speech_audio_upload(audio_file)
    try:
        audio_bytes = upload_stream.read()
    finally:
        if upload_stream is not audio_file.stream:
            upload_stream.close()
        for path in cleanup_paths:
            if os.path.exists(path):
                os.remove(path)
    if not audio_bytes:
        raise RuntimeError("Recorded audio is empty")
    audio_processing_end = time.perf_counter()

    if SPEECH_TRANSCRIBE_USE_FALLBACK_AS_PRIMARY:
        return transcribe_with_omni_fallback(
            audio_bytes,
            filename,
            content_type,
            api_key,
            request_start,
            "Primary STT line bypassed by configuration",
        )

    try:
        whisper_start = time.perf_counter()
        response = requests.post(
            resolve_transcriptions_url(SPEECH_TRANSCRIBE_BASE_URL),
            headers={"Authorization": build_transcription_auth_header(api_key)},
            data=payload,
            files={"file": (filename, io.BytesIO(audio_bytes), content_type)},
            timeout=SPEECH_TRANSCRIBE_TIMEOUT_SECONDS,
        )
        whisper_end = time.perf_counter()
    except requests.RequestException as exc:
        if SPEECH_TRANSCRIBE_FALLBACK_ENABLED:
            return transcribe_with_omni_fallback(
                audio_bytes, filename, content_type, api_key, request_start, str(exc)
            )
        raise RuntimeError(f"Speech provider request failed: {exc}") from exc

    if response.status_code != HTTPStatus.OK:
        error_detail = response.text.strip().replace("\n", " ")[:1000]
        if SPEECH_TRANSCRIBE_FALLBACK_ENABLED and response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR:
            return transcribe_with_omni_fallback(
                audio_bytes,
                filename,
                content_type,
                api_key,
                request_start,
                f"{response.status_code} {error_detail}",
            )
        raise RuntimeError(f"Speech provider error: {response.status_code} {error_detail}")

    try:
        result = response.json()
    except ValueError as exc:
        raise RuntimeError("Speech provider returned a non-JSON response") from exc

    result_processing_start = time.perf_counter()
    text = apply_speech_glossary(str(result.get("text") or "").strip())
    result_processing_end = time.perf_counter()
    response_ready_at = time.perf_counter()

    timing = {
        "audioDurationMs": None,
        "audioProcessingTimeMs": ms_between(audio_processing_start, audio_processing_end),
        "modelLoadTimeMs": None,
        "whisperInferenceTimeMs": ms_between(whisper_start, whisper_end),
        "resultProcessingTimeMs": ms_between(result_processing_start, result_processing_end),
        "backendTotalTimeMs": ms_between(request_start, response_ready_at),
        "model": SPEECH_TRANSCRIBE_MODEL,
        "fallbackUsed": False,
    }
    return text, timing

SPEECH_POLISH_SYSTEM_PROMPT = """
你是语音输入文本整理器。只修正明显识别错误、补充标点、删除重复口癖，让文本更通顺。
必须保留原意，不添加新角色、新物体、新风格，不扩写成正式生成提示词，不翻译。
只输出整理后的文本，不要解释。
""".strip()

def polish_speech_text_with_qwen(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        return ""
    if len(text) > SPEECH_POLISH_MAX_CHARS:
        text = text[:SPEECH_POLISH_MAX_CHARS]

    api_key = os.getenv("SPEECH_POLISH_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("SPEECH_POLISH_API_KEY or OPENAI_API_KEY is not configured")

    response = requests.post(
        SPEECH_POLISH_BASE_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        json={
            "model": SPEECH_POLISH_MODEL,
            "messages": [
                {"role": "system", "content": SPEECH_POLISH_SYSTEM_PROMPT},
                {"role": "user", "content": text}
            ],
            "temperature": 0.2
        },
        timeout=20
    )

    if response.status_code != HTTPStatus.OK:
        raise RuntimeError(f"DashScope error: {response.status_code} {response.text}")

    result = response.json()
    polished = result["choices"][0]["message"]["content"].strip()
    return polished or text


# --- 3. Flask API 路由定义 ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/speech/transcribe', methods=['POST'])
def transcribe_speech_audio():
    request_received_at = time.perf_counter()
    audio_file = request.files.get('audio')
    if not audio_file:
        return jsonify({"error": "Missing audio file"}), 400

    language = normalize_transcription_language(request.form.get('language', ''))

    try:
        text, timing = transcribe_with_speech_api(audio_file, language, request_received_at)
        return jsonify({
            "text": text,
            "model": timing.get("model", SPEECH_TRANSCRIBE_MODEL),
            "provider": "api",
            "timing": timing
        }), 200
    except Exception as e:
        print(f"Speech transcription failed: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/speech/polish', methods=['POST'])
def polish_speech_text():
    data = request.get_json(silent=True) or {}
    raw_text = (data.get('text') or '').strip()

    if not raw_text:
        return jsonify({"raw_text": "", "polished_text": ""}), 200

    try:
        polished_text = polish_speech_text_with_qwen(raw_text)
        return jsonify({
            "raw_text": raw_text,
            "polished_text": polished_text,
            "model": SPEECH_POLISH_MODEL
        }), 200
    except Exception as e:
        print(f"Speech polish failed: {e}")
        return jsonify({
            "raw_text": raw_text,
            "polished_text": raw_text,
            "error": str(e)
        }), 200

@app.route("/view", methods=["GET"])
def view_file():
    filename = request.args.get("filename")
    subfolder = request.args.get("subfolder", "")
    file_type = request.args.get("type", "output") # (v89 修复) 1. 读取 'type' 参数

    if not filename:
        return abort(400, "缺少 filename 参数")

    # (v89 修复) 2. 根据 'type' 决定搜索路径
    if APP_MODE != 'local':
        try:
            remote_headers = {}
            if request.headers.get("Range"):
                remote_headers["Range"] = request.headers["Range"]
            remote_response = requests.get(
                comfyui_http_url("/view"),
                params={"filename": filename, "subfolder": subfolder, "type": file_type},
                headers=remote_headers,
                stream=True,
                timeout=60
            )
            if remote_response.status_code in (200, 206):
                headers = {"X-Content-Type-Options": "nosniff"}
                for header in ("Content-Range", "Accept-Ranges", "Content-Length"):
                    if remote_response.headers.get(header):
                        headers[header] = remote_response.headers[header]
                return Response(
                    remote_response.iter_content(chunk_size=1024 * 64),
                    status=remote_response.status_code,
                    headers=headers,
                    mimetype=remote_response.headers.get("Content-Type", "application/octet-stream")
                )
        except Exception as exc:
            print(f"Remote ComfyUI view failed, falling back to local file: {exc}")

    if file_type == "input":
        # 如果是 'input' 类型, 只在 input 目录查找
        file_path = os.path.join(COMFYUI_INPUT_PATH, filename)
    else:
        # 否则 (output, temp, etc.)，在 output/ 或 output/video/ 查找
        base_output_path = os.path.join(COMFYUI_OUTPUT_PATH, subfolder)
        file_path = os.path.join(base_output_path, filename)
        # (v89 修复) 增加对 output/video 的兼容
        if not os.path.exists(file_path) and subfolder != "video":
             video_path_alt = os.path.join(COMFYUI_OUTPUT_PATH, "video", filename)
             if os.path.exists(video_path_alt):
                 file_path = video_path_alt

    if not os.path.exists(file_path):
        return abort(404, f"文件 {filename} (类型: {file_type}) 在路径 {file_path} 中不存在")

    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type is None:
        mime_type = "application/octet-stream"

    # --- (v89 核心修复) 视频流逻辑 ---
    if mime_type.startswith("video/") or mime_type.startswith("audio/"):
        try:
            file_size = os.path.getsize(file_path)
            range_header = request.headers.get("Range", None)

            start = 0
            end = file_size - 1
            length = file_size
            status_code = 200 # (v89 修复) 默认 200

            if range_header:
                # (v89 修复) Case 1: 浏览器请求 'Range' (206)
                status_code = 206
                start_str, end_str = range_header.replace("bytes=", "").split("-")
                start = int(start_str)
                end = int(end_str) if end_str else file_size - 1
                length = end - start + 1
            else:
                # (v89 修复) Case 2: 浏览器 没有 请求 'Range' (200)
                # 我们 必须 强制发送 206，并假装它请求了 'bytes=0-'
                # 这样 Chrome 才能在 foreignObject 中播放
                status_code = 206
                # (start=0, end=file_size-1, length=file_size 保持不变)
            with open(file_path, "rb") as f:
                f.seek(start)
                data = f.read(length)

            rv = Response(data, status_code, mimetype=mime_type)
            rv.headers.add("Content-Range", f"bytes {start}-{end}/{file_size}")
            rv.headers.add("Accept-Ranges", "bytes")
            # (v84 修复) Content-Length 由 Flask/Response 自动添加
            rv.headers.add("X-Content-Type-Options", "nosniff")
            return rv

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # --- 图片或其他文件 (保持不变) ---
    rv = send_file(file_path, mimetype=mime_type)
    rv.headers.add("X-Content-Type-Options", "nosniff")
    return rv

# 和agents通信
@app.route('/api/agents/process', methods=['POST'])
def process_agent_request():
    try:
        # 1. 获取前端传递的参数
        data = request.get_json()
        user_input = data.get('user_input', '')
        node_id = data.get('node_id', '')
        image_url = data.get('image_url', '')
        workflow_context = data.get('workflow_context', {})
        global_context = database.find_global_context(node_id)
        print("global_context",global_context)

        # 处理 image_url 可能是数组、无效类型的情况
        if isinstance(image_url, list) and len(image_url) > 0:
            image_url = image_url[0]  # 取第一个 URL
        elif not isinstance(image_url, str):
            image_url = ''  # 无效类型时设为空字符串
        
        # 初始化 Base64 编码结果（默认 None，表示无图片）
        image_base64 = None
        # 定义源目录和目标目录
        source_dir = "local_assets/input"  # 查找文件的源目录
        target_dir = "/home/zhengzy/comfyui/ComfyUI/input"  # 复制目标目录

        # 确保目标目录存在
        os.makedirs(target_dir, exist_ok=True)

        if image_url:  # 只有当 image_url 非空时，才解析 filename
            parsed_url = urllib.parse.urlparse(image_url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get('filename', [None])[0]  # 提取 filename 参数

            # 关键判断：filename 必须非空、非 None，且是字符串
            if filename and isinstance(filename, str):
                source_path = os.path.join(source_dir, filename)  # 源文件路径
                target_path = os.path.join(target_dir, filename)  # 目标文件路径

                # 第一步：判断源文件是否存在，存在则复制
                if os.path.exists(source_path):
                    try:
                        # 复制文件到目标目录
                        shutil.copy2(source_path, target_path)
                        print(f"文件复制成功：{source_path} -> {target_path}")
                    except Exception as e:
                        print(f"文件复制失败：{str(e)}")

                # 第二步：判断目标目录文件是否存在，执行原有逻辑
                if os.path.exists(target_path):
                    image_base64 = encode_image_to_base64(target_path)
                else:
                    print(f"警告：图片文件不存在 -> {target_path}")
            else:
                print("警告：未从 image_url 中提取到有效的 filename")
        else:
            print("提示：未传入 image_url，跳过图片处理")
        # 2. 准备agent所需的状态
        mock_state = {
            "global_context":global_context,
            "user_input": user_input,
            "intent": user_input,
            "image_data": image_base64,  # 传给master_agent的图片数据（URL格式）
            "workflow_list": get_all_workflow_names(),
            "parent_workflow": workflow_context.get('current_workflow'),
            "selected_workflow": None
        }

        # --- 2. Run Master Agent ---
        state_after_master = master_agent_node(mock_state)
        # Merge state
        current_state = {**mock_state, **state_after_master}

        # --- 3. Run Knowledge Agent (Parallel with Master usually, but here serial) ---
        state_after_knowledge = knowledge_agent_node(current_state)
        current_state.update(state_after_knowledge)

        # --- 4. Run Workflow Agent (User clicks + button) ---
        state_after_workflow = workflow_selector_node(current_state)
        current_state.update(state_after_workflow)

        # --- 5. Run Prompt Agent ---
        state_after_prompt = prompt_agent_node(current_state)
        current_state.update(state_after_prompt)

        print(current_state.get('final_prompt'))
        # 4. 返回处理结果给前端
        return jsonify({
            "status": "success",
            "selected_workflow": current_state.get('selected_workflow'),
            "workflow_title": current_state.get('workflow_title'),
            "message": current_state.get('final_prompt'),
            "intent": current_state.get('intent'),
            "global_context": current_state.get('global_context'),
            "knowledge_context": current_state.get('knowledge_context'),
            "image_caption":current_state.get('image_caption'),
            "style": current_state.get('style'),
            # 语义分解：实体 / 属性 / 关系。前端据此分组显示 cue，
            # 并可分别记录三类的编辑行为。旧字段一个未动，纯新增。
            "semantic_cues": {
                "entities": current_state.get('entities', []) or [],
                "attributes": current_state.get('attributes', []) or [],
                "relations": current_state.get('relations', []) or []
            }
        })

    except Exception as e:
        print(f"Agent处理出错: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/agents/only-prompt', methods=['POST'])
def only_prompt_agent():
    agent_start = time.perf_counter()
    try:
        # 1. 获取前端传递的参数：新 prompt + 前一轮 Agent 的关键上下文
        data = request.get_json(silent=True) or {}
        new_positive_prompt = data.get('positive_prompt') or ''  # 前端传入的新 prompt
        new_negative_prompt = data.get('negative_prompt') or ''
        new_positive_cues = data.get('positive_cues')
        new_negative_cues = data.get('negative_cues')
        prev_agent_context = data.get('prev_agent_context') or {}  # 前一轮 Agent 结果的上下文
        if not isinstance(prev_agent_context, dict):
            prev_agent_context = {}

        # 2. 构造 Final Prompt Agent 所需的 state（复用前一轮上下文，覆盖新 prompt）
        prompt_agent_state = {
            # 前一轮 Agent 的上下文（比如 global_input、selected_workflow、knowledge_context 等）
            "global_context": prev_agent_context.get('global_context', ''),
            "intent": prev_agent_context.get('intent', ''),  # 用前一轮 intent 或新 prompt
            "image_caption": prev_agent_context.get('image_caption', ''),  # 前一轮的图片描述（如果有）
            "knowledge_context": prev_agent_context.get('knowledge_context', ''),  # 前一轮的知识上下文
            "selected_workflow": prev_agent_context.get('selected_workflow', ''),  # 前一轮选中的工作流
            # 新传入的 prompt（核心：覆盖 user_input，作为优化的原始输入）
            "user_input": new_positive_prompt,
            "negative_prompt": new_negative_prompt,
            # 结构化 cue 必须原样进入 Final Prompt Agent，否则用户编辑后的
            # 类型和权重会在 only-prompt 这条轻量路径上丢失。
            "positive_cues": new_positive_cues,
            "negative_cues": new_negative_cues,
            # 其他 Final Prompt Agent 依赖的字段（按需从 prev_agent_context 提取）
            "style": prev_agent_context.get('style', ''),
        }
        print(prompt_agent_state)

        # 3. 仅调用 Final Prompt Agent（不跑 Master/Knowledge/Workflow Agent）
        prompt_result = final_prompt_agent_node(prompt_agent_state)
        final_prompt = prompt_result.get('final_prompt', {
            "positive": new_positive_prompt,
            "negative": new_negative_prompt
        })
        agent_time_ms = round((time.perf_counter() - agent_start) * 1000, 2)
        database.add_interaction_metric({
            "event_type": "prompt_agent",
            "module_id": prev_agent_context.get("selected_workflow", ""),
            "prompt_input_view": data.get("prompt_input_view") or "workflow_form",
            "prompt_text": new_positive_prompt,
            "negative_prompt": new_negative_prompt,
            "agent_time_ms": agent_time_ms,
            "payload": {
                "final_prompt": final_prompt,
                "prev_agent_context": prev_agent_context
            }
        })

        # 4. 返回优化后的 prompt 给前端
        return jsonify({
            "status": "success",
            "final_prompt": final_prompt
        })

    except Exception as e:
        print(f"仅执行 Prompt Agent 出错: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/assets/upload', methods=['POST'])
def upload_asset():
    """API: 接收上传文件（支持多文件），保存到 input，更新指定节点的媒体信息，返回更新后的树。"""

    # 1. 检查文件是否存在（支持多文件）
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    files = request.files.getlist('file')  # 获取所有文件
    if not files or all(file.filename == '' for file in files):
        return jsonify({"error": "No selected files"}), 400  # 检查是否有有效文件

    # 2. 获取必要参数
    tree_id = request.args.get('tree_id', default=1, type=int)
    target_node_id = request.args.get('target_node_id')
    if not target_node_id:
        return jsonify({"error": "缺少目标节点ID（target_node_id）"}), 400

    try:
        # 3. 批量保存文件到 ComfyUI input 目录
        asset_urls = []
        for file in files:
            _, ext = os.path.splitext(file.filename)
            filename = f"{uuid.uuid4()}{ext}"  # 唯一文件名
            filepath = os.path.join(COMFYUI_INPUT_PATH, filename)
            file_bytes = file.read()
            with open(filepath, "wb") as f:
                f.write(file_bytes)
            if APP_MODE != 'local':
                upload_bytes_to_comfyui_input(
                    file_bytes,
                    filename,
                    file.mimetype or "application/octet-stream"
                )
            print(f"    - 文件已上传并保存到: {filepath}")

            # 4. 构建文件访问URL
            asset_url = f"/view?filename={urllib.parse.quote_plus(filename)}&subfolder=&type=input"
            asset_urls.append((asset_url, get_asset_bucket(filename, file.mimetype)))

        # 5. 获取目标节点
        target_node = database.get_node(target_node_id)
        if not target_node:
            raise Exception(f"目标节点 {target_node_id} 不存在")

        # 6. 批量更新assets字段
        updated_assets = target_node.get('assets', {})
        updated_assets['input'] = updated_assets.get('input', {})  # 初始化input

        # 按文件类型分类添加
        for asset_url, bucket in asset_urls:
            updated_assets['input'][bucket] = updated_assets['input'].get(bucket, []) + [asset_url]

        print(updated_assets)
        # 7. 更新数据库
        database.update_node(
            node_id=target_node_id,
            payload={
                "assets": updated_assets,
                "parameters": target_node.get('parameters', {})
            }
        )

        # 8. 返回更新后的树
        updated_tree = database.get_tree_as_json(tree_id)
        if not updated_tree:
            raise Exception("获取更新后的树失败")

        return jsonify(updated_tree), 200

    except Exception as e:
        print(f"处理上传并更新节点时出错: {e}")
        # 清理已保存的文件
        if 'asset_urls' in locals():
            for asset_url, ext in asset_urls:
                parsed = urllib.parse.urlparse(asset_url)
                query_params = urllib.parse.parse_qs(parsed.query)
                filename = query_params.get('filename', [None])[0]
                if filename:
                    filepath = os.path.join(COMFYUI_INPUT_PATH, urllib.parse.unquote_plus(filename))
                    if os.path.exists(filepath):
                        try:
                            os.remove(filepath)
                        except OSError:
                            pass
        return jsonify({"error": f"处理上传失败: {e}"}), 500


# -------------- 新增：PUT /api/nodes/<node_id>/media-placeholder --------------
# app.py
@app.route('/api/nodes/<node_id>', methods=['PUT'])
def update_node_media(node_id):
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求体不能为空"}), 400

        # 调用 update_node 函数更新节点
        database.update_node(node_id, data)

        # 获取更新后的树
        tree_data = get_tree_as_json(database.get_node(node_id)['tree_id'])
        return jsonify(tree_data), 200

    except Exception as e:
        print("更新节点失败:", e)
        return jsonify({"error": str(e)}), 500



@app.route('/api/trees/<int:tree_id>', methods=['GET'])
def get_tree(tree_id):
    """API: 获取一棵树的完整结构，如果项目或根节点不存在，则自动创建。"""
    database.init_db()
    tree_data = database.get_tree_as_json(tree_id)
    
    # 场景1：连项目（树）本身都不存在
    if not tree_data:
        print(f"项目 {tree_id} 不存在，正在自动创建...")
        # 简单处理：只为ID为1的项目自动创建
        if tree_id == 1:
            new_tree_id = database.create_tree("我的第一个项目")
            database.add_node(                 node_id=str(uuid.uuid4()),                 tree_id=new_tree_id,                 parent_ids=None,                 module_id="Init",                 parameters={"description": "Project root node"},                 title="Initial Node",                 assets={},                 status="completed"             )
            tree_data = database.get_tree_as_json(new_tree_id)
        else:
            return jsonify({"error": f"Tree with ID {tree_id} not found."}), 404
        
    #  场景2：项目存在，但里面是空的（没有任何节点）
    elif not tree_data.get('nodes'):
        print(f"项目 {tree_id} 为空，正在自动添加根节点...")
        database.add_node(             node_id=str(uuid.uuid4()),             tree_id=tree_id,             parent_ids=None,             module_id="Init",             parameters={"description": "Project root node"},             title="Initial Node",             assets={},             status="completed"         )
        # 重新获取一次数据
        tree_data = database.get_tree_as_json(tree_id)
        
    return jsonify(tree_data)

# --- 【新增】删除节点的API接口 ---
@app.route('/api/metrics/record', methods=['POST'])
def api_metrics_record():
    payload = request.get_json(silent=True) or {}
    metric_id = database.add_interaction_metric(payload)
    if not metric_id:
        return jsonify({"error": "failed to save metric"}), 500
    return jsonify({"metric_id": metric_id}), 200

@app.route('/api/nodes/<node_id>', methods=['DELETE'])
def delete_node(node_id):
    """API: 删除一个节点及其所有后代。"""
    try:
        # 调用我们新创建的数据库函数
        database.delete_node_and_descendants(node_id)
        return jsonify({"status": "success", "message": f"节点 {node_id} 及其后代已被删除。"}), 200
    except Exception as e:
        print(f"删除节点 {node_id} 时出错: {e}")
        return jsonify({"error": "删除节点失败。"}), 500

@app.route('/api/nodes', methods=['POST'])
def create_node():
    # --- 本地模式 ---
    if APP_MODE == 'local':
        print(">>> 处于本地模式：模拟生成。")
        data = request.get_json()
        print(data)
        tree_id = data.get('tree_id')
        node_id = data.get('node_id')
        parent_ids = data.get('parent_ids', [])
        module_id_from_frontend = data.get('module_id')
        node_title = data.get('title')
        parameters = data.get('parameters', {})

        # 工具函数：判断参数是否为空（只定义一次）
        def is_parameters_empty(params):
            if not params:
                return True
            if isinstance(params, dict):
                return all(not v for v in params.values())
            return not params

        # --------------------------
        # 本地模式：AddText
        # --------------------------
        if module_id_from_frontend == 'AddText':
            print(">>> 检测到 AddText 模块，仅保存文本节点到数据库。")
            parameters_has_value = not is_parameters_empty(parameters)
            if parameters_has_value:
                print(f">>> 参数有值，更新节点 {node_id}")
                database.update_node(
                    node_id=node_id,
                    payload={
                        "title": node_title,
                        "module_id": module_id_from_frontend,
                        "assets": {},
                        "parameters": parameters,
                        "status": 'completed'
                    }
                )
            else:
                print(f">>> 参数无值，新增 AddText 节点")
                new_node_id = database.add_node(
                    node_id=node_id,
                    tree_id=tree_id,
                    parent_ids=parent_ids,
                    module_id=module_id_from_frontend,
                    parameters=parameters,
                    title='AddText',
                    assets={},
                    status='completed'
                )
                if not new_node_id:
                    raise Exception("保存 AddText 节点到数据库失败。")
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201

        # --------------------------
        # 本地模式：AddWorkflow
        # --------------------------
        if module_id_from_frontend == 'AddWorkflow':
            print(">>> 检测到 AddWorkflow 模块，仅保存文本节点到数据库。")
            parameters_has_value = not is_parameters_empty(parameters)
            if parameters_has_value:
                print(f">>> 参数有值，更新节点 {node_id}")
                database.update_node(
                    node_id=node_id,
                    payload={
                        "title": node_title,
                        "module_id": module_id_from_frontend,
                        "assets": {},
                        "parameters": parameters,
                        "status": 'completed'
                    }
                )
            else:
                print(f">>> 参数无值，新增 AddWorkflow 节点")
                new_node_id = database.add_node(
                    node_id=node_id,
                    tree_id=tree_id,
                    parent_ids=parent_ids,
                    module_id=module_id_from_frontend,
                    parameters=parameters,
                    title='AddWorkflow',
                    assets={},
                    status='completed'
                )
                if not new_node_id:
                    raise Exception("保存 AddWorkflow 节点到数据库失败。")
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201

        # --------------------------
        # 本地模式：SegmentElement（独立分割模块）
        # --------------------------
        if module_id_from_frontend == 'SegmentElement':
            print(">>> 本地模式：模拟分割任务")
            try:
                # 1. 获取父节点输出的图片（必须有一个父节点）
                input_images = get_input_image_filenames_from_db(node_id)
                if not input_images:
                    raise Exception("分割模块必须有图片作为输入")

                source_filename = input_images[0]
                print(f"    - 待分割图片: {source_filename}")

                # 2. 模拟分割输出（格式和真实输出一致）
                fake_segment_urls = [
                    f"/view?filename=segment_{source_filename}_1.png&subfolder=entities&type=output",
                    f"/view?filename=segment_{source_filename}_2.png&subfolder=entities&type=output"
                ]

                # 3. 输出结构统一放入 output/images
                outputs = {
                    "input": {"images": [f"/view?filename={source_filename}&subfolder=&type=output"]},
                    "output": {"images": fake_segment_urls, "videos": [], "audio": []}
                }

                # 4. 保存到数据库
                database.update_node(
                    node_id=node_id,
                    payload={
                        "title": node_title,
                        "module_id": "SegmentElement",
                        "assets": outputs,
                        "parameters": parameters,
                        "status": "completed"
                    }
                )
                updated_tree = database.get_tree_as_json(tree_id)
                return jsonify(updated_tree), 201

            except Exception as e:
                print(f"本地模拟分割失败: {e}")
                return jsonify({"error": str(e)}), 500

        # --------------------------
        # 其他本地模块逻辑（不变）
        # --------------------------
        try:
            main_output_dir = COMFYUI_OUTPUT_PATH
            video_output_dir = os.path.join(COMFYUI_OUTPUT_PATH, 'video')
            audio_output_dir = os.path.join(COMFYUI_OUTPUT_PATH, 'audio')
            available_files = []

            if os.path.exists(main_output_dir):
                available_files.extend([(f, '') for f in os.listdir(main_output_dir) if f.endswith(('.png', '.jpg', '.jpeg'))])
            if os.path.exists(video_output_dir):
                available_files.extend([(f, 'video') for f in os.listdir(video_output_dir) if f.endswith(('.mp4', '.mov', '.avi'))])
            if os.path.exists(audio_output_dir):
                available_files.extend([(f, 'audio') for f in os.listdir(audio_output_dir) if f.endswith(('.mp3', '.wav', '.flac'))])

            if not available_files:
                raise FileNotFoundError("在 local_assets/output 目录中找不到任何示例文件")
            fake_filename, subfolder = random.choice(available_files)
            asset_url = f"/view?filename={urllib.parse.quote_plus(fake_filename)}&subfolder={urllib.parse.quote_plus(subfolder)}&type=output"
            outputs = {"input": {"images": [], "videos": [], "audio": []}, "output": {"images": [], "videos": [], "audio": []}}
            if subfolder == 'video':
                outputs["output"]["videos"].append(asset_url)
            elif subfolder == 'audio':
                outputs["output"]["audio"].append(asset_url)
            else:
                outputs["output"]["images"].append(asset_url)

            database.update_node(
                node_id=node_id,
                payload={
                    "title": node_title,
                    "module_id": module_id_from_frontend,
                    "assets": outputs,
                    "parameters": parameters,
                    "status": 'completed'
                }
            )
            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201
        except Exception as e:
            print(f"本地模拟生成失败: {e}")
            return jsonify({"error": str(e)}), 500

    # ============================================================
    # 服务器模式
    # ============================================================
    print(">>> 处于服务器模式：开始 ComfyUI 生成。")
    generation_start = time.perf_counter()
    data = request.get_json()
    tree_id = data.get('tree_id')
    node_id = data.get('node_id', [])
    node_title = data.get('title')
    parent_ids = data.get('parent_ids', [])
    module_id_from_frontend = data.get('module_id')
    parameters = data.get('parameters', {})
    normalized_request_input_assets = sync_request_input_assets(node_id, data.get('input_assets'))

    # 工具函数
    def is_parameters_empty(params):
        if not params:
            return True
        if isinstance(params, dict):
            return all(not v for v in params.values())
        return not params

    # Seed 处理（不变）
    REQUIRES_SEED_MODULES = [
        'TextGenerateImage', 'ImageGenerateImage_Basic', 'ImageGenerateImage_Canny',
        'ImageGenerateVideo', 'ImageHDREstoration', 'PartialRepainting',
        'Put_It_Here', 'TextGenerateVideo', 'CameraControl', 'FLFrameToVideo'
    ]
    REQUIRES_AUDIO_SEED_MODULES = ['TextToAudio']

    if module_id_from_frontend in REQUIRES_SEED_MODULES:
        if 'seed' not in parameters or parameters['seed'] is None:
            parameters['seed'] = random.randint(0, 999999999999999)
    if module_id_from_frontend in REQUIRES_AUDIO_SEED_MODULES:
        if 'audio_seed' not in parameters or parameters['audio_seed'] is None:
            parameters['audio_seed'] = random.randint(0, 999999999999999)

    workflow = None
    final_module_id = module_id_from_frontend
    image_filenames = {}
    video_filenames = {}

    # --------------------------
    # 服务器模式：AddText
    # --------------------------
    if final_module_id == 'AddText':
        print(">>> 检测到 AddText 模块")
        parameters_has_value = not is_parameters_empty(parameters)
        if parameters_has_value:
            database.update_node(
                node_id=node_id,
                payload={
                    "title": node_title, "module_id": final_module_id,
                    "assets": {}, "parameters": parameters, "status": "completed"
                }
            )
        else:
            new_node_id = database.add_node(
                node_id=node_id, tree_id=tree_id, parent_ids=parent_ids,
                module_id=final_module_id, parameters=parameters, title='AddText',
                assets={}, status='completed'
            )
            if not new_node_id:
                raise Exception("保存失败")
        updated_tree = database.get_tree_as_json(tree_id)
        return jsonify(updated_tree), 201

    # --------------------------
    # 服务器模式：AddWorkflow
    # --------------------------
    if final_module_id == 'AddWorkflow':
        print(">>> 检测到 AddWorkflow 模块")
        parameters_has_value = not is_parameters_empty(parameters)
        if parameters_has_value:
            database.update_node(
                node_id=node_id,
                payload={
                    "title": node_title, "module_id": final_module_id,
                    "assets": {}, "parameters": parameters, "status": "completed"
                }
            )
        else:
            new_node_id = database.add_node(
                node_id=node_id, tree_id=tree_id, parent_ids=parent_ids,
                module_id=final_module_id, parameters=parameters, title='AddWorkflow',
                assets={}, status='completed'
            )
            if not new_node_id:
                raise Exception("保存失败")
        updated_tree = database.get_tree_as_json(tree_id)
        return jsonify(updated_tree), 201

    # ==================================================================
    # ✅ 核心：独立分割工作流 SegmentElement（完全独立，不耦合主流程）
    # ==================================================================

    if final_module_id == 'SegmentElement':
        print(f">>> 执行独立分割工作流：SegmentElement (节点 {node_id})")
        try:
            # 1. 获取父节点输出的图片
            input_images = get_input_image_filenames_from_db(node_id)
            if not input_images:
                raise Exception("分割模块必须有图片输入")

            source_image_filename = input_images[0]
            source_image_path = os.path.join(COMFYUI_INPUT_PATH, source_image_filename)
            if APP_MODE != 'local':
                source_image_path = ensure_local_comfyui_input_file(source_image_filename)
            print(f"    - 源图路径: {source_image_path}")

            # 2. 调用实体识别
            # 2. Resolve segmentation targets.
            user_prompt = (
                parameters.get('positive_prompt')
                or parameters.get('prompt')
                or parameters.get('text')
                or ''
            )
            target_subjects = parse_segment_subjects_from_prompt(user_prompt)
            if target_subjects:
                print(f"    - 使用用户 prompt 指定实体: {target_subjects}")
            else:
                target_subjects = entity_v_agent.detect_entities_from_vision(
                    image_path=source_image_path,
                    original_prompt=user_prompt
                )
            parameters['segment_subjects'] = target_subjects
            print(f"    - 目标分割实体: {target_subjects}")

            # 3. 执行分割（完全按你原来的逻辑）
            segmented_results = []
            entity_output_dir = "entities"

            for subject in target_subjects:
                res = segment_with_sam(
                    image_path=source_image_path,
                    text_prompt=subject,
                    output_dir=entity_output_dir
                )
                if res:
                    segmented_results.extend(res)

            # ========== 以下完全恢复你最初的逻辑 ==========
            # 4. 清理旧实体记录（你原版逻辑）
            database.delete_all_entity_appearance_by_node(tree_id=tree_id, node_id=node_id)

            # 5. 批量插入新实体（你原版逻辑）
            for entity in segmented_results:
                database.add_entity_appearance(
                    tree_id=tree_id,
                    name=entity['label'],
                    node_id=node_id,
                    branch_id='branch_1',
                    image_url=entity['path']
                )

            # ========== 6. 执行 RemovePeople 背景清除（你原版完整逻辑） ==========
            print(f"🧹 开始执行 RemovePeople.json 工作流生成背景图...")
            background_image_url = None
            background_image_path = None

            try:
                # 加载工作流
                remove_people_workflow = load_workflow('RemovePeople')
                if not remove_people_workflow:
                    raise ValueError("未找到 RemovePeople.json 工作流文件")

                
                # 注入图片
                load_image_node_id = find_node_id_by_title(remove_people_workflow, "LoadImage")
                if load_image_node_id:
                    remove_people_workflow[load_image_node_id]["inputs"]["image"] = source_image_filename
                else:
                    raise ValueError("RemovePeople 工作流中未找到 LoadImage 节点")


                background_prompt = build_segment_background_prompt(parameters, target_subjects)
                background_prompt_node_id = find_node_id_by_title(remove_people_workflow, "CLIP Text Encode (Positive Prompt)")
                if background_prompt_node_id:
                    remove_people_workflow[background_prompt_node_id]["inputs"]['text'] = background_prompt
                    parameters['background_prompt_used'] = background_prompt
                    print(f"    - RemovePeople background prompt: {background_prompt}")
                else:
                    print("    - Warning: RemovePeople workflow has no positive prompt node; using workflow defaults.")
                # 执行
                remove_queued_prompt = queue_comfyui_prompt(remove_people_workflow)
                remove_prompt_id = remove_queued_prompt['prompt_id']
                remove_outputs = get_comfyui_outputs(remove_prompt_id)

                # 解析背景图
                if remove_outputs and remove_outputs.get('images'):
                    background_url = remove_outputs['images'][0]
                    parsed_bg_url = urlparse(background_url)
                    bg_params = parse_qs(parsed_bg_url.query)
                    bg_filename = bg_params.get('filename', [None])[0]
                    bg_subfolder = bg_params.get('subfolder', [''])[0]
                    bg_type = bg_params.get('type', ['output'])[0]

                    if bg_filename:
                        background_image_url = f"/view?filename={urllib.parse.quote_plus(bg_filename)}&subfolder={urllib.parse.quote_plus(bg_subfolder)}&type={urllib.parse.quote_plus(bg_type)}"
                        background_image_path = ensure_local_comfyui_output_file(bg_filename, bg_subfolder, bg_type)
                        segmented_results.append({
                            'label': 'background',
                            'path': background_image_url
                        })

                        # 存入背景实体
                        database.add_entity_appearance(
                            tree_id=tree_id,
                            name='background',
                            node_id=node_id,
                            branch_id='branch_1',
                            image_url=background_image_url
                        )
            except Exception as e:
                print(f"⚠️ 执行 RemovePeople 失败: {e}")

            # ========== 7. 【关键】完全恢复你最初版的 assets 保存结构 ==========
            # 你原版就是：output + segmented 同时存在
            node_assets = {
                "input": {"images": [f"/view?filename={source_image_filename}&subfolder=&type=input"]},
                "output": {
                    "images": [],
                    "videos": [],
                    "audio": []
                },
                "segmented": segmented_results  # 完全保留你原版的 segmented 字段
            }

            # 8. 保存节点（和你最初代码完全一致）
            database.update_node(
                node_id=node_id,
                payload={
                    "title": node_title,
                    "module_id": "SegmentElement",
                    "assets": node_assets,
                    "parameters": parameters,
                    "status": "completed"
                }
            )

            updated_tree = database.get_tree_as_json(tree_id)
            return jsonify(updated_tree), 201

        except Exception as e:
            print(f"分割任务失败: {e}")
            database.update_node(
                node_id=node_id,
                payload={"status": "failed", "error": str(e)}
            )
            return jsonify({"error": f"分割失败: {str(e)}"}), 500
    

    # --------------------------
    # 以下是原有主工作流逻辑（图像合并/图生图/文生图等，完全不变）
    # --------------------------
    try:
        count = get_input_image_count_from_db(node_id)
        if count == 2:
            if module_id_from_frontend == 'FLFrameToVideo':
                final_module_id = module_id_from_frontend
                workflow = load_workflow(final_module_id)
                image1_filename = get_input_image_filenames_from_db(node_id)[0]
                image2_filename = get_input_image_filenames_from_db(node_id)[1]
                image_filenames["LoadStartImage"] = image1_filename
                image_filenames["LoadLastImage"] = image2_filename
            elif module_id_from_frontend == 'LayerStacking':
                final_module_id = module_id_from_frontend
                workflow = load_workflow(final_module_id)
                image1_filename = get_input_image_filenames_from_db(node_id)[0]
                image2_filename = get_input_image_filenames_from_db(node_id)[1]
                image_filenames["LoadBackgroundImage"] = image1_filename
                image_filenames["LoadMoveImage"] = image2_filename
            elif module_id_from_frontend == 'ImageInpainting':
                final_module_id = module_id_from_frontend
                workflow = load_workflow(final_module_id)
                image1_filename = get_input_image_filenames_from_db(node_id)[0]
                image2_filename = get_input_image_filenames_from_db(node_id)[1]
                image_filenames["LoadImage"] = image1_filename
                image_filenames["LoadMask"] = image2_filename
            else:
                print(">>> 检测到两个输入,执行ImageMerging工作流...")
                image1_filename = get_input_image_filenames_from_db(node_id)[0]
                image2_filename = get_input_image_filenames_from_db(node_id)[1]
                image_filenames["LoadImage"] = image1_filename
                image_filenames["LoadImage(Move)"] = image2_filename
                merge_workflow = load_workflow('ImageMerging')
                for node_title, filename in image_filenames.items():
                    target_node_id = find_node_id_by_title(merge_workflow, node_title)
                    if target_node_id:
                        merge_workflow[target_node_id]["inputs"]["image"] = filename
                queued_prompt = queue_comfyui_prompt(merge_workflow)
                prompt_id = queued_prompt['prompt_id']
                merge_outputs = get_comfyui_outputs(prompt_id)
                merge_image_urls = merge_outputs.get("images", [])
                if not merge_image_urls:
                    raise Exception("ImageMerging 未返回图片")
                merge_image_url = merge_image_urls[0]
                parsed_url = urllib.parse.urlparse(merge_image_url)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                merge_filename_merge = query_params.get('filename', [None])[0]
                if APP_MODE != 'local':
                    copy_comfyui_output_to_input(merge_filename_merge)
                else:
                    output_img_path = os.path.join(COMFYUI_OUTPUT_PATH, merge_filename_merge)
                    input_img_path = os.path.join(COMFYUI_INPUT_PATH, merge_filename_merge)
                    os.makedirs(COMFYUI_INPUT_PATH, exist_ok=True)
                    shutil.copy2(output_img_path, input_img_path)
                image_filenames["LoadImage"] = merge_filename_merge
                final_module_id = module_id_from_frontend
                workflow = load_workflow(final_module_id)

        elif count == 1:
            print(f">>> 检测到一个输入,加载工作流: {module_id_from_frontend}")
            final_module_id = module_id_from_frontend
            workflow = load_workflow(final_module_id)
            if workflow is None:
                raise ValueError(f"未找到工作流 '{final_module_id}.json'")
            if final_module_id in ['ImageGenerateImage_Basic', 'ImageGenerateImage_Canny', 'ImageGenerateVideo', 'CameraControl', 'ImageCanny', 'ImageHDRestoration', 'PartialRepainting', 'Put_It_Here', 'RemoveBackground']:
                image_filename = get_input_image_filenames_from_db(node_id)[0]
                image_filenames["LoadImage"] = image_filename
            elif final_module_id in ['FrameInterpolation']:
                image_filename = get_input_image_filenames_from_db(node_id)[0]
                video_filenames["LoadVideo"] = image_filename

        else:
            print(f">>> 没有输入图片，加载工作流: {module_id_from_frontend}")
            final_module_id = module_id_from_frontend
            workflow = load_workflow(final_module_id)
            if workflow is None:
                raise ValueError(f"未找到工作流 '{final_module_id}.json'")

        # 注入图片/视频
        for node_title, filename in image_filenames.items():
            target_node_id = find_node_id_by_title(workflow, node_title)
            if target_node_id:
                workflow[target_node_id]["inputs"]["image"] = filename
        for node_title, filename in video_filenames.items():
            target_node_id = find_node_id_by_title(workflow, node_title)
            if target_node_id:
                workflow[target_node_id]["inputs"]["file"] = filename

        # 参数注入逻辑（不变）
        isVideo = final_module_id in ['TextGenerateVideo', 'ImageGenerateVideo', 'FLFrameToVideo', 'CameraControl']
        prompt_positive_node_id = find_node_id_by_title(workflow, "CLIP Text Encode (Positive Prompt)")
        if prompt_positive_node_id:
            positive_prompt = parameters.get('optimized_positive_prompt', parameters.get('positive_prompt', ''))
            workflow[prompt_positive_node_id]["inputs"]["text"] = positive_prompt
        prompt_t2i_node_id = find_node_id_by_title(workflow, "CLIP Text Encode (T2I Prompt)")
        if prompt_t2i_node_id:
            positive_prompt = parameters.get('optimized_positive_prompt', parameters.get('positive_prompt', ''))
            workflow[prompt_t2i_node_id]["inputs"]["value"] = positive_prompt

        prompt_negative_node_id = find_node_id_by_title(workflow, "CLIP Text Encode (Negative Prompt)")
        if prompt_negative_node_id:
            user_negative_prompt = parameters.get('negative_prompt') or parameters.get('optimized_negative_prompt', '')
            current_negative_prompt = workflow[prompt_negative_node_id].get("inputs", {}).get("text", '')
            workflow[prompt_negative_node_id]["inputs"]['text'] = append_prompt_text(
                current_negative_prompt,
                user_negative_prompt
            )
        # ... 其他参数注入（保持不变）
        size_node_id = find_node_id_by_title(workflow, "Size_Setting")
        if size_node_id:
            if 'width' in parameters: workflow[size_node_id]["inputs"]["width"] = parameters['width']
            if 'height' in parameters: workflow[size_node_id]["inputs"]["height"] = parameters['height']
            if 'batch_size' in parameters and not isVideo: workflow[size_node_id]["inputs"]["batch_size"] = parameters['batch_size']
            if 'time' in parameters: workflow[size_node_id]["inputs"]["length"] = seconds_to_video_length(parameters['time'], parameters.get('fps', 16))
            if 'speed' in parameters: workflow[size_node_id]["inputs"]["speed"] = parameters['speed']
            if 'camera_pose' in parameters: workflow[size_node_id]["inputs"]["camera_pose"] = parameters['camera_pose']
            if 'seconds' in parameters: workflow[size_node_id]["inputs"]["seconds"] = parameters['seconds']

        if 'fps' in parameters:
            for node in workflow.values():
                if node.get("class_type") == "CreateVideo" and "inputs" in node:
                    node["inputs"]["fps"] = parameters['fps']

        # 执行工作流
        queued_prompt = queue_comfyui_prompt(workflow)
        prompt_id = queued_prompt['prompt_id']
        outputs = get_comfyui_outputs(prompt_id)
        batch_size = parameters.get('batch_size', 1)
        toVideos = isVideo and batch_size > 1

        if toVideos:
            sampleradv_node_id = find_node_id_by_title(workflow, "KSamplerAdvanced2")
            for i in range(1, batch_size):
                workflow[sampleradv_node_id]["inputs"]["noise_seed"] = random.randint(0, 999999999999999)
                queued_prompt = queue_comfyui_prompt(workflow)
                prompt_id = queued_prompt['prompt_id']
                batch_outputs = get_comfyui_outputs(prompt_id)
                outputs["images"].extend(batch_outputs.get("images", []))

    except Exception as e:
        print(f"主流程错误: {e}")
        database.add_interaction_metric({
            "event_type": "generation_error",
            "tree_id": tree_id,
            "node_id": node_id,
            "module_id": final_module_id,
            "prompt_input_view": data.get("prompt_input_view") or "workflow_form",
            "prompt_text": parameters.get("positive_prompt") or parameters.get("optimized_positive_prompt") or parameters.get("text"),
            "negative_prompt": parameters.get("negative_prompt") or parameters.get("optimized_negative_prompt"),
            "generation_time_ms": round((time.perf_counter() - generation_start) * 1000, 2),
            "payload": {"error": str(e), "parameters": parameters}
        })
        return jsonify({"error": str(e)}), 500

    # 主流程保存节点
    if outputs:
        node_assets = {"input": normalized_request_input_assets, "output": outputs}
        database.update_node(
            node_id=node_id,
            payload={
                "title": node_title,
                "module_id": final_module_id,
                "assets": node_assets,
                "parameters": parameters,
                "status": 'completed'
            }
        )

    if outputs:
        database.add_interaction_metric({
            "event_type": "generation",
            "tree_id": tree_id,
            "node_id": node_id,
            "module_id": final_module_id,
            "prompt_input_view": data.get("prompt_input_view") or "workflow_form",
            "prompt_text": parameters.get("positive_prompt") or parameters.get("optimized_positive_prompt") or parameters.get("text"),
            "negative_prompt": parameters.get("negative_prompt") or parameters.get("optimized_negative_prompt"),
            "generation_time_ms": round((time.perf_counter() - generation_start) * 1000, 2),
            "payload": {
                "input_assets": normalized_request_input_assets,
                "outputs": outputs,
                "parameters": parameters,
                "status": "completed"
            }
        })

    updated_tree = database.get_tree_as_json(tree_id)
    return jsonify(updated_tree), 201


# 合并节点路由
@app.route('/api/nodes/merge', methods=['POST'])
def merge_nodes():
    """
    用户在前端框选了多个节点，点击“合并”
    """
    data = request.json
    node_ids = data.get('node_ids') # ['node_1', 'node_2']
    group_title = data.get('title', '新合并组')
    
    # 在数据库中创建一个特殊的“组节点”或者给这些节点统一打上 parent_group_id
    success = database.create_group_and_assign_nodes(node_ids, group_title)
    
    if success:
        return jsonify({"message": "合并成功"}), 200
    return jsonify({"error": "合并失败"}), 500


# 手动触发SAM分割
@app.route('/api/entities/extract', methods=['POST'])
def extract_entities():
    data = request.json
    node_id = data.get('node_id')
    prompt = data.get('prompt')
    tree_id = data.get('tree_id')

    # 1. 获取节点原图路径
    node = database.get_node(node_id)
    if not node: return jsonify({"error": "Node not found"}), 404
    
    # 假设你的视频生成后会存一个封面图在 assets 里
    image_path = node['assets'].get('poster') or node['assets'].get('output_image')
    
    # 2. 调用 SAM Agent 分割
    output_dir = "static/entities/" # 确保文件夹存在
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        segments = segment_with_sam(image_path, prompt, output_dir)
        
        # 3. 更新数据库：存入实体的“档案表”
        for seg in segments:
            database.add_or_update_entity_appearance(
                tree_id=tree_id,
                name=seg['label'],
                node_id=node_id,
                branch_id=node.get('branch_id'),
                image_url=seg['path']
            )
            
        # 4. 同步更新该节点的 assets
        database.update_node_assets(node_id, {"segmented_entities": segments})
        
        return jsonify({"status": "success", "entities": segments})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---获取entity图片---
@app.route('/entities/<path:filename>')
def serve_entities(filename):
    # as_attachment=False 确保是在浏览器预览而不是下载
    return send_from_directory('entities', filename)

# --- 【核心修改】视频拼接 API 接口 (使用 moviepy) ---
@app.route('/api/stitch', methods=['POST'])
def stitch_videos():
    data = request.get_json()

    # --- 【调试】---
    print("\n" + "="*50)
    print("--- [Stitch Request] 后端已收到 ---")
    print(json.dumps(data, indent=2))
    print("="*50 + "\n")
    # --- 【调试】---

    clips_data = data.get('clips') # <-- 视频/图片轨
    audio_clips_data = data.get('audio_clips', []) # <-- 【新增】获取音轨

     # --- 【调试】---
    if not audio_clips_data:
        print("!!! [Stitch Request] 警告: 'audio_clips' 键为空或不存在。!!!")
    # --- 【调试】---

    if not clips_data or len(clips_data) < 1:
        return jsonify({"error": "需要至少一个视频/图片片段"}), 400

    moviepy_clips = []
    moviepy_audio_clips = [] # <-- 【新增】
    default_image_duration = 3
    target_fps = 16 

    final_video_clip = None # <-- 【新增】
    final_audio_clip = None # <-- 【新增】

    try:
        # --- 1. 处理视频/图片轨 (与旧逻辑基本相同) ---
        print("--- 正在处理视频轨 ---")
        for clip_info in clips_data:
            relative_path = clip_info.get('path')
            clip_type = clip_info.get('type') # 'image' 或 'video'

            if not relative_path or not clip_type:
                raise ValueError(f"视频轨片段信息不完整: {clip_info}")

            # (解析路径)
            parsed_url = urllib.parse.urlparse(relative_path)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get('filename', [None])[0]
            subfolder = query_params.get('subfolder', [''])[0]
            file_type = query_params.get('type', ['output'])[0]
            if not filename:
                raise ValueError(f"无法从视频轨路径解析文件名: {relative_path}")

            full_path = resolve_stitch_media_path(relative_path)

            # (创建 MoviePy Clip 对象 - 不变)
            if clip_type == 'video':
                print(f"加载视频: {full_path}")
                video_clip = VideoFileClip(full_path)
                # (裁剪逻辑... 不变)
                # --- (v90 修复) 确保 duration, startTime, endTime 存在 ---
                total_duration = video_clip.duration
                start_time = clip_info.get('startTime', 0)
                end_time = clip_info.get('endTime', total_duration)

                # (v90) 确保类型为 float 且不超出范围
                try:
                    final_start = float(start_time)
                    final_end = float(end_time)
                    if final_start < 0: final_start = 0
                    if final_end > total_duration: final_end = total_duration
                    if final_start >= final_end:
                        final_start = 0
                        final_end = total_duration
                except Exception as e:
                    print(f"    - 警告: 无法解析时间 {start_time}-{end_time}。使用完整剪辑。 {e}")
                    final_start = 0
                    final_end = total_duration

                print(f"    - 裁剪视频从 {final_start}s 到 {final_end}s")
                trimmed_clip = video_clip.subclipped(final_start, final_end)
                moviepy_clips.append(trimmed_clip)
            else: # 图片
                duration = clip_info.get('duration', default_image_duration)
                if duration is None or float(duration) <= 0:
                    duration = default_image_duration

                print(f"加载图片并创建为 {duration} 秒片段: {full_path}")
                image_clip = ImageClip(full_path)
                image_clip.duration = float(duration)
                image_clip.fps = target_fps
                moviepy_clips.append(image_clip)

        if not moviepy_clips:
             raise ValueError("未能成功加载任何视频/图片片段")

        print("使用 moviepy 拼接视频轨...")
        final_video_clip = concatenate_videoclips(moviepy_clips, method="compose")

        # --- 【关键修复】开始：在添加新音轨之前，先移除所有旧音轨 ---
        print("... 视频轨拼接完成。正在移除所有原始音轨...")
        final_video_clip.audio = None
        # --- 【关键修复】结束 ---

        # --- 【新增】开始：处理音轨 ---
        if audio_clips_data:
            print("--- 正在处理音轨 ---")
            for clip_info in audio_clips_data:
                relative_path = clip_info.get('path')
                if not relative_path:
                    raise ValueError(f"音轨片段信息不完整: {clip_info}")

                full_path = resolve_stitch_media_path(relative_path)

                print(f"加载音频: {full_path}")
                audio_clip = AudioFileClip(full_path)

                duration = clip_info.get('duration', audio_clip.duration)
                try:
                    final_duration = float(duration)
                    if final_duration > audio_clip.duration:
                        final_duration = audio_clip.duration
                except Exception:
                    final_duration = audio_clip.duration

                print(f"    - 裁剪音频为 {final_duration}s")
                moviepy_audio_clips.append(audio_clip.subclipped(0, final_duration))

            if moviepy_audio_clips:
                print("拼接音轨...")
                final_audio_clip = concatenate_audioclips(moviepy_audio_clips)

                # (关键) 将音频设置到视频上
                print("将音轨合成到视频轨...")
                # 确保音频不超过视频时长
                if final_audio_clip.duration > final_video_clip.duration:
                    print(f"    - 警告: 音轨 ( {final_audio_clip.duration}s ) 比视频轨 ( {final_video_clip.duration}s ) 长，将进行裁剪。")
                    final_audio_clip = final_audio_clip.subclipped(0, final_video_clip.duration)

                # 将视频的(已移除的)原声替换为我们的新音轨
                final_video_clip.audio = final_audio_clip

            else:
                print("音轨数据存在，但未能加载任何音频剪辑。视频将无声。")

        else:
            print("未提供音轨数据 (A1 为空)。视频将无声。")
        # --- 【新增】结束 ---

        # --- 3. 写入输出文件 (基本不变) ---
        output_filename = f"stitched_{uuid.uuid4()}.mp4"
        output_path_absolute = os.path.join(STITCHED_OUTPUT_FOLDER, output_filename)
        print(f"写入最终合成的视频到: {output_path_absolute}")

        final_video_clip.write_videofile(
            output_path_absolute,
            codec="libx264",
            audio_codec="aac",  # <-- 现在 audio_codec 非常重要
            fps=target_fps,
            threads=4,
            preset='medium'
        )

        # --- 4. 关闭所有打开的文件句柄 ---
        for clip in moviepy_clips:
            clip.close()
        if final_video_clip:
            final_video_clip.close()

        # 【新增】关闭音轨句柄
        for clip in moviepy_audio_clips:
            clip.close()
        if final_audio_clip:
            final_audio_clip.close()
        # 【新增】结束

        # --- 5. 返回结果 URL ---
        output_url = f"/stitched/{output_filename}"
        print(f"拼接完成，访问 URL: {output_url}")
        return jsonify({"output_url": output_url}), 200

    except FileNotFoundError as e:
        print(f"文件未找到错误: {e}")
        return jsonify({"error": str(e)}), 404
    except ValueError as e:
         print(f"值错误: {e}")
         return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"Moviepy 处理过程中发生错误: {type(e).__name__} - {e}")
        # 清理 clip 对象 (v90 修复缩进)
        for clip in moviepy_clips:
            try: clip.close()
            except: pass
        for clip in moviepy_audio_clips:
            try: clip.close()
            except: pass
        if final_video_clip:
            try: final_video_clip.close()
            except: pass
        if final_audio_clip:
            try: final_audio_clip.close()
            except: pass
        return jsonify({"error": f"视频拼接失败: {e}"}), 500

# --- 【不变】用于下载/访问拼接后视频的路由 ---
@app.route('/stitched/<filename>')
def download_stitched_video(filename):
    try:
        return send_from_directory(STITCHED_OUTPUT_FOLDER, filename, as_attachment=False)
    except FileNotFoundError:
        abort(404)

@app.route('/api/database/download', methods=['GET'])
def download_database():
    """提供SQLite数据库文件的下载"""
    try:
        backend_directory = os.path.dirname(os.path.abspath(__file__))
        return send_from_directory(
            directory=backend_directory,
            path='video_tree.db',
            as_attachment=True,
            download_name='video_tree_backup.db'
        )
    except FileNotFoundError:
        return jsonify({"error": "数据库文件未找到!"}), 404


# --- 构图记录接口（附加功能，独立于既有流程） ---

@app.route('/api/composition/record', methods=['POST'])
def api_composition_record():
    """
    记录一次画布取景框导出的构图。
    前端监听 canvas-composition-record 事件后调用即可，失败不影响导出本身。
    """
    payload = request.get_json(silent=True) or {}
    if not payload.get('composition'):
        return jsonify({"error": "缺少 composition 字段"}), 400

    record_id = database.add_composition_record(payload)
    if not record_id:
        return jsonify({"error": "保存失败"}), 500
    return jsonify({"record_id": record_id}), 200


@app.route('/api/composition/records', methods=['GET'])
def api_composition_records():
    """按 scene_session_id 或 tree_id 查询构图记录。"""
    scene_session_id = request.args.get('scene_session_id')
    tree_id = request.args.get('tree_id', type=int)
    return jsonify(database.get_composition_records(
        scene_session_id=scene_session_id,
        tree_id=tree_id
    )), 200


@app.route('/api/composition/intersections', methods=['GET'])
def api_composition_intersections():
    """
    计算同一场景会话下，各取景框两两之间共享了哪些部件、几何重叠多少。
    这就是「两个关键帧的交集」的量化结果。
    """
    scene_session_id = request.args.get('scene_session_id')
    if not scene_session_id:
        return jsonify({"error": "缺少 scene_session_id"}), 400
    return jsonify(database.compute_viewport_intersections(scene_session_id)), 200


# --- 4. 启动应用 ---

if __name__ == '__main__':
    # 在启动应用前，确保数据库和表已创建
    database.init_db()
    
    # 初始化时可以创建一个默认的树/项目
    if not database.get_tree_as_json(1):
        tree_id = database.create_tree("我的第一个项目")
        # 生成唯一node_id（使用uuid）
        init_node_id = str(uuid.uuid4())
        # 正确调用add_node，补充所有必填参数
        database.add_node(
            node_id=init_node_id,          # 新增：节点唯一ID
            tree_id=tree_id,               # 所属树ID
            parent_ids=None,               # 无父节点（根节点）
            module_id="Init",              # 模块ID
            parameters={"description": "项目根节点"},  # 参数（必填）
            title="Initial Node"           # 标题（必填，之前缺失）
        )
        print(f"已创建默认项目，ID为: {tree_id}")


    app.run(host='0.0.0.0', port=int(os.getenv("BACKEND_PORT", "5006")), debug=True)

