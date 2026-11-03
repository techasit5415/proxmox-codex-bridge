#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
One-click Client Setup Script for Proxmox Codex Bridge & Antigravity
Configures any new client machine (Windows, macOS, Linux) to connect to the Bridge.
"""

import os
import sys
import shutil
import urllib.request
import json
import argparse

sys.stdout.reconfigure(encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description="One-click Client Setup for Proxmox Codex Bridge")
    parser.add_argument("--url", default="http://192.168.5.159:3000", help="Proxmox Bridge Base URL (e.g. http://192.168.5.159:3000 or Tailscale IP)")
    parser.add_argument("--api-key", default="", help="BRIDGE_API_KEY if server authentication is enabled")
    args = parser.parse_args()

    bridge_url = args.url.rstrip('/')
    api_key = args.api_key or os.environ.get("BRIDGE_API_KEY", "")

    home_dir = os.path.expanduser("~")
    gemini_config_dir = os.path.join(home_dir, ".gemini", "config")
    gemini_rules_dir = os.path.join(gemini_config_dir, "rules")

    os.makedirs(gemini_rules_dir, exist_ok=True)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, ".."))

    src_ask = os.path.join(script_dir, "ask_models.py")
    dst_ask = os.path.join(gemini_config_dir, "ask_models.py")

    src_rule = os.path.join(repo_root, "rules", "proxmox-codex-bridge.md")
    dst_rule = os.path.join(gemini_rules_dir, "proxmox-codex-bridge.md")

    print("=" * 65)
    print("🚀 Proxmox Codex Bridge — Client Setup")
    print("=" * 65)
    print(f"Target Home:   {home_dir}")
    print(f"Bridge URL:    {bridge_url}")
    print(f"Config Dir:    {gemini_config_dir}")

    # 1. Copy ask_models.py
    if os.path.isfile(src_ask):
        shutil.copy2(src_ask, dst_ask)
        print(f"✔ Copied CLI runner to: {dst_ask}")
    else:
        print(f"✖ Error: Could not find {src_ask}", file=sys.stderr)

    # 2. Copy rules file
    if os.path.isfile(src_rule):
        shutil.copy2(src_rule, dst_rule)
        print(f"✔ Copied Antigravity Rules to: {dst_rule}")
    else:
        print(f"✖ Error: Could not find {src_rule}", file=sys.stderr)

    # 3. Test Connectivity
    print("\n🔍 Testing connection to Proxmox Bridge...")
    status_url = f"{bridge_url}/api/status"
    req = urllib.request.Request(status_url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print(f"✔ Connected successfully!")
            print(f"  • Bridge Status:  {data.get('status')}")
            print(f"  • Codex Auth:     {data.get('codexAuth')} ({data.get('codexVersion')})")
            print(f"  • Redis Status:   {data.get('redisStatus')}")
            print(f"  • Active Memory:  {data.get('memoryUsage')}")
    except Exception as e:
        print(f"⚠ Warning: Could not reach {status_url}: {e}")
        print("  Please verify your network, VPN, or bridge IP address.")

    print("\n" + "=" * 65)
    print("🎉 Client Setup Complete!")
    print("=" * 65)
    print("You can now run queries from anywhere on this machine:")
    print('  python ~/.gemini/config/ask_models.py --codex "Hello Codex"')
    print(f"\nDashboard is available at: {bridge_url}\n")

if __name__ == "__main__":
    main()
