#!/usr/bin/env python3
"""Renders the 45-Second Sulcus Enterprise Sizzle Video.

Generates a broadcast-quality 1080p MP4 video with articulate British narration,
hitting on the top value points:
1. Ending the Enterprise Amnesia Tax
2. Semantic VMMU: Map vs. Territory (85%+ context savings)
3. Proactive Context Engine & Open Ecosystem (Antigravity Plugin, MCP, SDKs)
4. Proven Industry Benchmarks (100% Google NIAH & DeepMind Evo-Memory)
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
BG_COLOR = (11, 15, 23)        # Sleek dark obsidian
CARD_BG = (19, 24, 35)         # Elevated dark card
CARD_BORDER = (45, 55, 72)     # Clean border
TEXT_WHITE = (248, 250, 252)   # High-contrast white
TEXT_MUTED = (148, 163, 184)   # Slate muted
CYAN_ACCENT = (56, 189, 248)   # Electric cyan
EMERALD_ACCENT = (52, 211, 153)# Emerald green
VIOLET_ACCENT = (167, 139, 250)# Purple/violet
ROSE_ACCENT = (244, 63, 94)    # Warning rose
GOLD_ACCENT = (251, 191, 36)   # Gold accent

FONT_PATH_HEADING = "/System/Library/Fonts/Helvetica.ttc"
FONT_PATH_CODE = "/System/Library/Fonts/Menlo.ttc"


def get_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def create_base_canvas(title: str, subtitle: str, badge: str = "ENTERPRISE SIZZLE") -> Image.Image:
    """Create standard high-energy enterprise canvas."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Top energy gradient accent
    draw.rectangle([(0, 0), (WIDTH, 8)], fill=CYAN_ACCENT)

    # Top brand bar
    font_brand = get_font(FONT_PATH_HEADING, 28)
    font_cat = get_font(FONT_PATH_HEADING, 18)
    draw.text((80, 48), "SULCUS", fill=CYAN_ACCENT, font=font_brand)
    draw.text((210, 56), "|   Autonomous Agent Memory Platform", fill=TEXT_MUTED, font=font_cat)

    # Pill badge on top right
    font_badge = get_font(FONT_PATH_HEADING, 15)
    badge_box = (WIDTH - 300, 48, WIDTH - 80, 84)
    draw.rounded_rectangle(badge_box, radius=18, fill=(30, 41, 59), outline=CYAN_ACCENT, width=1)
    draw.text((WIDTH - 275, 57), badge, fill=CYAN_ACCENT, font=font_badge)

    # Big Title & Subtitle
    font_title = get_font(FONT_PATH_HEADING, 52)
    font_sub = get_font(FONT_PATH_HEADING, 24)
    draw.text((80, 115), title, fill=TEXT_WHITE, font=font_title)
    draw.text((80, 185), subtitle, fill=TEXT_MUTED, font=font_sub)

    return img


# ==============================================================================
# Scene 1: The Enterprise Amnesia Tax (10s)
# ==============================================================================
def render_scene1(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    
    font_hdr = get_font(FONT_PATH_HEADING, 26)
    font_sub = get_font(FONT_PATH_HEADING, 18)
    font_body = get_font(FONT_PATH_HEADING, 20)

    # Left Card: The Problem (Red / Rose)
    x1, y1, x2, y2 = 80, 270, 920, 880
    draw.rounded_rectangle((x1, y1, x2, y2), radius=16, fill=CARD_BG, outline=ROSE_ACCENT, width=2)
    draw.rectangle([(x1, y1), (x2, y1 + 8)], fill=ROSE_ACCENT)
    
    draw.text((x1 + 40, y1 + 35), "WITHOUT SULCUS: THE AMNESIA TAX", fill=ROSE_ACCENT, font=font_hdr)
    draw.text((x1 + 40, y1 + 75), "Stateless AI Sessions & Fragmented Knowledge", fill=TEXT_MUTED, font=font_sub)

    problem_points = [
        ("Runaway Prompt Bloat", "Re-injecting thousands of lines of context on every run"),
        ("Severe Context Drift", "Agents lose architectural standards and hallucinate obsolete paths"),
        ("Wasted Compute Budget", "Enterprises spend millions in recurring tokens for zero memory retention"),
        ("Siloed Reasoning", "Agent findings vanish the moment the CLI session terminates")
    ]
    y_offset = y1 + 140
    for title, desc in problem_points:
        draw.ellipse([(x1 + 40, y_offset + 8), (x1 + 52, y_offset + 20)], fill=ROSE_ACCENT)
        draw.text((x1 + 65, y_offset + 5), title, fill=TEXT_WHITE, font=font_body)
        draw.text((x1 + 65, y_offset + 35), desc, fill=TEXT_MUTED, font=font_sub)
        y_offset += 105

    # Right Card: The Solution (Cyan / Emerald)
    rx1, ry1, rx2, ry2 = 980, 270, 1840, 880
    draw.rounded_rectangle((rx1, ry1, rx2, ry2), radius=16, fill=CARD_BG, outline=CYAN_ACCENT, width=2)
    draw.rectangle([(rx1, ry1), (rx2, ry1 + 8)], fill=CYAN_ACCENT)

    draw.text((rx1 + 40, ry1 + 35), "WITH SULCUS: PERSISTENT INTELLIGENCE", fill=CYAN_ACCENT, font=font_hdr)
    draw.text((rx1 + 40, ry1 + 75), "Unified Shared Memory Layer for All Enterprise Agents", fill=TEXT_MUTED, font=font_sub)

    sol_points = [
        ("Semantic Virtual Memory", "Pointers live in context; heavy knowledge paged on demand"),
        ("Proactive Ingestion & Recall", "Lifecycle hooks enrich agent prompts with zero manual queries"),
        ("Zero Knowledge Loss", "Cross-session learnings compound into institutional knowledge"),
        ("Continuous Self-Healing", "Automatic decay of stale facts & dynamic graph reconciliation")
    ]
    y_offset = ry1 + 140
    for title, desc in sol_points:
        draw.ellipse([(rx1 + 40, y_offset + 8), (rx1 + 52, y_offset + 20)], fill=EMERALD_ACCENT)
        draw.text((rx1 + 65, y_offset + 5), title, fill=TEXT_WHITE, font=font_body)
        draw.text((rx1 + 65, y_offset + 35), desc, fill=TEXT_MUTED, font=font_sub)
        y_offset += 105

    return canvas


# ==============================================================================
# Scene 2: Semantic VMMU: Map vs. Territory (11s)
# ==============================================================================
def render_scene2(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)

    font_huge = get_font(FONT_PATH_HEADING, 84)
    font_hdr = get_font(FONT_PATH_HEADING, 28)
    font_sub = get_font(FONT_PATH_HEADING, 20)
    font_body = get_font(FONT_PATH_HEADING, 18)
    font_code = get_font(FONT_PATH_CODE, 17)

    # Hero Stat Banner
    draw.rounded_rectangle((80, 260, 520, 880), radius=16, fill=CARD_BG, outline=EMERALD_ACCENT, width=2)
    draw.rectangle([(80, 260), (520, 268)], fill=EMERALD_ACCENT)
    
    draw.text((120, 340), "85%+", fill=EMERALD_ACCENT, font=font_huge)
    draw.text((120, 450), "Context Window Token Reduction", fill=TEXT_WHITE, font=font_hdr)
    draw.text((120, 530), "Eliminates prompt bloat while guaranteeing full access to infinite institutional history.", fill=TEXT_MUTED, font=font_sub)

    # Architecture Explanation (Center & Right)
    box_x1, box_y1, box_x2, box_y2 = 560, 260, 1840, 880
    draw.rounded_rectangle((box_x1, box_y1, box_x2, box_y2), radius=16, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(box_x1, box_y1), (box_x2, box_y1 + 8)], fill=CYAN_ACCENT)

    draw.text((box_x1 + 40, box_y1 + 35), "THE TWO-TIER SEMANTIC MEMORY ARCHITECTURE", fill=CYAN_ACCENT, font=font_hdr)
    draw.text((box_x1 + 40, box_y1 + 75), "Strict separation between in-context indexing and physical memory storage", fill=TEXT_MUTED, font=font_sub)

    # Step 1: The Map
    c1_x1, c1_y1, c1_x2, c1_y2 = box_x1 + 40, box_y1 + 130, box_x1 + 600, box_y2 - 50
    draw.rounded_rectangle((c1_x1, c1_y1, c1_x2, c1_y2), radius=12, fill=(15, 23, 42), outline=CYAN_ACCENT, width=1)
    draw.text((c1_x1 + 25, c1_y1 + 25), "TIER 1: THE MAP", fill=CYAN_ACCENT, font=font_hdr)
    draw.text((c1_x1 + 25, c1_y1 + 65), "Lightweight In-Context Pointers", fill=TEXT_MUTED, font=font_body)

    code_map = """// In-Context Pointer (< 0.2 KB)
{
  "node_id": "01a13609-...",
  "type": "architectural_decision",
  "summary": "Deploy via local forge toolkit",
  "heat_rank": 0.98,
  "status": "paged_out"
}"""
    draw.text((c1_x1 + 25, c1_y1 + 120), code_map, fill=(186, 230, 253), font=font_code)

    # Arrow Fault Trigger
    draw.line([(box_x1 + 615, 570), (box_x1 + 665, 570)], fill=GOLD_ACCENT, width=4)
    draw.polygon([(box_x1 + 675, 570), (box_x1 + 660, 560), (box_x1 + 660, 580)], fill=GOLD_ACCENT)
    draw.text((box_x1 + 610, 525), "PAGE FAULT", fill=GOLD_ACCENT, font=get_font(FONT_PATH_HEADING, 14))

    # Step 2: The Territory
    c2_x1, c2_y1, c2_x2, c2_y2 = box_x1 + 680, box_y1 + 130, box_x2 - 40, box_y2 - 50
    draw.rounded_rectangle((c2_x1, c2_y1, c2_x2, c2_y2), radius=12, fill=(15, 23, 42), outline=EMERALD_ACCENT, width=1)
    draw.text((c2_x1 + 25, c2_y1 + 25), "TIER 2: THE TERRITORY", fill=EMERALD_ACCENT, font=font_hdr)
    draw.text((c2_x1 + 25, c2_y1 + 65), "On-Demand Full Resolution Paged In", fill=TEXT_MUTED, font=font_body)

    code_terr = """// Paged In Territory (Full Resolution)
{
  "full_content": "All deployments must go 
   through forge-deploy.sh. Rust AMD64 
   cross-compilation occurs locally in Docker. 
   Never compile on remote VPS nodes.",
  "dependencies": ["Janus", "Cerberus", "Hades"],
  "last_verified": "2026-10-13T09:12:00Z"
}"""
    draw.text((c2_x1 + 25, c2_y1 + 120), code_terr, fill=(187, 247, 208), font=font_code)

    return canvas


# ==============================================================================
# Scene 3: Proactive Recall & Open Ecosystem (12s)
# ==============================================================================
def render_scene3(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)

    font_hdr = get_font(FONT_PATH_HEADING, 26)
    font_sub = get_font(FONT_PATH_HEADING, 18)
    font_card_title = get_font(FONT_PATH_HEADING, 22)
    font_body = get_font(FONT_PATH_HEADING, 17)

    pillars = [
        (
            "Native Antigravity Plugin",
            "sulcus-agy",
            "Autonomous PreInvocation hooks automatically fetch relevant institutional memory and inject it into agent prompts prior to LLM execution. Zero custom prompt engineering required.",
            CYAN_ACCENT,
            [("PreInvocation", "Zero-latency proactive prompt enrichment"),
             ("Background Capture", "Transparent episodic memory recording"),
             ("Deterministic Sync", "UUIDv5 mapped cascade persistence")]
        ),
        (
            "Model Context Protocol",
            "sulcus-mcp",
            "Standardized MCP protocol support via Stdio and SSE. Plugs seamlessly into Claude Desktop, Cursor, Cline, and any MCP-compliant agent harness across your organization.",
            VIOLET_ACCENT,
            [("Stdio Transport", "Local single-binary execution"),
             ("SSE Transport", "Enterprise remote bridge connectivity"),
             ("Open Tool Specs", "Native recall, page, and assert tools")]
        ),
        (
            "Production Client SDKs",
            "Rust & Python",
            "First-class client libraries and offline-first daemon. Local SQLite/Postgres storage with encrypted enterprise delta sync for multi-agent team collaboration.",
            EMERALD_ACCENT,
            [("Offline-First", "100% operational without cloud connectivity"),
             ("Enterprise Sync", "Encrypted delta replication to SaaS server"),
             ("Self-Healing Graph", "Dynamic ranking & automated decay of stale nodes")]
        )
    ]

    card_w = 540
    gap = 40
    start_x = 80
    for i, (title, subtitle, desc, accent, bullets) in enumerate(pillars):
        x1 = start_x + i * (card_w + gap)
        y1 = 260
        x2 = x1 + card_w
        y2 = 880

        draw.rounded_rectangle((x1, y1, x2, y2), radius=16, fill=CARD_BG, outline=CARD_BORDER, width=2)
        draw.rectangle([(x1, y1), (x2, y1 + 8)], fill=accent)

        draw.text((x1 + 30, y1 + 35), title, fill=TEXT_WHITE, font=font_card_title)
        draw.text((x1 + 30, y1 + 70), subtitle, fill=accent, font=get_font(FONT_PATH_CODE, 17))

        # Description
        words = desc.split()
        lines, curr = [], []
        for w in words:
            if len(" ".join(curr + [w])) > 36:
                lines.append(" ".join(curr))
                curr = [w]
            else:
                curr.append(w)
        if curr:
            lines.append(" ".join(curr))
        
        y_text = y1 + 115
        for l in lines:
            draw.text((x1 + 30, y_text), l, fill=TEXT_MUTED, font=font_body)
            y_text += 26

        # Bullets
        y_b = y_text + 25
        for b_title, b_desc in bullets:
            draw.ellipse([(x1 + 30, y_b + 5), (x1 + 40, y_b + 15)], fill=accent)
            draw.text((x1 + 50, y_b), b_title, fill=TEXT_WHITE, font=get_font(FONT_PATH_HEADING, 18))
            draw.text((x1 + 50, y_b + 24), b_desc, fill=TEXT_MUTED, font=get_font(FONT_PATH_HEADING, 15))
            y_b += 65

    return canvas


# ==============================================================================
# Scene 4: Proven Industry Benchmarks & ROI (12s)
# ==============================================================================
def render_scene4(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)

    font_badge = get_font(FONT_PATH_HEADING, 44)
    font_title = get_font(FONT_PATH_HEADING, 24)
    font_desc = get_font(FONT_PATH_HEADING, 18)

    # 4 Quadrants of Benchmark Proof
    benchmarks = [
        ("100.0%", "Google Multi-Needle (NIAH)", "Zero retrieval failure across 0% to 100% token depths and long horizons", CYAN_ACCENT),
        ("100.0%", "Google DeepMind Evo-Memory", "ExpRAG experience reuse and test-time learning from past incidents", EMERALD_ACCENT),
        ("100.0%", "Dynamic Conflict (ReMem)", "Supersedes obsolete architectural decisions with zero semantic drift", VIOLET_ACCENT),
        ("99.0%", "Composite Enterprise Suite", "BABILong multi-hop reasoning + SulcusBench production evaluation", GOLD_ACCENT),
    ]

    grid_w = 840
    grid_h = 240
    start_x = 80
    start_y = 260

    coords = [
        (start_x, start_y),
        (start_x + grid_w + 40, start_y),
        (start_x, start_y + grid_h + 30),
        (start_x + grid_w + 40, start_y + grid_h + 30),
    ]

    for (stat, title, desc, accent), (x, y) in zip(benchmarks, coords):
        draw.rounded_rectangle((x, y, x + grid_w, y + grid_h), radius=14, fill=CARD_BG, outline=CARD_BORDER, width=2)
        draw.rectangle([(x, y), (x + 8, y + grid_h)], fill=accent)

        draw.text((x + 35, y + 40), stat, fill=accent, font=font_badge)
        draw.text((x + 220, y + 42), title, fill=TEXT_WHITE, font=font_title)
        
        # Word wrap description
        words = desc.split()
        lines, curr = [], []
        for w in words:
            if len(" ".join(curr + [w])) > 45:
                lines.append(" ".join(curr))
                curr = [w]
            else:
                curr.append(w)
        if curr:
            lines.append(" ".join(curr))

        line_y = y + 90
        for l in lines:
            draw.text((x + 220, line_y), l, fill=TEXT_MUTED, font=font_desc)
            line_y += 28

    # Bottom Big Banner
    ban_y1 = 800
    ban_y2 = 910
    draw.rounded_rectangle((start_x, ban_y1, WIDTH - 80, ban_y2), radius=14, fill=(15, 23, 42), outline=CYAN_ACCENT, width=2)
    font_callout = get_font(FONT_PATH_HEADING, 28)
    font_subcallout = get_font(FONT_PATH_HEADING, 19)
    draw.text((start_x + 40, ban_y1 + 22), "SULCUS: MEMORY-AS-A-SERVICE FOR AUTONOMOUS AGENTS", fill=CYAN_ACCENT, font=font_callout)
    draw.text((start_x + 40, ban_y1 + 65), "Persistent Institutional Intelligence That Compounds in Value with Every Execution.", fill=TEXT_WHITE, font=font_subcallout)

    return canvas


# ==============================================================================
# Sizzle Scenes Specification (~45 seconds total)
# ==============================================================================
SIZZLE_SCENES = [
    {
        "id": "sizzle_scene1_tax",
        "title": "ELIMINATING THE ENTERPRISE AMNESIA TAX",
        "subtitle": "Why Stateless AI Agents Waste Millions in Redundant Compute",
        "voice": "Every single day, enterprise AI agents waste millions in compute relearning the exact same institutional context. Sulcus ends the amnesia tax forever.",
        "render": "render_scene1",
    },
    {
        "id": "sizzle_scene2_vmmu",
        "title": "SEMANTIC VMMU: MAP VERSUS TERRITORY",
        "subtitle": "Paging Deep Knowledge on Demand While Slashing Prompt Bloat",
        "voice": "Our Semantic Virtual Memory Architecture separates the lightweight map from the heavy territory. Paging deep knowledge on demand and slashing context bloat by over eighty-five percent.",
        "render": "render_scene2",
    },
    {
        "id": "sizzle_scene3_proactive",
        "title": "AUTONOMOUS PROACTIVE RECALL & ECOSYSTEM",
        "subtitle": "Antigravity Native Plugins, Open Model Context Protocol, and Production SDKs",
        "voice": "Zero manual prompt engineering. The proactive context engine automatically enriches agent workflows before invocation, across Antigravity plugins, open Model Context Protocol, and native client SDKs.",
        "render": "render_scene3",
    },
    {
        "id": "sizzle_scene4_proof",
        "title": "VERIFIED WITH 100% RECALL ACROSS BENCHMARKS",
        "subtitle": "Google Multi-Needle, DeepMind Evo-Memory, and BABILong Reasoning",
        "voice": "Proven with one hundred percent recall on Google NIAH and DeepMind benchmarks. Memory that heals, adapts, and compounds in value with every execution. This is Sulcus.",
        "render": "render_scene4",
    },
]


def main():
    print("Building Sulcus 45-Second Enterprise Sizzle Video...")
    output_dir = "videos"
    os.makedirs(output_dir, exist_ok=True)
    temp_dir = tempfile.mkdtemp(prefix="sulcus_sizzle_")

    scene_clips = []

    try:
        for idx, scene in enumerate(SIZZLE_SCENES):
            print(f"  Rendering [{idx+1}/{len(SIZZLE_SCENES)}] {scene['id']}...")
            # 1. Voice Narration (British George / Daniel fallback)
            m4a_path = os.path.join(temp_dir, f"{scene['id']}.m4a")
            audio_duration = generate_voice(scene["voice"], m4a_path, voice="george")
            duration = audio_duration + 0.8  # tight, crisp 0.8s breath pause for high-energy sizzle
            frame_count = int(duration * FPS)

            # 2. Render Slide
            canvas = create_base_canvas(scene["title"], scene["subtitle"], badge="45s ENTERPRISE SIZZLE")
            render_func = globals()[scene["render"]]
            rendered_img = render_func(canvas)
            img_path = os.path.join(temp_dir, f"{scene['id']}.png")
            rendered_img.save(img_path)

            # 3. Compile Scene Clip
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

        # 4. Concatenate Scenes
        concat_list = os.path.join(temp_dir, "concat.txt")
        with open(concat_list, "w") as f:
            for clip in scene_clips:
                f.write(f"file '{clip}'\n")

        final_output = os.path.join(output_dir, "sulcus_45s_enterprise_sizzle.mp4")
        print("  Concatenating scenes into final sizzle reel...")
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
