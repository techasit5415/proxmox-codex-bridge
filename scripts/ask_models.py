#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI Helper for Antigravity & Proxmox Codex Bridge
Directly queries Proxmox LXC Container at 192.168.5.159:3000
"""

import sys
import json
import argparse
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding='utf-8')

PROXMOX_BRIDGE_URL = "http://192.168.5.159:3000/api/task"

def query_bridge(provider: str, prompt: str, workspace: str = "temp"):
    payload = {
        "provider": provider,
        "prompt": prompt,
        "workspace": workspace
    }
    
    req = urllib.request.Request(
        PROXMOX_BRIDGE_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data
    except urllib.error.URLError as e:
        print(f"[ERROR] Cannot connect to Proxmox Bridge at {PROXMOX_BRIDGE_URL}: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Task failed: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Proxmox Codex Bridge Multi-Agent Runner")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--both", action="store_true", help="Query both Codex and DeepSeek R1 concurrently")
    group.add_argument("--codex", action="store_true", help="Query Codex (ChatGPT Plus: gpt-6.1-sol) only")
    group.add_argument("--deepseek", action="store_true", help="Query DeepSeek R1 (14b GPU) only")
    
    parser.add_argument("--workspace", default="temp", help="Target workspace or 'temp' for auto temp")
    parser.add_argument("prompt", help="The prompt / instruction to send")
    
    args = parser.parse_args()
    
    provider = "both"
    if args.codex:
        provider = "codex"
    elif args.deepseek:
        provider = "deepseek"
        
    res = query_bridge(provider, args.prompt, args.workspace)
    
    print(f"\n[Proxmox Bridge Task Completed | Mode: {res.get('mode', provider)} | Workspace: {res.get('workspace')}]")
    print(f"Recorded in Dashboard: http://192.168.5.159:3000\n")
    
    if provider == "both":
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

if __name__ == "__main__":
    main()
