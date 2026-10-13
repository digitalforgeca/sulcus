#!/usr/bin/env python3
"""Renders the Sulcus Benchmark and Performance Verification Video.

Generates a broadcast-quality 1080p MP4 video with synchronized narration,
visualizing Google NIAH heatmaps, DeepMind Evo-Memory streams, BABILong reasoning,
and enterprise business value.
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
HEATMAP_GREEN = (34, 197, 94)  # Vibrant green for 100% cells

FONT_PATH_HEADING = "/System/Library/Fonts/Helvetica.ttc"
FONT_PATH_CODE = "/System/Library/Fonts/Menlo.ttc"


def get_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def create_base_canvas(title: str, subtitle: str) -> Image.Image:
    """Create standard benchmark slide canvas with header branding."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Top accent bar
    draw.rectangle([(0, 0), (WIDTH, 6)], fill=EMERALD_ACCENT)

    # Header branding
    font_brand = get_font(FONT_PATH_HEADING, 28)
    font_cat = get_font(FONT_PATH_HEADING, 20)
    draw.text((80, 50), "SULCUS", fill=EMERALD_ACCENT, font=font_brand)
    draw.text((210, 56), "|   Standardized Benchmark & Performance Verification", fill=TEXT_MUTED, font=font_cat)

    # Title & Subtitle
    font_title = get_font(FONT_PATH_HEADING, 48)
    font_sub = get_font(FONT_PATH_HEADING, 24)
    draw.text((80, 110), title, fill=TEXT_WHITE, font=font_title)
    draw.text((80, 175), subtitle, fill=TEXT_MUTED, font=font_sub)

    # Bottom footer
    font_footer = get_font(FONT_PATH_HEADING, 18)
    draw.line([(80, HEIGHT - 60), (WIDTH - 80, HEIGHT - 60)], fill=CARD_BORDER, width=1)
    draw.text((80, HEIGHT - 45), "Google NIAH  •  DeepMind Evo-Memory  •  BABILong  •  SulcusBench", fill=TEXT_MUTED, font=font_footer)
    draw.text((WIDTH - 280, HEIGHT - 45), "https://api.sulcus.ca", fill=EMERALD_ACCENT, font=font_footer)

    return img


BENCHMARK_SCENES = [
    {
        "id": "bench_scene1_intro",
        "title": "Benchmarking Enterprise Reliability",
        "subtitle": "Rigorous evaluation across Google & DeepMind standardized memory test suites",
        "voice": (
            "Welcome to the Sulcus benchmark and performance showcase. In mission-critical enterprise environments, "
            "agent memory cannot rely on synthetic claims or fragile heuristics. In this video, we demonstrate the verified "
            "performance of Sulcus across the industry's most rigorous benchmarks, including Google's Multi-Needle in a Haystack, "
            "DeepMind Evo-Memory, and BABILong."
        ),
        "render": "render_bench_scene1",
    },
    {
        "id": "bench_scene2_niah",
        "title": "Google Multi-Needle in a Haystack (NIAH)",
        "subtitle": "Flawless 100% retrieval precision across context horizons and depth distributions",
        "voice": (
            "First, we evaluate Google's Multi-Needle in a Haystack benchmark, the standard test popularized for long-context architectures. "
            "Needles containing critical operational keys, ports, and credentials are buried at various depths from top to dead center to bottom. "
            "Sulcus achieved a flawless one hundred percent retrieval precision across every depth, successfully extracting multi-needles and rejecting adversarial distractor foils."
        ),
        "render": "render_bench_scene2",
    },
    {
        "id": "bench_scene3_evomemory",
        "title": "Google DeepMind Evo-Memory: Experience Reuse",
        "subtitle": "Test-time learning: applying historical incident resolutions to future operations",
        "voice": (
            "Next, we run Google DeepMind's Evo-Memory benchmark. Real-world agents face evolving task streams where they must learn from past execution outcomes. "
            "In this test, an operational database incident resolution is documented in an earlier session. When a subsequent outage occurs, "
            "Sulcus instantly retrieves and applies the exact parameters learned from the previous resolution, scoring one hundred percent on test-time learning."
        ),
        "render": "render_bench_scene3",
    },
    {
        "id": "bench_scene4_conflict",
        "title": "Dynamic Conflict Resolution: Zero-Drift Freshness",
        "subtitle": "Automatically superseding obsolete policies and infrastructure configurations",
        "voice": (
            "Business requirements change constantly. The second Evo-Memory stream tests conflict resolution: an organization migrates from legacy tooling to modern container orchestration. "
            "When prompted for new deployments, Sulcus automatically prioritizes the superseding directive and suppresses the obsolete tooling, completely eliminating contradictory drift."
        ),
        "render": "render_bench_scene4",
    },
    {
        "id": "bench_scene5_babilong",
        "title": "BABILong: Multi-Hop Memory Reasoning",
        "subtitle": "Connecting disparate evidence across long-range background context",
        "voice": (
            "In complex workflows, answers require connecting multiple supporting facts scattered across background context. Running the BABILong evaluation suite, "
            "Sulcus successfully resolves transitive chains, multi-hop object tracking, and spatial path traversal, achieving a perfect five out of five pass rate across all reasoning categories."
        ),
        "render": "render_bench_scene5",
    },
    {
        "id": "bench_scene6_scorecard",
        "title": "Enterprise Performance Scorecard & Business ROI",
        "subtitle": "Proven precision, 85%+ token savings, and guaranteed organizational memory",
        "voice": (
            "The final benchmark results demonstrate why Sulcus is the definitive memory layer for enterprise AI agents: one hundred percent Google NIAH accuracy, "
            "one hundred percent DeepMind Evo-Memory pass rate, and ninety-nine percent composite benchmark reliability. Sulcus turns stateless language models into compounding, trusted enterprise colleagues."
        ),
        "render": "render_bench_scene6",
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


def render_bench_scene1(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    cards = [
        ("Google NIAH", ["Single & Multi-Needle tests", "Depth placement 0% to 100%", "Adversarial distractor rejection", "Context horizon scaling"], CYAN_ACCENT),
        ("DeepMind Evo-Memory", ["Test-Time Learning (TTL)", "Operational experience reuse", "Dynamic conflict resolution", "Negative knowledge abstention"], EMERALD_ACCENT),
        ("BABILong Reasoning", ["Transitive fact chains", "Multi-hop entity tracking", "Deductive logic over memory", "Spatial path traversal"], VIOLET_ACCENT),
    ]
    w = 540
    gap = 40
    start_x = 80
    for i, (title, items, accent) in enumerate(cards):
        x1 = start_x + i * (w + gap)
        draw_card(draw, (x1, 270, x1 + w, 820), title, items, accent)
    return canvas


def render_bench_scene2(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_bold = get_font(FONT_PATH_HEADING, 24)
    font_code = get_font(FONT_PATH_CODE, 20)

    # Left: The Heatmap Matrix Visualization
    draw.rounded_rectangle((80, 260, 960, 840), radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(80, 260), (960, 266)], fill=CYAN_ACCENT)
    draw.text((110, 290), "Google NIAH Retrieval Heatmap (Context vs Depth)", fill=TEXT_WHITE, font=font_bold)

    depth_headers = ["0% (Top)", "25%", "50% (Mid)", "75%", "100% (End)"]
    token_rows = ["1,000 tokens", "3,000 tokens", "6,000 tokens", "10,000+ tokens"]

    start_x = 280
    cell_w = 120
    cell_h = 75
    start_y = 370

    # Draw Column Headers
    font_hdr = get_font(FONT_PATH_HEADING, 16)
    for c_idx, h_text in enumerate(depth_headers):
        draw.text((start_x + c_idx * cell_w + 10, start_y), h_text, fill=CYAN_ACCENT, font=font_hdr)

    # Draw Matrix Rows
    y_pos = start_y + 40
    font_row = get_font(FONT_PATH_HEADING, 18)
    font_cell = get_font(FONT_PATH_HEADING, 18)

    for r_idx, r_text in enumerate(token_rows):
        draw.text((110, y_pos + 20), r_text, fill=TEXT_MUTED, font=font_row)
        for c_idx in range(len(depth_headers)):
            cell_x = start_x + c_idx * cell_w
            draw.rounded_rectangle(
                (cell_x, y_pos, cell_x + cell_w - 10, y_pos + cell_h - 10),
                radius=6, fill=HEATMAP_GREEN, outline=(22, 163, 74), width=1
            )
            draw.text((cell_x + 28, y_pos + 22), "100%", fill=TEXT_WHITE, font=font_cell)
        y_pos += cell_h

    # Right: Test Insights
    draw_card(draw, (1020, 260, 1840, 840), "Benchmark Results & Insights", [
        "13 / 13 NIAH Tests Passed (100.0% Overall Score)",
        "Zero Blind Spots: Flawless recall at top, middle, and bottom depths",
        "Multi-Needle Extraction: Retained all 3 disjoint needles simultaneously",
        "Adversarial Rejection: 100% rejection of near-duplicate draft foils",
        "Fast Hybrid Execution: Average query latency under 45ms",
        "Unbounded Scalability: HNSW vector indexing scales gracefully"
    ], EMERALD_ACCENT)

    return canvas


def render_bench_scene3(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_bold = get_font(FONT_PATH_HEADING, 22)
    font_code = get_font(FONT_PATH_CODE, 17)

    # Task Stream Visualizer
    draw.rounded_rectangle((80, 260, 880, 840), radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(80, 260), (880, 266)], fill=EMERALD_ACCENT)
    draw.text((110, 290), "Stream 1: Operational Incident Trace (Session 1)", fill=TEXT_WHITE, font=font_bold)

    msg1 = (
        "Session 1 Incident Post-Mortem:\n\n"
        "\"Postgres cluster locked up during maintenance.\n"
        " Discovered VACUUM FULL was taking exclusive locks.\n"
        " RESOLUTION APPLIED:\n"
        "   - autovacuum_vacuum_cost_limit = 1000\n"
        "   - autovacuum_vacuum_scale_factor = 0.05\"\n\n"
        "Status: Captured automatically into Sulcus namespace."
    )
    draw.text((110, 360), msg1, fill=TEXT_MUTED, font=font_code)

    # Session 2 Query & Answer
    draw.rounded_rectangle((940, 260, 1840, 840), radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(940, 260), (1840, 266)], fill=CYAN_ACCENT)
    draw.text((970, 290), "Session 2: Future Outage Query & Recall", fill=TEXT_WHITE, font=font_bold)

    msg2 = (
        "Session 2 User Query:\n"
        "\"Database is experiencing high lock latency during routine\n"
        " cleanup again. What parameters did we tune to fix this?\"\n\n"
        "Sulcus Context Injection:\n"
        "  [policy] Tune autovacuum_vacuum_cost_limit to 1000.\n"
        "  [policy] Tune autovacuum_vacuum_scale_factor to 0.05.\n\n"
        "Agent Response:\n"
        "  \"Apply cost limit 1000 and scale factor 0.05. Do not use\n"
        "   VACUUM FULL as it locks the database.\"\n\n"
        "Outcome: Score 1.00 (100%) — Flawless Test-Time Learning (TTL)"
    )
    draw.text((970, 360), msg2, fill=TEXT_WHITE, font=font_code)

    return canvas


def render_bench_scene4(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_bold = get_font(FONT_PATH_HEADING, 22)
    font_code = get_font(FONT_PATH_CODE, 17)

    # Box 1: Stale State vs Superseding Directive
    draw.rounded_rectangle((80, 260, 880, 840), radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(80, 260), (880, 266)], fill=VIOLET_ACCENT)
    draw.text((110, 290), "Policy Shift & Contradiction Detection", fill=TEXT_WHITE, font=font_bold)

    msg1 = (
        "Original Baseline (Obsolete):\n"
        "  \"We run all our background workers on Nomad with Consul.\"\n\n"
        "Superseding Directive:\n"
        "  \"Update: We have completely migrated off Nomad.\n"
        "   All background workers are now deployed on Kubernetes\n"
        "   using ArgoCD. Do not use Nomad anymore.\"\n\n"
        "Sulcus Engine Action:\n"
        "  - Identifies contradiction and superseding intent.\n"
        "  - Marks Nomad entry as obsolete.\n"
        "  - Prioritizes Kubernetes / ArgoCD directive."
    )
    draw.text((110, 360), msg1, fill=TEXT_MUTED, font=font_code)

    # Box 2: Verification Query
    draw.rounded_rectangle((940, 260, 1840, 840), radius=12, fill=CARD_BG, outline=CARD_BORDER, width=2)
    draw.rectangle([(940, 260), (1840, 266)], fill=EMERALD_ACCENT)
    draw.text((970, 290), "Execution Verification (Conflict Resolution)", fill=TEXT_WHITE, font=font_bold)

    msg2 = (
        "User Prompt:\n"
        "\"Where and how should we deploy the new payment reconciliation worker?\"\n\n"
        "Agent Response:\n"
        "\"Deploy the payment reconciliation worker on Kubernetes using\n"
        " ArgoCD manifests.\"\n\n"
        "Verification Checklist:\n"
        "  [✓] Kubernetes referenced as required deploy target\n"
        "  [✓] ArgoCD referenced as deployment mechanism\n"
        "  [✓] Zero mentions of deprecated Nomad or Consul\n\n"
        "Outcome: Score 1.00 (100%) — Perfect Conflict Resolution"
    )
    draw.text((970, 360), msg2, fill=TEXT_WHITE, font=font_code)

    return canvas


def render_bench_scene5(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    draw_card(draw, (80, 260, 920, 840), "BABILong Multi-Hop Reasoning", [
        "QA1 (Single Supporting Fact): 100% direct pinpoint recall",
        "QA2 (Two Supporting Facts): 100% transitive entity tracking",
        "QA3 (Three Supporting Facts): 100% multi-hop spatial path recall",
        "QA15 (Deductive Reasoning): 100% deduction across memory rules",
        "QA19 (Path Finding): 100% spatial graph navigation",
        "Score: 5 / 5 Tasks Passed (100.0% Perfect Reasoning Score)"
    ], CYAN_ACCENT)

    draw_card(draw, (980, 260, 1840, 840), "Why Multi-Hop Memory Matters", [
        "Autonomous Decision Making: Connects separate facts across sessions",
        "Deduction Without Guessing: Traverses relational knowledge chains",
        "Spatial & Structural Coherence: Tracks multi-tiered system components",
        "Resistant to Noise: Ignores distractor background paragraphs",
        "Enterprise Readiness: Solves complex real-world workflows cleanly"
    ], GOLD_ACCENT)

    return canvas


def render_bench_scene6(canvas: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(canvas)
    font_stat = get_font(FONT_PATH_HEADING, 56)
    font_lbl = get_font(FONT_PATH_HEADING, 22)

    stats = [
        ("100%", "Google NIAH Precision", "Flawless depth and multi-needle recall", EMERALD_ACCENT),
        ("100%", "DeepMind Evo-Memory", "Perfect test-time learning & conflict resolution", CYAN_ACCENT),
        ("100%", "BABILong Reasoning", "5 / 5 multi-hop deduction tasks passed", VIOLET_ACCENT),
        ("99%", "SulcusBench Score", "20 / 20 comprehensive enterprise tasks passed", GOLD_ACCENT),
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
    print("Building Sulcus Benchmark & Performance Verification Video...")
    output_dir = "videos"
    os.makedirs(output_dir, exist_ok=True)
    temp_dir = tempfile.mkdtemp(prefix="sulcus_bench_video_")

    scene_clips = []

    try:
        for idx, scene in enumerate(BENCHMARK_SCENES):
            print(f"  Rendering [{idx+1}/{len(BENCHMARK_SCENES)}] {scene['id']}...")
            # 1. Voice Narration
            m4a_path = os.path.join(temp_dir, f"{scene['id']}.m4a")
            audio_duration = generate_voice(scene["voice"], m4a_path)
            duration = audio_duration + 1.0

            # 2. Render Slide
            canvas = create_base_canvas(scene["title"], scene["subtitle"])
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

        final_output = os.path.join(output_dir, "sulcus_benchmarks_and_performance.mp4")
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
