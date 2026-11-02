# Antigravity to Codex Remote Bridge (Proxmox CT Sandbox)

ระบบเชื่อมต่อ **Antigravity** (Client บนคอมพิวเตอร์ของคุณ) เข้ากับ **OpenAI Codex CLI** (Worker บน Proxmox LXC Container) ทำงานอัตโนมัติแบบ Background 24/7 ผ่าน **Model Context Protocol (MCP)** และ SSH/Tailscale

---

## 1. สถาปัตยกรรมระบบ (Architecture)

```text
[ คอมพิวเตอร์ของคุณ (เครื่อง 1 หรือ เครื่องใหม่) ]
  └── Antigravity (สมองสั่งการ / Client / Tech Lead)
          │
          │  SSH over Tailscale / Local Network (Port 22, Key Auth)
          │  Stdio Transport (Model Context Protocol - MCP)
          ▼
[ Proxmox LXC Container (CT 192.168.5.159) ]
  ├── MCP Server Bridge (/opt/agent-bridge/server.mjs)
  │      ├── list_workspaces
  │      ├── inspect_workspace
  │      ├── clone_repo
  │      ├── run_codex_task
  │      └── run_command
  │
  ├── OpenAI Codex CLI (/usr/bin/codex)
  │      ├── Authentication: ChatGPT Plus (Plan ~700 THB/mo)
  │      └── Engine: gpt-6.1-sol / gpt-6-luna (หรือ API Key)
  │
  └── Workspaces Directory (/opt/agent-bridge/workspaces/)
         └── [Git Repositories & Sandboxed Code]
```

---

## 2. เครื่องมือและฟังก์ชันที่ให้บริการ (MCP Tools)

Antigravity สามารถเรียกเครื่องมือเหล่านี้บน Server ได้โดยอัตโนมัติ:

| Tool Name | คำอธิบาย | พารามิเตอร์ |
| :--- | :--- | :--- |
| `list_workspaces` | ดูรายชื่อโฟลเดอร์โปรเจกต์ทั้งหมดบน Server | *(ไม่มี)* |
| `inspect_workspace` | ตรวจสอบ Branch ปัจจุบัน, Git status, และโครงสร้างไฟล์ | `workspace` (ชื่อโฟลเดอร์) |
| `clone_repo` | สั่งโคลน Git repository จาก Remote เข้ามาที่ Server | `repoUrl`, `folderName` (optional) |
| `run_codex_task` | สั่งให้ Codex CLI แก้ไขโค้ด/เขียนฟีเจอร์อัตโนมัติ พร้อมสร้าง Branch ใหม่และส่ง Git Diff + Logs กลับมา | `workspace`, `prompt`, `branch` (optional) |
| `run_command` | สั่งรันคำสั่ง Bash ในโฟลเดอร์โปรเจกต์ (เช่น `npm test`, `git log`) | `workspace`, `command` |

---

## 3. ขั้นตอนการตั้งค่าเมื่อ "ย้ายไปใช้เครื่องใหม่" (Multi-Device Setup)

เมื่อต้องการเปิด Antigravity บนโน้ตบุ๊กหรือคอมพิวเตอร์เครื่องอื่นเพื่อสั่งงาน Server ตัวเดียวกัน:

### ขั้นตอนที่ 1: ตรวจสอบ Network
* หากอยู่ในวง Wi-Fi เดียวกับ Server: สามารถเชื่อมต่อไปที่ `192.168.5.159` ได้ทันที
* หากอยู่นอกบ้าน: เปิดแอป **Tailscale** แล้วใช้ IP Tailscale ของ Server แทน

### ขั้นตอนที่ 2: ตั้งค่า SSH Key (ทำครั้งเดียว)
เปิด PowerShell หรือ Terminal บน **เครื่องใหม่**:
```powershell
# 1. สร้างคีย์ถ้ายังไม่มี
ssh-keygen -t ed25519

# 2. คัดลอก Public Key ไปยัง Server
# Windows (PowerShell):
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@192.168.5.159 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# Mac / Linux:
# ssh-copy-id root@192.168.5.159

# 3. ทดสอบเข้าดู (ต้องเข้าได้โดยไม่ต้องใส่รหัสผ่าน)
ssh root@192.168.5.159
```

### ขั้นตอนที่ 3: วางไฟล์ตั้งค่า Antigravity MCP บนเครื่องใหม่
สร้างหรือแก้ไขไฟล์:
* **Windows:** `C:\Users\<username>\.gemini\config\mcp_config.json`
* **Mac/Linux:** `~/.gemini/config/mcp_config.json`

วางเนื้อหาต่อไปนี้:
```json
{
  "mcpServers": {
    "proxmox-agent": {
      "command": "ssh",
      "args": [
        "-T",
        "root@192.168.5.159",
        "node",
        "/opt/agent-bridge/server.mjs"
      ]
    }
  }
}
```
*เปิด Antigravity ขึ้นมา จะมองเห็น Tools ของ Server และพร้อมสั่งงานทันที*

---

## 4. การจัดการ Model ใน Codex CLI

### การใช้งานแบบ ChatGPT Plus (~700 บาท/เดือน):
ระบบถูกล็อกอินผ่าน `codex login --device-auth` ไว้อยู่แล้ว:
* โมเดลเริ่มต้น: **`gpt-6.1-sol`** (โมเดลการเขียนโค้ดและรันเทสต์อัตโนมัติ)
* โมเดลทางเลือก: **`gpt-6-luna`** (สำหรับงานเบา/เร็ว)

### หากต้องการสลับไปใช้ OpenAI API Key (เพื่อเลือกโมเดลใดๆ ได้อิสระ):
1. เข้า Server:
   ```bash
   ssh root@192.168.5.159
   ```
2. ใส่ API Key:
   ```bash
   echo "sk-your-openai-api-key" | codex login --with-api-key
   ```
3. กำหนดค่าเริ่มต้นใน `~/.codex/config.toml`:
   ```toml
   model = "gpt-5.6" # หรือโมเดลใดๆ ที่ต้องการ
   ```

---

## 5. การดูแลรักษาและแก้ปัญหา (Maintenance)

* **ตรวจสอบสถานะล็อกอินของ Codex:**
  ```bash
  ssh root@192.168.5.159 "codex login status"
  ```
* **วินิจฉัยสุขภาพของระบบ Codex:**
  ```bash
  ssh root@192.168.5.159 "codex doctor"
  ```
* **ตำแหน่งเก็บโปรเจกต์ทั้งหมดบน Server:**
  `/opt/agent-bridge/workspaces/`
