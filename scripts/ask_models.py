#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI Helper for Antigravity & Proxmox Codex Bridge
Directly queries Proxmox LXC Container with Redis Job Queue, Live Status Polling,
and Full File Attachment Forwarding (PDF, DOCX, Images, Code/Text) to Codex & DeepSeek R1.
Portable across any client machine (Windows, macOS, Linux).
"""

import sys
import os
import re
import json
import time
import base64
import mimetypes
import argparse
import urllib.request
import urllib.error

try:
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)
except Exception:
    pass


def log_print(*args, **kwargs):
    kwargs.setdefault("flush", True)
    print(*args, **kwargs)


def load_saved_config():
    cfg_path = os.path.expanduser("~/.gemini/config/bridge_config.json")
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


_saved_cfg = load_saved_config()
_raw_url = os.environ.get("PROXMOX_BRIDGE_URL") or _saved_cfg.get("bridge_url") or "http://192.168.5.159:3000"
if not _raw_url.endswith("/api/task"):
    DEFAULT_BRIDGE_URL = _raw_url.rstrip("/") + "/api/task"
else:
    DEFAULT_BRIDGE_URL = _raw_url

API_KEY = os.environ.get("BRIDGE_API_KEY") or _saved_cfg.get("api_key") or ""


def get_base_url(task_url: str) -> str:
    if "/api" in task_url:
        return task_url.split("/api")[0]
    return task_url.rstrip("/")


def get_headers(extra=None):
    h = {"Accept": "application/json"}
    if API_KEY:
        h["Authorization"] = f"Bearer {API_KEY}"
    if extra:
        h.update(extra)
    return h


def prepare_file_attachments(explicit_files: list, prompt_text: str) -> list:
    """
    Loads local files from explicit --file flags AND auto-detects any local file paths
    mentioned in prompt_text so real files (PDF, DOCX, Images, Code) are always uploaded
    to Proxmox Bridge for both OpenAI Codex and DeepSeek R1 to inspect directly.
    """
    candidate_paths = []
    seen_realpaths = set()

    if explicit_files:
        for f in explicit_files:
            if f:
                candidate_paths.append(f.strip().strip('"').strip("'"))

    # Auto-detect local paths mentioned inside prompt_text (e.g. C:\...\file.pdf or /path/to/file.pdf)
    path_patterns = re.findall(
        r'(?:[A-Za-z]:[\\/][^\r\n"\'<>|*?]+?\.(?:pdf|docx|txt|md|csv|json|py|ts|js|svelte|html|tex|png|jpe?g|webp|gif))'
        r'|(?:/[^\s"\'<>|*?]+?\.(?:pdf|docx|txt|md|csv|json|py|ts|js|svelte|html|tex|png|jpe?g|webp|gif))',
        prompt_text,
        flags=re.IGNORECASE
    )
    for p in path_patterns:
        candidate_paths.append(p.strip())

    attachments = []
    for raw_path in candidate_paths:
        expanded = os.path.expanduser(raw_path)
        if not os.path.isfile(expanded):
            if explicit_files and raw_path in explicit_files:
                log_print(f"[WARNING] Attached file not found: {raw_path}", file=sys.stderr)
            continue

        real_p = os.path.realpath(expanded)
        if real_p in seen_realpaths:
            continue
        seen_realpaths.add(real_p)

        try:
            size = os.path.getsize(real_p)
            if size > 45 * 1024 * 1024:
                log_print(f"[WARNING] Skipping '{os.path.basename(real_p)}' (exceeds 45MB limit)", file=sys.stderr)
                continue
            with open(real_p, 'rb') as bf:
                b64_data = base64.b64encode(bf.read()).decode('ascii')
            mime_type, _ = mimetypes.guess_type(real_p)
            attachments.append({
                "name": os.path.basename(real_p),
                "mimeType": mime_type or "application/octet-stream",
                "contentBase64": b64_data
            })
        except Exception as e:
            log_print(f"[WARNING] Could not read file '{real_p}': {e}", file=sys.stderr)

    return attachments


def extract_clean_body(raw: str) -> str:
    """
    Strips Codex CLI stderr trace ('OpenAI Codex v0.xxx ... -------- ... user ... codex ... tokens used')
    and extracts the clean final response body so output is never duplicated.
    """
    if not raw or not raw.strip():
        return "(No output)"

    text = raw.strip()

    # Strip <think>...</think> blocks from main body if followed by actual answer
    think_match = re.search(r"<think>([\s\S]*?)</think>", text, re.IGNORECASE)
    if think_match:
        after_think = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
        if after_think:
            text = after_think

    # Detect Codex CLI stderr banner ('OpenAI Codex v...')
    codex_banner = re.search(r"^OpenAI Codex v[\d.]+", text, re.MULTILINE)
    if codex_banner:
        before_banner = text[:codex_banner.start()].strip()
        if before_banner:
            return before_banner

        stderr_block = text[codex_banner.start():]
        markers = list(re.finditer(r"(?:^|\n)codex\r?\n", stderr_block))
        if markers:
            after_codex = stderr_block[markers[-1].end():]
            after_codex = re.sub(r"\r?\ntokens used\r?\n[\d,]+\s*$", "", after_codex, flags=re.IGNORECASE).strip()
            if after_codex:
                return after_codex

    return text


def stream_or_poll_task(task_id: str, base_url: str):
    """
    Polls /api/task/<task_id> every 1.5s with unbuffered stage logging.
    Avoids Python urllib BufferedReader blocking on SSE keep-alive streams
    and guarantees return within <=1.5s of task completion on the Web Dashboard.
    """
    status_url = f"{base_url}/api/task/{task_id}"
    last_status = None
    last_stage = None
    start_ts = time.time()

    # Wait up to 20 minutes (800 * 1.5s)
    for _ in range(800):
        try:
            req = urllib.request.Request(status_url, headers=get_headers())
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                task = data.get('task', {})
                status = task.get('status')
                stage = task.get('stage')

                if status and status != last_status:
                    elapsed = int(time.time() - start_ts)
                    log_print(f"  [Queue Status ({elapsed}s)]: {status}")
                    last_status = status

                if stage and stage != last_stage:
                    elapsed = int(time.time() - start_ts)
                    log_print(f"  ⚡ [{elapsed}s] {stage}")
                    last_stage = stage

                if status == 'completed':
                    elapsed = int(time.time() - start_ts)
                    log_print(f"  ✔ [{elapsed}s] Task completed on Proxmox Bridge!")
                    return task.get('result', {})
                elif status in ('failed', 'cancelled'):
                    err_msg = task.get('error') or f"Task {status}"
                    log_print(f"\n[ERROR] Task execution {status}: {err_msg}", file=sys.stderr)
                    sys.exit(1)
        except SystemExit:
            raise
        except Exception:
            pass
        time.sleep(1.5)

    raise TimeoutError(f"Task {task_id} timed out waiting for completion")


def query_bridge(
    provider: str,
    prompt: str,
    workspace: str = "temp",
    sync_mode: bool = False,
    task_url: str = DEFAULT_BRIDGE_URL,
    attachments: list = None
):
    payload = {
        "provider": provider,
        "prompt": prompt,
        "workspace": workspace
    }
    if attachments:
        payload["attachments"] = attachments
        names = ", ".join(f"{a['name']} ({round(len(a['contentBase64']) * 3 / 4 / 1024, 1)} KB)" for a in attachments)
        log_print(f"📎 Uploading {len(attachments)} real file(s) to Proxmox Bridge for Codex & DeepSeek inspection: {names}")

    url = f"{task_url}?sync=true" if sync_mode else task_url
    base_url = get_base_url(task_url)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=get_headers({"Content-Type": "application/json"})
    )

    try:
        with urllib.request.urlopen(req, timeout=60 if not sync_mode else 900) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if resp.status == 202 or (data.get("taskId") and data.get("status") == "queued"):
                task_id = data["taskId"]
                log_print(f"[Redis Job Queue] Task '{task_id}' enqueued. Monitoring live progress at {base_url} ...\n")
                return stream_or_poll_task(task_id, base_url)
            return data
    except urllib.error.HTTPError as e:
        if e.code == 202:
            data = json.loads(e.read().decode("utf-8"))
            task_id = data["taskId"]
            log_print(f"[Redis Job Queue] Task '{task_id}' enqueued (HTTP 202). Monitoring live progress at {base_url} ...\n")
            return stream_or_poll_task(task_id, base_url)
        elif e.code == 409:
            err_data = e.read().decode('utf-8', errors='ignore')
            log_print(f"[ERROR 409] Workspace Conflict: {err_data}", file=sys.stderr)
            sys.exit(1)
        elif e.code == 401:
            log_print("[ERROR 401] Unauthorized: Invalid or missing BRIDGE_API_KEY", file=sys.stderr)
            sys.exit(1)
        else:
            log_print(f"[ERROR] HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}", file=sys.stderr)
            sys.exit(1)
    except urllib.error.URLError as e:
        log_print(f"[ERROR] Cannot connect to Proxmox Bridge at {task_url}: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        log_print(f"[ERROR] Task failed: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Proxmox Codex Bridge Multi-Agent Runner (Redis Queue, Live Polling & Real File Upload)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--consensus", action="store_true", help="Run Multi-Agent Consensus Loop (Proposals -> Peer Review -> Harmonization)")
    group.add_argument("--both", action="store_true", help="Query both Codex and DeepSeek R1 concurrently (Isolated Git Worktrees)")
    group.add_argument("--codex", action="store_true", help="Query Codex (ChatGPT Plus: gpt-6.1-sol) only")
    group.add_argument("--deepseek", action="store_true", help="Query DeepSeek R1 (14b GPU) only")

    parser.add_argument("--file", "-f", action="append", default=[], help="Attach real local file(s) (PDF, DOCX, Images, Code) to upload to Proxmox Bridge (can be specified multiple times)")
    parser.add_argument("--workspace", default="temp", help="Target workspace or 'temp' for auto temp")
    parser.add_argument("--sync", action="store_true", help="Run synchronously without Redis queue")
    parser.add_argument("--url", default=DEFAULT_BRIDGE_URL, help="Custom Proxmox Bridge Task URL (default: http://192.168.5.159:3000/api/task or PROXMOX_BRIDGE_URL)")
    parser.add_argument("prompt", help="The prompt / instruction to send (or path to text file)")

    args = parser.parse_args()

    provider = "both"
    if args.consensus:
        provider = "consensus"
    elif args.codex:
        provider = "codex"
    elif args.deepseek:
        provider = "deepseek"

    prompt_text = args.prompt
    if os.path.isfile(args.prompt) and not args.prompt.lower().endswith(('.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp', '.gif')):
        with open(args.prompt, 'r', encoding='utf-8') as pf:
            prompt_text = pf.read()

    attachments = prepare_file_attachments(args.file, prompt_text)

    res = query_bridge(provider, prompt_text, args.workspace, sync_mode=args.sync, task_url=args.url, attachments=attachments)
    base_url = get_base_url(args.url)
    tok = res.get("tokens") or {}
    tot_tok = tok.get("total_tokens", 0)
    cached_tok = tok.get("cached_input_tokens", 0)
    net_tok = tok.get("net_tokens") if tok.get("net_tokens") is not None else max(0, tot_tok - cached_tok)

    log_print(f"\n[Proxmox Bridge Task Completed | Mode: {res.get('mode', provider)} | Workspace: {res.get('workspace')}]")
    if tot_tok:
        log_print(f"Tokens Used: {net_tok:,} net ({tot_tok:,} total | {cached_tok:,} cached)")
    log_print(f"Recorded in Dashboard: {base_url}\n")

    if provider == "consensus":
        consensus_data = res.get("consensus", {})
        final_sol = consensus_data.get("finalSolution", {})
        codex_prop = consensus_data.get("codexProposal", {})
        deepseek_prop = consensus_data.get("deepseekProposal", {})
        ds_review = consensus_data.get("deepseekReviewOfCodex", "")
        codex_review = consensus_data.get("codexReviewOfDeepSeek", "")

        log_print("=" * 60)
        log_print("🏆 [Consensus Harmonized Solution]")
        log_print("=" * 60)
        log_print(extract_clean_body(final_sol.get("logs", res.get("logs", "(No output)"))))
        if final_sol.get("diff"):
            log_print("\n--- [Consensus Final Git Diff] ---")
            log_print(final_sol.get("diff"))

        log_print("\n" + "=" * 60)
        log_print("🔄 [Peer Review 1: DeepSeek R1 auditing Codex Proposal]")
        log_print("=" * 60)
        log_print(extract_clean_body(ds_review) if ds_review else "(No review)")

        log_print("\n" + "=" * 60)
        log_print("🔄 [Peer Review 2: Codex auditing DeepSeek R1 Proposal]")
        log_print("=" * 60)
        log_print(extract_clean_body(codex_review) if codex_review else "(No review)")

        log_print("\n" + "=" * 60)
        log_print("🤖 [Initial Proposal A: OpenAI Codex]")
        log_print("=" * 60)
        log_print(extract_clean_body(codex_prop.get("logs", "(No output)")))

        log_print("\n" + "=" * 60)
        log_print("🧠 [Initial Proposal B: DeepSeek R1]")
        log_print("=" * 60)
        log_print(extract_clean_body(deepseek_prop.get("logs", "(No output)")))

    elif provider == "both":
        codex_data = res.get("codex", {})
        deepseek_data = res.get("deepseek", {})

        log_print("=" * 60)
        log_print("🤖 [1] OpenAI Codex (ChatGPT Plus: gpt-6.1-sol)")
        log_print("=" * 60)
        log_print(extract_clean_body(codex_data.get("logs", "(No output)")))
        if codex_data.get("diff"):
            log_print("\n--- [Codex Git Diff] ---")
            log_print(codex_data.get("diff"))

        log_print("\n" + "=" * 60)
        log_print("🧠 [2] DeepSeek R1 (14b CS KMITL GPU Cluster)")
        log_print("=" * 60)
        log_print(extract_clean_body(deepseek_data.get("logs", "(No output)")))
        if deepseek_data.get("diff"):
            log_print("\n--- [DeepSeek Git Diff] ---")
            log_print(deepseek_data.get("diff"))
    else:
        log_print("=" * 60)
        label = "🤖 OpenAI Codex" if provider == "codex" else "🧠 DeepSeek R1"
        log_print(f"{label} Response")
        log_print("=" * 60)
        log_print(extract_clean_body(res.get("logs", "(No output)")))
        if res.get("diff"):
            log_print("\n--- [Git Diff] ---")
            log_print(res.get("diff"))

    # Evidence Test Gate
    test_evidence = res.get("testEvidence") or (res.get("consensus") or {}).get("testEvidence")
    if test_evidence and test_evidence.get("ran"):
        status_label = "PASSED (✔)" if test_evidence.get("passed") else "FAILED (✖)"
        gate_type = test_evidence.get("type", "test_suite")
        gate_label = "Automated Syntax Verification" if gate_type == "syntax_check" else "Automated Test Suite"
        log_print("\n" + "=" * 60)
        log_print(f"🛡️ [{gate_label}: {status_label}]")
        log_print("=" * 60)
        log_print(f"Command: {test_evidence.get('testCmd')}")
        log_print(test_evidence.get("output", "(No output)"))


if __name__ == "__main__":
    main()
