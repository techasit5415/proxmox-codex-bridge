#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI Helper for Antigravity & Proxmox Codex Bridge
Directly queries Proxmox LXC Container with Redis Job Queue & SSE Streaming.
Portable across any client machine (Windows, macOS, Linux).
"""

import sys
import os
import json
import time
import argparse
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding='utf-8')

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

def stream_or_poll_task(task_id: str, base_url: str):
    events_url = f"{base_url}/api/task/{task_id}/events"
    try:
        req = urllib.request.Request(events_url, headers=get_headers({"Accept": "text/event-stream"}))
        with urllib.request.urlopen(req, timeout=900) as resp:
            for line in resp:
                line_str = line.decode('utf-8', errors='ignore').strip()
                if line_str.startswith('data: '):
                    try:
                        ev = json.loads(line_str[6:])
                        ev_type = ev.get('type')
                        if ev_type == 'status':
                            st = ev.get('status')
                            print(f"  [Queue Status]: {st}")
                        elif ev_type == 'stage':
                            print(f"  ⚡ {ev.get('stage')}")
                        elif ev_type == 'done':
                            return ev.get('result', {})
                        elif ev_type == 'error':
                            print(f"\n[ERROR] Task execution failed: {ev.get('error')}", file=sys.stderr)
                            sys.exit(1)
                    except json.JSONDecodeError:
                        pass
    except Exception:
        # Fallback to polling /api/task/<task_id>
        pass

    # Polling fallback
    status_url = f"{base_url}/api/task/{task_id}"
    last_stage = None
    for _ in range(300):
        try:
            req = urllib.request.Request(status_url, headers=get_headers())
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                task = data.get('task', {})
                status = task.get('status')
                stage = task.get('stage')
                if stage and stage != last_stage:
                    print(f"  ⚡ {stage}")
                    last_stage = stage
                if status == 'completed':
                    return task.get('result', {})
                elif status == 'failed':
                    print(f"\n[ERROR] Task execution failed: {task.get('error')}", file=sys.stderr)
                    sys.exit(1)
        except Exception:
            pass
        time.sleep(2)
    
    raise TimeoutError(f"Task {task_id} timed out waiting for completion")

def query_bridge(provider: str, prompt: str, workspace: str = "temp", sync_mode: bool = False, task_url: str = DEFAULT_BRIDGE_URL):
    payload = {
        "provider": provider,
        "prompt": prompt,
        "workspace": workspace
    }
    
    url = f"{task_url}?sync=true" if sync_mode else task_url
    base_url = get_base_url(task_url)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=get_headers({"Content-Type": "application/json"})
    )
    
    try:
        with urllib.request.urlopen(req, timeout=900) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if resp.status == 202 or (data.get("taskId") and data.get("status") == "queued"):
                task_id = data["taskId"]
                print(f"[Redis Job Queue] Task '{task_id}' enqueued. Streaming live updates...\n")
                return stream_or_poll_task(task_id, base_url)
            return data
    except urllib.error.HTTPError as e:
        if e.code == 202:
            data = json.loads(e.read().decode("utf-8"))
            task_id = data["taskId"]
            print(f"[Redis Job Queue] Task '{task_id}' enqueued (HTTP 202). Streaming live updates...\n")
            return stream_or_poll_task(task_id, base_url)
        elif e.code == 409:
            err_data = e.read().decode('utf-8', errors='ignore')
            print(f"[ERROR 409] Workspace Conflict: {err_data}", file=sys.stderr)
            sys.exit(1)
        elif e.code == 401:
            print("[ERROR 401] Unauthorized: Invalid or missing BRIDGE_API_KEY", file=sys.stderr)
            sys.exit(1)
        else:
            print(f"[ERROR] HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}", file=sys.stderr)
            sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[ERROR] Cannot connect to Proxmox Bridge at {task_url}: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Task failed: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Proxmox Codex Bridge Multi-Agent Runner (Redis Queue & SSE)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--consensus", action="store_true", help="Run Multi-Agent Consensus Loop (Proposals -> Peer Review -> Harmonization)")
    group.add_argument("--both", action="store_true", help="Query both Codex and DeepSeek R1 concurrently (Isolated Git Worktrees)")
    group.add_argument("--codex", action="store_true", help="Query Codex (ChatGPT Plus: gpt-6.1-sol) only")
    group.add_argument("--deepseek", action="store_true", help="Query DeepSeek R1 (14b GPU) only")
    
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
    if os.path.isfile(args.prompt):
        with open(args.prompt, 'r', encoding='utf-8') as pf:
            prompt_text = pf.read()
            
    res = query_bridge(provider, prompt_text, args.workspace, sync_mode=args.sync, task_url=args.url)
    base_url = get_base_url(args.url)
    
    print(f"\n[Proxmox Bridge Task Completed | Mode: {res.get('mode', provider)} | Workspace: {res.get('workspace')}]")
    print(f"Recorded in Dashboard: {base_url}\n")
    
    if provider == "consensus":
        consensus_data = res.get("consensus", {})
        final_sol = consensus_data.get("finalSolution", {})
        codex_prop = consensus_data.get("codexProposal", {})
        deepseek_prop = consensus_data.get("deepseekProposal", {})
        ds_review = consensus_data.get("deepseekReviewOfCodex", "")
        codex_review = consensus_data.get("codexReviewOfDeepSeek", "")
        
        print("=" * 60)
        print("🏆 [Consensus Harmonized Solution]")
        print("=" * 60)
        print(final_sol.get("logs", res.get("logs", "(No output)")))
        if final_sol.get("diff"):
            print("\n--- [Consensus Final Git Diff] ---")
            print(final_sol.get("diff"))
            
        print("\n" + "=" * 60)
        print("🔄 [Peer Review 1: DeepSeek R1 auditing Codex Proposal]")
        print("=" * 60)
        print(ds_review or "(No review)")
        
        print("\n" + "=" * 60)
        print("🔄 [Peer Review 2: Codex auditing DeepSeek R1 Proposal]")
        print("=" * 60)
        print(codex_review or "(No review)")
        
        print("\n" + "=" * 60)
        print("🤖 [Initial Proposal A: OpenAI Codex]")
        print("=" * 60)
        print(codex_prop.get("logs", "(No output)"))
        
        print("\n" + "=" * 60)
        print("🧠 [Initial Proposal B: DeepSeek R1]")
        print("=" * 60)
        print(deepseek_prop.get("logs", "(No output)"))
        
    elif provider == "both":
        codex_data = res.get("codex", {})
        deepseek_data = res.get("deepseek", {})
        
        print("=" * 60)
        print("🤖 [1] OpenAI Codex (ChatGPT Plus: gpt-6.1-sol)")
        print("=" * 60)
        print(codex_data.get("logs", "(No output)"))
        if codex_data.get("diff"):
            print("\n--- [Codex Git Diff] ---")
            print(codex_data.get("diff"))
            
        print("\n" + "=" * 60)
        print("🧠 [2] DeepSeek R1 (14b CS KMITL GPU Cluster)")
        print("=" * 60)
        print(deepseek_data.get("logs", "(No output)"))
        if deepseek_data.get("diff"):
            print("\n--- [DeepSeek Git Diff] ---")
            print(deepseek_data.get("diff"))
    else:
        print("=" * 60)
        label = "🤖 OpenAI Codex" if provider == "codex" else "🧠 DeepSeek R1"
        print(f"{label} Response")
        print("=" * 60)
        print(res.get("logs", "(No output)"))
        if res.get("diff"):
            print("\n--- [Git Diff] ---")
            print(res.get("diff"))

    # Evidence Test Gate
    test_evidence = res.get("testEvidence") or (res.get("consensus") or {}).get("testEvidence")
    if test_evidence and test_evidence.get("ran"):
        status_label = "PASSED (✔)" if test_evidence.get("passed") else "FAILED (✖)"
        gate_type = test_evidence.get("type", "test_suite")
        gate_label = "Automated Syntax Verification" if gate_type == "syntax_check" else "Automated Test Suite"
        print("\n" + "=" * 60)
        print(f"🛡️ [{gate_label}: {status_label}]")
        print("=" * 60)
        print(f"Command: {test_evidence.get('testCmd')}")
        print(test_evidence.get("output", "(No output)"))

if __name__ == "__main__":
    main()
