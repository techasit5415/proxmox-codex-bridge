#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
One-click Client Setup Script for Proxmox Codex Bridge & Antigravity
Configures any client machine (Windows, macOS, Linux) to connect to the Bridge.
Sets up:
  1. CLI Runner (~/.gemini/config/ask_models.py + Windows ask.bat/ask.ps1)
  2. Persistent Bridge Config (~/.gemini/config/bridge_config.json)
  3. Antigravity Prompt Rules (~/.gemini/config/GEMINI.md & AGENTS.md)
  4. Antigravity MCP Server (~/.gemini/config/mcp_config.json)
"""

import os
import sys
import shutil
import urllib.request
import urllib.parse
import json
import argparse
import subprocess
import platform

sys.stdout.reconfigure(encoding='utf-8')

def test_ssh(user: str, host: str) -> bool:
    try:
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", f"{user}@{host}", "echo ok"]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        return res.returncode == 0
    except Exception:
        return False

def main():
    parser = argparse.ArgumentParser(description="One-click Client Setup for Proxmox Codex Bridge & Antigravity")
    parser.add_argument("--url", default="http://192.168.5.159:3000", help="Proxmox Bridge Base URL (e.g. http://192.168.5.159:3000 or Tailscale IP)")
    parser.add_argument("--api-key", default="", help="BRIDGE_API_KEY if server authentication is enabled")
    parser.add_argument("--ssh-user", default="root", help="SSH username for MCP server (default: root)")
    parser.add_argument("--skip-mcp", action="store_true", help="Skip Antigravity MCP server configuration")
    args = parser.parse_args()

    bridge_url = args.url.rstrip('/')
    api_key = args.api_key or os.environ.get("BRIDGE_API_KEY", "")
    ssh_user = args.ssh_user

    # Extract hostname / IP for MCP
    parsed_url = urllib.parse.urlparse(bridge_url)
    server_host = parsed_url.hostname or "192.168.5.159"

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
    dst_gemini_md = os.path.join(gemini_config_dir, "GEMINI.md")
    dst_agents_md = os.path.join(gemini_config_dir, "AGENTS.md")

    is_windows = platform.system().lower() == "windows"

    print("=" * 65)
    print("🚀 Proxmox Codex Bridge — Client Setup")
    print("=" * 65)
    print(f"Target OS:     {platform.system()} ({platform.machine()})")
    print(f"User Home:     {home_dir}")
    print(f"Bridge URL:    {bridge_url}")
    print(f"Server Host:   {server_host}")
    print(f"Config Dir:    {gemini_config_dir}")
    print("-" * 65)

    # 1. Save bridge_config.json
    cfg_file = os.path.join(gemini_config_dir, "bridge_config.json")
    cfg_data = {
        "bridge_url": bridge_url,
        "api_key": api_key,
        "server_host": server_host
    }
    with open(cfg_file, 'w', encoding='utf-8') as f:
        json.dump(cfg_data, f, indent=2)
    print(f"✔ Saved bridge config to: {cfg_file}")

    # 2. Copy ask_models.py
    if os.path.isfile(src_ask):
        shutil.copy2(src_ask, dst_ask)
        print(f"✔ Copied CLI runner to: {dst_ask}")
    else:
        print(f"✖ Error: Could not find {src_ask}", file=sys.stderr)

    # 3. Create convenient Windows CLI wrappers (ask.bat, ask.ps1)
    if is_windows:
        bat_path = os.path.join(gemini_config_dir, "ask.bat")
        with open(bat_path, 'w', encoding='utf-8') as f:
            f.write('@echo off\npython "%~dp0ask_models.py" %*\n')

        ps1_path = os.path.join(gemini_config_dir, "ask.ps1")
        with open(ps1_path, 'w', encoding='utf-8') as f:
            f.write('python "$PSScriptRoot\\ask_models.py" $args\n')
        print(f"✔ Created Windows wrappers: {bat_path} & {ps1_path}")

    # 4. Copy rules to rules/, GEMINI.md, and AGENTS.md
    if os.path.isfile(src_rule):
        shutil.copy2(src_rule, dst_rule)
        shutil.copy2(src_rule, dst_gemini_md)
        shutil.copy2(src_rule, dst_agents_md)
        print(f"✔ Configured Antigravity rules in:")
        print(f"    • {dst_rule}")
        print(f"    • {dst_gemini_md}")
        print(f"    • {dst_agents_md}")
    else:
        print(f"✖ Error: Could not find {src_rule}", file=sys.stderr)

    # 5. Configure Antigravity MCP Server (mcp_config.json)
    if not args.skip_mcp:
        mcp_file = os.path.join(gemini_config_dir, "mcp_config.json")
        mcp_data = {"mcpServers": {}}
        if os.path.isfile(mcp_file):
            try:
                with open(mcp_file, 'r', encoding='utf-8') as f:
                    mcp_data = json.load(f)
                    if "mcpServers" not in mcp_data:
                        mcp_data["mcpServers"] = {}
            except Exception:
                pass

        mcp_data["mcpServers"]["proxmox-agent"] = {
            "command": "ssh",
            "args": [
                "-T",
                f"{ssh_user}@{server_host}",
                "node",
                "/opt/agent-bridge/server.mjs"
            ]
        }
        with open(mcp_file, 'w', encoding='utf-8') as f:
            json.dump(mcp_data, f, indent=2)
        print(f"✔ Configured Antigravity MCP Server in: {mcp_file}")

    # 6. Test HTTP Connectivity
    print("\n🔍 Step 1: Testing HTTP connection to Proxmox Bridge...")
    status_url = f"{bridge_url}/api/status"
    req = urllib.request.Request(status_url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")

    http_ok = False
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            http_ok = True
            print(f"✔ Connected to Proxmox Bridge API successfully!")
            print(f"  • Bridge Status:  {data.get('status')}")
            print(f"  • Codex Auth:     {data.get('codexAuth')} ({data.get('codexVersion')})")
            print(f"  • Redis Status:   {data.get('redisStatus')} (Queue: {data.get('queueLength', 0)})")
            print(f"  • Active Memory:  {data.get('memoryUsage')}")
    except Exception as e:
        print(f"⚠ Warning: Could not reach {status_url}: {e}")
        print("  Please verify your network, VPN, or bridge IP address.")

    # 7. Test SSH Connectivity (for MCP)
    if not args.skip_mcp:
        print(f"\n🔍 Step 2: Testing SSH connection for Antigravity MCP ({ssh_user}@{server_host})...")
        ssh_ok = test_ssh(ssh_user, server_host)
        if ssh_ok:
            print(f"✔ Passwordless SSH connection verified! Antigravity MCP tools are fully enabled.")
        else:
            print(f"ℹ Notice: Passwordless SSH to {ssh_user}@{server_host} is not yet configured.")
            print(f"  • The HTTP Python CLI (ask_models.py) and Web Dashboard work 100% without SSH.")
            print(f"  • To also enable Antigravity's direct MCP tools via SSH, run:")
            print(f"      ssh-copy-id {ssh_user}@{server_host}")

    # 8. Ready-to-use Instructions
    print("\n" + "=" * 65)
    print("🎉 Client Setup Complete!")
    print("=" * 65)
    print("You can now run queries from anywhere on this machine:\n")

    if is_windows:
        print("  In PowerShell:")
        print(f'    python "$HOME/.gemini/config/ask_models.py" --codex "Hello Codex"')
        print(f'    python "$HOME/.gemini/config/ask_models.py" --both "เปรียบเทียบคำตอบ 2 โมเดล"')
        print(f'    python "$HOME/.gemini/config/ask_models.py" --consensus "ช่วยกันวางแผนงาน"')
        print("\n  In Command Prompt (CMD):")
        print(f'    python "%USERPROFILE%\\.gemini\\config\\ask_models.py" --codex "Hello Codex"')
        print("\n  Or using the full path:")
        print(f'    python "{dst_ask}" --codex "Hello Codex"')
    else:
        print('  python3 ~/.gemini/config/ask_models.py --codex "Hello Codex"')
        print('  python3 ~/.gemini/config/ask_models.py --both "เปรียบเทียบคำตอบ 2 โมเดล"')
        print('  python3 ~/.gemini/config/ask_models.py --consensus "ช่วยกันวางแผนงาน"')

    print(f"\nWeb Dashboard: {bridge_url}")
    print("Antigravity AI Chat: Just mention 'ChatGPT', 'DeepSeek', or 'ทั้ง 3 โมเดล' in chat!\n")

if __name__ == "__main__":
    main()
