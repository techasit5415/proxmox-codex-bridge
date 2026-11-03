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
   - The bridge runner is installed at `~/.gemini/config/ask_models.py` (or `%USERPROFILE%\.gemini\config\ask_models.py`).
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
