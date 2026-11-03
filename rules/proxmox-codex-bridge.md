# Proxmox Codex Bridge & Multi-Agent Guidelines

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
   - The bridge runner is installed at `~/.gemini/config/ask_models.py`.
   - On Windows (PowerShell):
     - Multi-Agent Consensus: `python "$HOME/.gemini/config/ask_models.py" --consensus "<user prompt>"`
     - Dual Mode (Compare):  `python "$HOME/.gemini/config/ask_models.py" --both "<user prompt>"`
     - Codex Only:            `python "$HOME/.gemini/config/ask_models.py" --codex "<user prompt>"`
     - DeepSeek Only:         `python "$HOME/.gemini/config/ask_models.py" --deepseek "<user prompt>"`
   - On Linux/macOS:
     - Multi-Agent Consensus: `python3 ~/.gemini/config/ask_models.py --consensus "<user prompt>"`
     - Dual Mode (Compare):  `python3 ~/.gemini/config/ask_models.py --both "<user prompt>"`
     - Codex Only:            `python3 ~/.gemini/config/ask_models.py --codex "<user prompt>"`
     - DeepSeek Only:         `python3 ~/.gemini/config/ask_models.py --deepseek "<user prompt>"`
3. REPORT REAL LOGS & OUTPUTS:
   - Present the actual responses returned by the Proxmox bridge tool.
   - Inform the user that the task run is recorded in the dashboard at `http://192.168.5.159:3000`.
4. HONEST STATUS REPORTING:
   - If an API or tool call fails, times out, or has permission issues, report the exact error honestly to the user instead of substituting fake answers.
