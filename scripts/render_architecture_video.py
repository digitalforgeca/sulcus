#!/usr/bin/env python3
"""Renders the Sulcus Enterprise Architecture and Business Value Video.

Generates a broadcast-quality 1080p MP4 video with synchronized narration,
explaining the business value, proactive context, plugins, and continuous improvement cycles.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voice_generator import generate_voice, get_audio_duration

WIDTH = 1920
HEIGHT = 1080
FPS = 30

# Colors
BG_COLOR = (13, 17, 23)        # Sleek dark slate
CARD_BG = (22, 27, 34)         # Elevated card
CARD_BORDER = (48, 54, 61)     # Border outline
TEXT_WHITE = (240, 246, 252)   # High-contrast white
TEXT_MUTED = (139, 148, 158)   # Muted subtext
CYAN_ACCENT = (56, 189, 248)   # Electric cyan
EMERALD_ACCENT = (52, 211, 153)# Emerald green
VIOLET_ACCENT = (167, 139, 250)# Purple/violet
GOLD_ACCENT = (251, 191, 36)   # Gold accent

FONT_PATH_HEADING = "/System/Library/Fonts/Helvetica.ttc"
FONT_PATH_CODE = "/System/Library/Fonts/Menlo.ttc"


def get_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def create_base_canvas(title: str, subtitle: str) -> Image.Image:
    """Create standard enterprise slide canvas with header branding."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Subtle top accent bar
    draw.rectangle([(0, 0), (WIDTH, 6)], fill=CYAN_ACCENT)

    # Header branding
    font_brand = get_font(FONT_PATH_HEADING, 28)
    font_cat = get_font(FONT_PATH_HEADING, 20)
    draw.text((80, 50), "SULCUS", fill=CYAN_ACCENT, font=font_brand)
    draw.text((210, 56), "|   Enterprise Memory Infrastructure", fill=TEXT_MUTED, font=font_cat)

    # Title & Subtitle
    font_title = get_font(FONT_PATH_HEADING, 48)
    font_sub = get_font(FONT_PATH_HEADING, 24)
    draw.text((80, 110), title, fill=TEXT_WHITE, font=font_title)
    draw.text((80, 175), subtitle, fill=TEXT_MUTED, font=font_sub)

    # Bottom subtle footer
    font_footer = get_font(FONT_PATH_HEADING, 18)
    draw.line([(80, HEIGHT - 60), (WIDTH - 80, HEIGHT - 60)], fill=CARD_BORDER, width=1)
    draw.text((80, HEIGHT - 45), "Sulcus Semantic Memory — Mission-Critical Agent Continuity", fill=TEXT_MUTED, font=font_footer)
    draw.text((WIDTH - 280, HEIGHT - 45), "https://api.sulcus.ca", fill=CYAN_ACCENT, font=font_footer)

    return img


SCENES = [
    {
        "id": "scene1_intro",
        "title": "Enterprise Memory for Autonomous AI Agents",
        "subtitle": "Persistent, proactive intelligence across sessions and distributed agent swarms",
        "voice": (
            "Welcome to Sulcus, the enterprise memory infrastructure designed specifically for autonomous AI agents. "
            "Modern organizations are deploying AI across software engineering, customer operations, and data workflows, "
            "but standard foundation models suffer from a fundamental limitation: complete amnesia between sessions."
        ),
        "render": "render_scene1",
    },
    {
        "id": "scene2_problem",
        "title": "The Enterprise Challenge: The Amnesia Tax",
        "subtitle": "Why conventional stateless agent deployments stall in production",
        "voice": (
            "Without persistent memory, every agent interaction starts completely from zero. Teams waste hours re-explaining "
            "architecture, passwords, and changing policies. Stuffing massive conversational history into the prompt inflates "
            "token costs by orders of magnitude, slows execution latency, and causes hallucination."
        ),
        "render": "render_scene2",
    },
    {
        "id": "scene3_philosophy",
        "title": "Architectural Philosophy: Semantic Virtual Memory",
        "subtitle": "Strict separation between the lightweight Map and deep Territory",
        "voice": (
            "Sulcus solves this with a Semantic Virtual Memory Management Unit. We strictly separate the lightweight Map of "
            "high-speed vector pointers from the heavy Territory of raw data. The language model scans lightweight pointers in "
            "working context, paging in deep technical territory only when a specific page fault occurs."
        ),
        "render": "render_scene3",
    },
    {
        "id": "scene4_proactive",
        "title": "Proactive Context: Zero-Friction Recall & Capture",
        "subtitle": "Dynamic lifecycle injection before the model runs, zero manual prompting",
        "voice": (
            "Sulcus is proactive, not passive. Through native lifecycle hooks, Sulcus intercepts user requests before invocation, "
            "retrieving relevant organizational memory and injecting verified facts into working context automatically. In the "
            "background, verified operational directives are captured without any manual prompt engineering."
        ),
        "render": "render_scene4",
    },
    {
        "id": "scene5_ecosystem",
        "title": "Ecosystem Integration: Plugins, MCP & Libraries",
        "subtitle": "Native support across modern developer tools, runtimes, and agent protocols",
        "voice": (
            "Sulcus integrates effortlessly into your existing technology stack. It features native plugins for Antigravity, "
            "full Model Context Protocol support for local Stdio and enterprise Server-Sent Events, robust client libraries in "
            "Rust and Python, and an offline-first daemon synchronized securely with the enterprise cloud."
        ),
        "render": "render_scene5",
    },
    {
        "id": "scene6_cycles",
        "title": "Continuous Improvement Cycles & Conflict Resolution",
        "subtitle": "Self-healing knowledge graphs that adapt dynamically as businesses evolve",
        "voice": (
            "Enterprise knowledge is never static. Sulcus drives continuous improvement cycles through automated conflict resolution. "
            "When team policies or infrastructure evolve, Sulcus dynamically supersedes obsolete memories and reconciles the "
            "knowledge graph, ensuring agents always act on current organizational truth."
        ),
        "render": "render_scene6",
    },
    {
        "id": "scene7_business_roi",
        "title": "Measurable Business Value & Enterprise ROI",
        "subtitle": "Transforming ephemeral conversational bots into compounding enterprise assets",
        "voice": (
            "The business impact is immediate: over eighty-five percent reduction in LLM context token expenses, complete elimination "
            "of repeated onboarding, and true long-term institutional continuity for agent swarms. Sulcus transforms ephemeral "
            "chatbots into compounding enterprise assets."
        ),
        "render": "render_scene7",
    },
]


def draw_card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, items: list[str], accent: tuple[int, int, int]):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(x1, y1), (x2, y1 + 6)], fill=accent)

    font_card_title = get_font(FONT_PATH_HEADING, 26)
    font_item = get_font(FONT_PATH_HEADING, 20)

    draw.text((x1 + 30, y1 + 30), title, fill=TEXT_WHITE, font=font_card_title)

    curr_y = y1 + 80
    for it in items:
        draw.ellipse([(x1 + 30, curr_y + 6), (x1 + 40, curr_y + 16)], fill=accent)
        draw.text((x1 + 55, curr_y), it, fill=TEXT_MUTED, font=font_item)
        curr_y += 45


def render_scene1(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    # 3 highlight cards
    cards = [
        ("Long-Term Continuity", ["Retains context across weeks & months", "Cross-session memory persistence", "Zero repeated user explanations"], CYAN_ACCENT),
        ("High-Precision Retrieval", ["Semantic concept & graph mapping", "Sub-50ms hybrid vector search", "Zero hallucination boundaries"], EMERALD_ACCENT),
        ("Universal Integration", ["Native Antigravity plugin ecosystem", "Model Context Protocol (Stdio & SSE)", "Local-first offline with cloud sync"], VIOLET_ACCENT),
    ]
    w = 540
    gap = 40
    start_x = 80
    for i, (title, items, accent) in enumerate(cards):
        x1 = start_x + i * (w + gap)
        draw_card(draw, (x1, 270, x1 + w, 820), title, items, accent)
    return canvas


def render_scene2(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    draw_card(draw, (80, 260, 920, 840), "Without Sulcus (Stateless Agents)", [
        "Session Amnesia: Every restart forgets architecture & rules",
        "Wasted Developer Hours: Constant repetitive prompt instructions",
        "Runaway Token Costs: 100k+ token histories stuffed every turn",
        "Degraded Latency: Massive context parsing delays response times",
        "Context Confusion: Older contradictory facts trigger mistakes",
        "Fragmented Silos: Individual agents cannot share discoveries"
    ], (239, 68, 68))

    draw_card(draw, (980, 260, 1840, 840), "With Sulcus (Enterprise Memory)", [
        "Zero-Friction Recall: Automatic context injection on prompt",
        "Compounding Intelligence: Institutional knowledge persists permanently",
        "85%+ Cost Reduction: Lightweight pointers replace prompt-stuffing",
        "Instant Sub-50ms Search: Hybrid HNSW vector + FTS retrieval",
        "Automated Conflict Resolution: Superseded policies pruned live",
        "Team Swarm Sync: Unified knowledge shared across agents"
    ], EMERALD_ACCENT)
    return canvas


def render_scene3(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_code = get_font(FONT_PATH_CODE, 18)
    font_bold = get_font(FONT_PATH_HEADING, 24)

    draw_card(draw, (80, 260, 920, 840), "The Map (High-Speed Working Memory)", [
        "Lightweight semantic pointers & vector embeddings",
        "Kept ultra-compact in working context window",
        "Scanned effortlessly without latency penalty",
        "High-density concept topology"
    ], CYAN_ACCENT)

    draw_card(draw, (980, 260, 1840, 840), "The Territory (Deep Data on Demand)", [
        "Full raw codebases, specs, and execution logs",
        "Paged in selectively only upon explicit page fault",
        "Preserves precious token window budget",
        "Infinite horizontal scale"
    ], GOLD_ACCENT)

    # Architectural flow banner
    draw.rounded_rectangle([(140, 680), (1780, 800)], radius=10, fill=(30, 36, 46), outline=CYAN_ACCENT, width=1)
    draw.text((180, 715), "VMMU Architecture:   Prompt  -->  Semantic Vector Match  -->  Pointer Injection  -->  Targeted Page-In", fill=CYAN_ACCENT, font=font_bold)
    return canvas


def render_scene4(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_code = get_font(FONT_PATH_CODE, 18)
    font_bold = get_font(FONT_PATH_HEADING, 22)

    # Box 1: Inbound User Prompt
    draw.rounded_rectangle((80, 260, 880, 480), radius=10, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.text((110, 285), "1. Inbound User Request", fill=CYAN_ACCENT, font=font_bold)
    draw.text((110, 335), '"Deploy our background worker to production."', fill=TEXT_WHITE, font=font_code)
    draw.text((110, 385), "// No manual context, credentials, or instructions provided by user.", fill=TEXT_MUTED, font=font_code)

    # Box 2: Proactive Recall Injection
    draw.rounded_rectangle((80, 520, 880, 840), radius=10, fill=CARD_BG, outline=EMERALD_ACCENT, width=2)
    draw.text((110, 545), "2. Proactive Context Injected by Sulcus Hook", fill=EMERALD_ACCENT, font=font_bold)
    sample_inject = (
        "<sulcus-memories>\n"
        "1. [policy] Deployments strictly use Kubernetes via ArgoCD.\n"
        "2. [config] Production worker namespace is 'prod-services'.\n"
        "3. [fact] Container registry is registry.internal.company.com.\n"
        "</sulcus-memories>"
    )
    draw.text((110, 600), sample_inject, fill=TEXT_WHITE, font=font_code)

    # Box 3: Agent Output
    draw.rounded_rectangle((940, 260, 1840, 840), radius=10, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.text((970, 285), "3. Autonomous Execution Without Hallucination", fill=VIOLET_ACCENT, font=font_bold)
    agent_msg = (
        "Agent Plan Executed:\n\n"
        "  1. Prepared deployment manifest targeting namespace 'prod-services'.\n"
        "  2. Built image and tagged for registry.internal.company.com.\n"
        "  3. Pushed GitOps commit to ArgoCD repository.\n"
        "  4. Sync status confirmed: healthy & synchronized.\n\n"
        "Outcome: Successful deploy with zero human onboarding required."
    )
    draw.text((970, 350), agent_msg, fill=TEXT_WHITE, font=font_code)
    return canvas


def render_scene5(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    cards = [
        ("Antigravity Plugin", ["Native CLI lifecycle hook integration", "Automatic pre-invocation prompt enrichment", "Zero-config background capture sidecar"], CYAN_ACCENT),
        ("Model Context Protocol", ["Standardized MCP tool & resource bridge", "Stdio mode for local-first desktop agents", "Enterprise Server-Sent Events (SSE) gateway"], EMERALD_ACCENT),
        ("Libraries & Daemons", ["High-performance Rust core engine", "Python SDK for agentic pipelines", "Local daemon (4203) with delta cloud sync"], GOLD_ACCENT),
    ]
    w = 540
    gap = 40
    start_x = 80
    for i, (title, items, accent) in enumerate(cards):
        x1 = start_x + i * (w + gap)
        draw_card(draw, (x1, 270, x1 + w, 820), title, items, accent)
    return canvas


def render_scene6(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_code = get_font(FONT_PATH_CODE, 18)
    font_bold = get_font(FONT_PATH_HEADING, 24)

    draw_card(draw, (80, 260, 920, 840), "Automated Conflict Resolution", [
        "Detects contradiction when requirements or policies shift",
        "Supersedes stale memories without human manual cleanup",
        "Prevents outdated configurations from polluting prompt context",
        "Maintains temporal freshness ordering for evolving facts"
    ], VIOLET_ACCENT)

    draw_card(draw, (980, 260, 1840, 840), "Self-Healing Knowledge Graph", [
        "Automatic entity extraction and graph relationship linking",
        "Surfaces cross-session connections between related components",
        "Multi-tenant isolation with strict encryption and ACLs",
        "Continuous test-time learning from operational outcomes"
    ], EMERALD_ACCENT)
    return canvas


def render_scene7(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_stat = get_font(FONT_PATH_HEADING, 56)
    font_lbl = get_font(FONT_PATH_HEADING, 22)

    stats = [
        ("85%+", "Token Cost Reduction", "Eliminates prompt-stuffing with lightweight pointers", CYAN_ACCENT),
        ("100%", "Recall Precision", "Zero needle loss across multi-thousand token contexts", EMERALD_ACCENT),
        ("< 50ms", "Hybrid Search Latency", "Vector and full-text search combined in real time", GOLD_ACCENT),
        ("10x", "Developer Velocity", "Agents remember infrastructure, policies, and workflows", VIOLET_ACCENT),
    ]

    w = 400
    gap = 35
    start_x = 80
    for i, (stat, title, desc, accent) in enumerate(stats):
        x1 = start_x + i * (w + gap)
        box = (x1, 280, x1 + w, 780)
        draw.rounded_rectangle(box, radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
        draw.rectangle([(x1, 280), (x1 + w, 286)], fill=accent)
        draw.text((x1 + 30, 330), stat, fill=accent, font=font_stat)
        draw.text((x1 + 30, 420), title, fill=TEXT_WHITE, font=font_lbl)
        
        # Word wrap description
        words = desc.split()
        lines = []
        curr = []
        for word in words:
            if len(" ".join(curr + [word])) > 24:
                lines.append(" ".join(curr))
                curr = [word]
            else:
                curr.append(word)
        if curr:
            lines.append(" ".join(curr))

        font_desc = get_font(FONT_PATH_HEADING, 18)
        y = 480
        for l in lines:
            draw.text((x1 + 30, y), l, fill=TEXT_MUTED, font=font_desc)
            y += 30

    return canvas


def get_audio_duration(file_path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    out = subprocess.check_output(cmd).decode().strip()
    return float(out)


def main():
    print("Building Sulcus Enterprise Architecture & Business Value Video...")
    output_dir = "videos"
    os.makedirs(output_dir, exist_ok=True)
    temp_dir = tempfile.mkdtemp(prefix="sulcus_arch_video_")

    scene_clips = []

    try:
        for idx, scene in enumerate(SCENES):
            print(f"  Rendering [{idx+1}/{len(SCENES)}] {scene['id']}...")
            # 1. Generate Voice Narration
            m4a_path = os.path.join(temp_dir, f"{scene['id']}.m4a")
            audio_duration = generate_voice(scene["voice"], m4a_path)
            duration = audio_duration + 1.0  # +1.0s breath pause
            frame_count = int(duration * FPS)

            # 2. Render Slide Image
            canvas = create_base_canvas(scene["title"], scene["subtitle"])
            render_func = globals()[scene["render"]]
            rendered_img = render_func(canvas)
            img_path = os.path.join(temp_dir, f"{scene['id']}.png")
            rendered_img.save(img_path)

            # 3. Create Scene MP4 with static slide + narration
            clip_path = os.path.join(temp_dir, f"{scene['id']}.mp4")
            cmd = [
                "ffmpeg", "-y",
                "-loop", "1", "-i", img_path,
                "-i", m4a_path,
                "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                "-t", str(duration),
                clip_path
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            scene_clips.append(clip_path)

        # 4. Concatenate all scene clips into final video
        concat_list = os.path.join(temp_dir, "concat.txt")
        with open(concat_list, "w") as f:
            for clip in scene_clips:
                f.write(f"file '{clip}'\n")

        final_output = os.path.join(output_dir, "sulcus_enterprise_value_and_architecture.mp4")
        print("  Concatenating scenes into final video...")
        cmd_concat = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
            "-c", "copy", final_output
        ]
        subprocess.run(cmd_concat, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        print(f"\nSuccessfully generated: {final_output}")
        dur = get_audio_duration(final_output)
        size_mb = os.path.getsize(final_output) / (1024 * 1024)
        print(f"Duration: {dur:.1f}s | Size: {size_mb:.2f} MB")

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
