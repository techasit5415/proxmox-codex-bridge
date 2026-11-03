#!/usr/bin/env python3
"""
One-Click Setup Script for Client PC / Antigravity
ติดตั้ง Runner และ Global Rules ให้ Antigravity เครื่องใหม่โดยอัตโนมัติ
"""
import os
import sys
import shutil
import subprocess
from pathlib import Path

# Fix Windows console encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def print_step(msg):
    print(f"\n[+] {msg}")

def print_ok(msg):
    print(f"    [OK] {msg}")

def print_err(msg):
    print(f"    [!] {msg}")

def main():
    print("=" * 60)
    print("Proxmox Codex Bridge - Client Setup for Antigravity")
    print("=" * 60)

    # 1. Determine Home & Gemini Config Directory
    home = Path.home()
    gemini_config = home / ".gemini" / "config"
    rules_dir = gemini_config / "rules"
    
    print_step(f"1. กำลังสร้างโฟลเดอร์ Config: {gemini_config}")
    rules_dir.mkdir(parents=True, exist_ok=True)
    print_ok(f"โฟลเดอร์พร้อมใช้งาน: {rules_dir}")

    # 2. Copy ask_models.py runner
    script_dir = Path(__file__).resolve().parent
    source_runner = script_dir / "ask_models.py"
    target_runner = gemini_config / "ask_models.py"

    print_step(f"2. ติดตั้ง Bridge Runner Tool...")
    if source_runner.exists():
        shutil.copy2(source_runner, target_runner)
        print_ok(f"คัดลอก {target_runner.name} -> {target_runner}")
    else:
        print_err(f"ไม่พบไฟล์ต้นฉบับ: {source_runner}")
        sys.exit(1)

    # 3. Setup Global Anti-Hallucination Rules
    print_step("3. ติดตั้งคู่มือสมองของ Antigravity (Global Rules)...")
    rules_content = """# Proxmox Codex Bridge & Multi-Agent Guidelines

## External Models Integration
When the user mentions or asks for:
- "ChatGPT" / "Codex" / "gpt-6.1-sol"
- "DeepSeek" / "DeepSeek R1"
- "ทั้ง 3 ตัว" / "3 โมเดล" / "ช่วยกันคิด" (referring to ChatGPT, DeepSeek, and Gemini)
- "เปรียบเทียบ" / "Dual mode" / "run_dual_task"

### CRITICAL RULES:
1. NEVER ROLEPLAY OR FABRICATE RESPONSES:
   - Do NOT simulate, hallucinate, or pretend to be ChatGPT or DeepSeek.
   - Do NOT invent a fake roundtable, summit, or mock dialog in place of real model outputs.
2. EXECUTE DIRECTLY VIA THE PERMANENT BRIDGE TOOL (DO NOT CREATE SCRATCH SCRIPTS):
   - The bridge runner is already built and ready at `C:\\Users\\techa\\.gemini\\config\\ask_models.py` (or `~/.gemini/config/ask_models.py`).
   - Run via `run_command`:
     - To run Multi-Agent Consensus Loop (Proposals -> Peer Review -> Harmonization):
       `python ~/.gemini/config/ask_models.py --consensus "<user prompt>"`
     - To query both models simultaneously (Dual Mode / Compare):
       `python ~/.gemini/config/ask_models.py --both "<user prompt>"`
     - To query Codex only:
       `python ~/.gemini/config/ask_models.py --codex "<user prompt>"`
     - To query DeepSeek only:
       `python ~/.gemini/config/ask_models.py --deepseek "<user prompt>"`
3. REPORT REAL LOGS & OUTPUTS:
   - Present the actual responses returned by the Proxmox bridge tool.
   - Inform the user that the task run is recorded in the dashboard at `http://192.168.5.159:3000`.
4. HONEST STATUS REPORTING:
   - If an API or tool call fails, times out, or has permission issues, report the exact error honestly to the user instead of substituting fake answers.
"""

    rule_path = rules_dir / "proxmox-codex-bridge.md"
    rule_path.write_text(rules_content, encoding="utf-8")
    print_ok(f"บันทึกไฟล์กฎ: {rule_path}")

    agents_path = gemini_config / "AGENTS.md"
    gemini_path = gemini_config / "GEMINI.md"
    agents_path.write_text(rules_content, encoding="utf-8")
    gemini_path.write_text(rules_content, encoding="utf-8")
    print_ok(f"ซิงค์ไปยัง {agents_path.name} และ {gemini_path.name} เรียบร้อย")

    # 4. Check & Install Python requests
    print_step("4. ตรวจสอบ Python requests library...")
    try:
        import requests
        print_ok("พบ requests library แล้ว")
    except ImportError:
        print("    กำลังติดตั้ง requests...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
        print_ok("ติดตั้ง requests สำเร็จ")

    # 5. Check Network Connection to Proxmox
    print_step("5. ทดสอบการเชื่อมต่อไปยัง Proxmox CT (192.168.5.159:3000)...")
    try:
        import urllib.request
        with urllib.request.urlopen("http://192.168.5.159:3000/api/models", timeout=3) as resp:
            if resp.status == 200:
                print_ok("เชื่อมต่อ Proxmox CT สำเร็จ 100%!")
            else:
                print_err(f"เชื่อมต่อได้แต่ได้ HTTP {resp.status}")
    except Exception as e:
        print_err(f"ยังต่อ Proxmox ไม่ได้ ({e})")
        print("    👉 อย่าลืมต่อ VPN (WireGuard/OpenVPN) หรืออยู่ในวงแลน 192.168.5.x นะครับ")

    print("\n" + "=" * 60)
    print("🎉 ติดตั้งระบบ Client บนเครื่องนี้เสร็จสมบูรณ์!")
    print("   ตอนนี้คุณสามารถสั่งงาน Antigravity ในแชทได้ทันที เช่น:")
    print('   - "ทั้ง 3 ตัวช่วยกันคิด..."')
    print('   - "ให้ ChatGPT กับ DeepSeek เปรียบเทียบกัน..."')
    print("=" * 60)

if __name__ == "__main__":
    main()
