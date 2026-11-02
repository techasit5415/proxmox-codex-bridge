# Antigravity to Multi-Agent Remote Bridge (Proxmox CT)

ระบบเชื่อมต่อ **Antigravity** (Client บนคอมพิวเตอร์ของคุณ) เข้ากับ **OpenAI Codex CLI** และ **DeepSeek R1 (14b GPU Cluster)** บน Proxmox LXC Container ทำงานอัตโนมัติแบบ Background 24/7 ควบคุมได้ทั้งผ่าน Antigravity Chat (MCP) และ Web Dashboard (SvelteKit)

---

## 1. ภาพรวมสถาปัตยกรรม (Tri-Machine Architecture)

```text
[ คอมพิวเตอร์ของคุณ (เครื่อง 1 หรือ เครื่องอื่น) ]
       │
       ├── 1. Antigravity Chat (สั่งงานผ่าน MCP over SSH)
       └── 2. Web Dashboard (http://192.168.5.159:3000)
               │
               ▼
[ Proxmox LXC Container (CT 192.168.5.159) ]
       ├── SvelteKit 3 + Tailwind v4 + TypeScript Web UI (Port 3000)
       ├── MCP Server (/opt/agent-bridge/server.mjs)
       ├── Workspaces (/opt/agent-bridge/workspaces/)
       │
       ├── Engine 1: OpenAI Codex CLI (ChatGPT Plus / gpt-6.1-sol)
       └── Engine 2: DeepSeek R1 14b (CS KMITL GPU Cluster: aipass.cskmitl.com)
```

---

## 2. วิธีตั้งค่าเมื่อย้ายไปใช้ Antigravity บน "เครื่องใหม่" (Setup on Another Machine)

เมื่อต้องการนำคอมพิวเตอร์เครื่องอื่น (โน้ตบุ๊ก หรือ PC เครื่องใหม่) มาสั่งงาน Server ตัวเดียวกัน:

### ขั้นตอนที่ 1: ตรวจสอบ Network
* **อยู่ในวง Wi-Fi เดียวกัน:** เชื่อมต่อไปที่ `192.168.5.159` ได้ทันที
* **อยู่นอกบ้าน:** เปิดแอป **Tailscale** แล้วใช้ IP Tailscale ของ Server แทน

### ขั้นตอนที่ 2: ผูก SSH Key จากเครื่องใหม่ไปยัง Server (ทำครั้งเดียว)
เปิด PowerShell หรือ Terminal บน **เครื่องใหม่**:

```powershell
# 1. สร้าง SSH Key หากยังไม่มี (กด Enter ผ่านตลอด)
ssh-keygen -t ed25519

# 2. ส่ง Public Key ไปไว้ที่ Server
# บน Windows (PowerShell):
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@192.168.5.159 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# บน Mac / Linux:
# ssh-copy-id root@192.168.5.159

# 3. ทดสอบ SSH (ต้องเข้าได้โดยไม่ต้องใส่รหัสผ่าน)
ssh root@192.168.5.159
```

### ขั้นตอนที่ 3: วางไฟล์ตั้งค่า Antigravity MCP บนเครื่องใหม่
สร้างหรือแก้ไขไฟล์การตั้งค่า MCP:
* **Windows:** `C:\Users\<username>\.gemini\config\mcp_config.json`
* **Mac/Linux:** `~/.gemini/config/mcp_config.json`

วางโค้ด JSON นี้ลงไป:

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

*เปิด Antigravity บนเครื่องใหม่ขึ้นมา จะเห็น Tools ทั้งหมดและพร้อมสั่งงานทันที!*

---

## 3. รายชื่อ MCP Tools ที่เรียกใช้ได้ใน Antigravity

Antigravity สามารถเรียกเครื่องมือเหล่านี้บน Proxmox CT ได้โดยตรง:

| Tool Name | คำอธิบาย | พารามิเตอร์ |
| :--- | :--- | :--- |
| `list_workspaces` | ดูรายชื่อโฟลเดอร์โปรเจกต์ทั้งหมดบน Server | *(ไม่มี)* |
| `inspect_workspace` | ตรวจสอบ Branch, Git Status และโครงสร้างไฟล์ | `workspace` |
| `clone_repo` | สั่งโคลน Git repo จาก URL เข้ามาที่ workspaces | `repoUrl`, `folderName` (optional) |
| `run_codex_task` | สั่ง **OpenAI Codex CLI (gpt-6.1-sol)** แก้โค้ดใน branch ใหม่ | `workspace`, `prompt`, `branch` |
| `run_deepseek_task` | สั่ง **DeepSeek R1 (14b KMITL GPU)** แก้โค้ดใน branch ใหม่ | `workspace`, `prompt`, `branch` |
| `run_dual_task` | สั่ง **ทั้ง Codex และ DeepSeek R1** ทำโจทย์เดียวกันพร้อมกันคนละ branch เพื่อเปรียบเทียบ Diff | `workspace`, `prompt` |
| `run_command` | รันคำสั่ง Bash ในโฟลเดอร์โปรเจกต์ (เช่น `npm test`, `git log`) | `workspace`, `command` |

---

## 4. ตัวอย่างการสั่งงานในแชท Antigravity

* **สั่ง Codex:**
  > *"สั่ง Codex เข้าไปใน `Android-Tv` แก้ไขฟังก์ชันใน tools พร้อมรันเทสต์"*
* **สั่ง DeepSeek R1 (GPU):**
  > *"สั่ง DeepSeek R1 เข้าไปใน `Android-Tv` เพิ่มระบบตรวจสอบ IP"*
* **สั่งแบบ Dual (รันคู่กันเพื่อเทียบผลงาน):**
  > *"สั่งทั้ง Codex และ DeepSeek R1 ทำโจทย์เพิ่มระบบ logging ใน `Android-Tv` แล้วเอา diff มาเทียบกันให้ดู"*

---

## 5. การใช้งานผ่าน Web Dashboard (SvelteKit)

สามารถเปิดผ่านเบราว์เซอร์เครื่องใดก็ได้ในเครือข่าย:
👉 **`http://192.168.5.159:3000`**

* **ตัวเลือก Provider:** สามารถเลือก `Codex (ChatGPT)`, `DeepSeek R1 (GPU)`, หรือ `Both (Compare)`
* **Real-time Metrics:** มอนิเตอร์ Cumulative Tokens, Session Tokens, Cache Hit %, Disk & RAM
* **Diff & Log Viewer:** แสดงโค้ดส่วนที่เพิ่ม/ลบแบบชัดเจน และคลิกปุ่ม Copy Diff ได้ในคลิกเดียว

---

## 6. Service & คำสั่งจัดการบน Server

* **Restart Web Dashboard:**
  ```bash
  ssh root@192.168.5.159 "systemctl restart agent-web"
  ```
* **ดู Log Web Dashboard:**
  ```bash
  ssh root@192.168.5.159 "journalctl -u agent-web -f"
  ```
* **ตำแหน่งโฟลเดอร์งาน:**
  * Workspace โค้ด: `/opt/agent-bridge/workspaces/`
  * โค้ด Dashboard: `/opt/agent-bridge/dashboard/`
  * โค้ด MCP Server: `/opt/agent-bridge/server.mjs`
