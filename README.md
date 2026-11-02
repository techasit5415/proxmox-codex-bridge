# Antigravity to Multi-Agent Remote Bridge (Proxmox CT)

ระบบ **Multi-Agent Remote Development & Dual AI Architecture** ที่เชื่อมต่อ **Google Antigravity IDE** เข้ากับ **OpenAI Codex CLI (gpt-6.1-sol)** และ **DeepSeek R1 (14b KMITL GPU Cluster)** บน Proxmox LXC Container ทำงานแบบ Background 24/7 ควบคุมได้ทั้งจาก **Antigravity Chat (MCP over SSH)** และ **Web Dashboard (SvelteKit 3 + Tailwind v4)**

---

## 📑 สารบัญ
1. [ภาพรวมสถาปัตยกรรม (Tri-Machine Architecture)](#1-ภาพรวมสถาปัตยกรรม-tri-machine-architecture)
2. [ขั้นตอนการติดตั้งทั้งหมดตั้งแต่ต้น (Fresh Install on Proxmox CT)](#2-ขั้นตอนการติดตั้งทั้งหมดตั้งแต่ต้น-fresh-install-on-proxmox-ct)
3. [ถ้าไม่มี Workspace บน CT ต้องทำอย่างไร? (Workspace Management)](#3-ถ้าไม่มี-workspace-บน-ct-ต้องทำอย่างไร-workspace-management)
4. [สรุปปัญหาและแนวทางแก้ไขทั้งหมด (Post-Mortem & Troubleshooting Guide)](#4-สรุปปัญหาและแนวทางแก้ไขทั้งหมด-post-mortem--troubleshooting-guide)
5. [วิธีเชื่อมต่อ Antigravity บนเครื่องใหม่ (Client Setup on Another PC)](#5-วิธีเชื่อมต่อ-antigravity-บนเครื่องใหม่-client-setup-on-another-pc)
6. [การใช้งาน Dashboard และฟีเจอร์ Side-by-Side Dual View](#6-การใช้งาน-dashboard-และฟีเจอร์-side-by-side-dual-view)
7. [คำสั่งจัดการและ Systemd Service](#7-คำสั่งจัดการและ-systemd-service)

---

## 1. ภาพรวมสถาปัตยกรรม (Tri-Machine Architecture)

```text
[ คอมพิวเตอร์ของคุณ (เครื่อง 1 หรือ โน้ตบุ๊กเครื่องอื่น) ]
       │
       ├── 1. Antigravity Chat (สั่งงานผ่าน MCP over SSH: run_dual_task, run_codex_task, etc.)
       └── 2. Web Dashboard (เปิดผ่านเบราว์เซอร์ http://192.168.5.159:3000)
               │
               ▼
[ Proxmox LXC Container (CT 192.168.5.159) ]
       ├── Web Dashboard: SvelteKit 3 + Tailwind v4 + TypeScript (Systemd: agent-web, Port 3000)
       ├── MCP Server: /opt/agent-bridge/server.mjs (Stdio Transport over SSH)
       ├── History Store: /opt/agent-bridge/tasks_history.json
       ├── Workspaces: /opt/agent-bridge/workspaces/<repo-name>/
       │
       ├── Engine 1 (Cloud): OpenAI Codex CLI (gpt-6.1-sol / ChatGPT Plus)
       └── Engine 2 (On-Prem GPU): DeepSeek R1 14b (CS KMITL GPU Cluster: aipass.cskmitl.com)
```

---

## 2. ขั้นตอนการติดตั้งทั้งหมดตั้งแต่ต้น (Fresh Install on Proxmox CT)

หากสร้าง Proxmox LXC Container ใหม่ (แนะนำ Ubuntu 22.04 หรือ 24.04 หรือ Debian 12):

### 2.1 ติดตั้ง Packages พื้นฐานและ Node.js 22 LTS
```bash
# 1. อัปเดตระบบ
apt update && apt upgrade -y
apt install -y git curl wget ripgrep jq build-essential

# 2. ติดตั้ง Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# ตรวจสอบเวอร์ชัน
node -v   # v22.x.x
npm -v    # 10.x.x
```

### 2.2 ติดตั้งและล็อกอิน OpenAI Codex CLI
```bash
npm install -g @openai/codex

# ล็อกอิน ChatGPT Plus / OpenAI Account (จะให้ copy URL ไปเปิดในเบราว์เซอร์เพื่อกดยืนยัน)
codex login
```

### 2.3 ตั้งค่าโครงสร้างโฟลเดอร์ของ Bridge
```bash
mkdir -p /opt/agent-bridge/workspaces
cd /opt/agent-bridge

# โคลนโปรเจกต์นี้ลงใน /opt/agent-bridge
git clone https://github.com/techasit5415/proxmox-codex-bridge.git .
```

### 2.4 ติดตั้ง Dependency ของ Dashboard และ Build
```bash
cd /opt/agent-bridge/dashboard
npm install
npm run build
```

### 2.5 สร้าง Systemd Service เพื่อให้ Dashboard รันตลอดเวลา (Auto-start on Boot)
สร้างไฟล์ `/etc/systemd/system/agent-web.service`:
```ini
[Unit]
Description=Codex Agent SvelteKit Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/agent-bridge/dashboard
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=LANG=C.UTF-8
Environment=LC_ALL=C.UTF-8

[Install]
WantedBy=multi-user.target
```

เปิดใช้งาน service:
```bash
systemctl daemon-reload
systemctl enable --now agent-web
systemctl status agent-web
```

---

## 3. ถ้าไม่มี Workspace บน CT ต้องทำอย่างไร? (Workspace Management)

### Workspace คืออะไร?
Workspace บน Server คือ**โฟลเดอร์โปรเจกต์ที่มี Git Repository อยู่ภายใต้ `/opt/agent-bridge/workspaces/`**
โมเดลทั้งสองตัว (Codex และ DeepSeek R1) ต้องใช้ Git เพื่อแตก branch ทำงานอัตโนมัติ (เช่น `agent/codex-*` และ `agent/deepseek-*`) และวัด `git diff` เพื่อเปรียบเทียบผลลัพธ์

หากคุณสร้าง CT ขึ้นมาใหม่ แล้วในโฟลเดอร์ `/opt/agent-bridge/workspaces/` ว่างเปล่า ไม่มีโปรเจกต์เลย สามารถเพิ่มได้ **3 วิธี** ดังนี้:

### วิธีที่ 1: สั่งจาก Antigravity Chat โดยตรง (แนะนำ - สะดวกที่สุด)
คุณไม่ต้องเปิดหน้าเว็บ หรือเข้า SSH เลย เพียงแค่สั่ง Antigravity ในแชท:
> *"ช่วยโคลน `https://github.com/techasit5415/Android-Tv.git` มาไว้ที่ workspace หน่อย"*

Antigravity จะเรียกเครื่องมือ `proxmox-agent:clone_repo` โคลนมาไว้ที่ `/opt/agent-bridge/workspaces/Android-Tv` ให้อัตโนมัติทันที

### วิธีที่ 2: โคลนผ่านหน้าเว็บ Dashboard
1. เปิดหน้าเว็บ `http://192.168.5.159:3000`
2. มองที่มุมซ้ายบนของเมนู **Workspaces** จะมีปุ่ม **`+ Clone`**
3. ใส่ Git URL เช่น `https://github.com/username/project.git`
4. (ตัวเลือก) ระบุชื่อโฟลเดอร์ที่ต้องการ
5. กดปุ่ม **Clone** ระบบจะดึง repository ลงมาและปรากฏในรายการ Workspace ทันที

### วิธีที่ 3: สร้างโปรเจกต์เปล่าใหม่จากศูนย์ (Blank Project Init)
ถ้าต้องการเริ่มสร้างโปรเจกต์ใหม่ที่ยังไม่มีบน GitHub สามารถใช้ช่อง **Quick Command** บนหน้าเว็บ หรือรันผ่าน SSH:
```bash
mkdir -p /opt/agent-bridge/workspaces/my-new-project
cd /opt/agent-bridge/workspaces/my-new-project
git init
git commit --allow-empty -m "initial commit"
```
*(ต้องมีอย่างน้อย 1 commit หรือ branch เพื่อให้ Git branch/diff ใช้งานได้สมบูรณ์)*

---

## 4. สรุปปัญหาและแนวทางแก้ไขทั้งหมด (Post-Mortem & Troubleshooting Guide)

ตลอดการพัฒนาระบบ Multi-Agent Bridge มีปัญหาเชิงลึก 6 ประเด็นหลักที่เกิดขึ้นและได้รับการแก้ไขแล้ว ดังนี้:

### 4.1 ปัญหา DeepSeek R1 เจอ 504 Gateway Time-out
* **อาการ:** เมื่อรันโจทย์วิเคราะห์ยาวๆ บนโมเดล `deepseek-r1:14b` ของ KMITL GPU API จะหลุด Timeout ตอบกลับมาเป็น `504 Gateway Time-out`
* **สาเหตุ:** เบื้องหลัง Nginx Reverse Proxy ของเซิร์ฟเวอร์มหาลัยตั้ง `proxy_read_timeout 60s` ไว้ หากเรียก API แบบปกติ (`stream: false`) แล้ว DeepSeek R1 คิดแบบ Chain of Thought นานเกิน 60 วินาที Nginx จะตัดการเชื่อมต่อทันที
* **วิธีแก้:** ปรับการเชื่อมต่อใน `server.mjs` และ `api/task/+server.ts` ให้ใช้ **`stream: true` (NDJSON Stream)** โดยใช้ `ReadableStream.getReader()` รับ chunk ข้อมูลทีละ token ทันที ทำให้ Nginx มีข้อมูลไหลผ่านตลอดเวลา ไม่โดนตัด Timeout แม้โมเดลจะคิดนานหลายนาที

### 4.2 ปัญหา DNS ไม่ Resolve โดเมน `aipass.cskmitl.com` (ENOTFOUND)
* **อาการ:** Node.js เกิดข้อผิดพลาด `getaddrinfo ENOTFOUND aipass.cskmitl.com`
* **สาเหตุ:** ไฟล์ `/etc/resolv.conf` บน Proxmox CT มี DNS ลำดับแรกชี้ไปที่ Gateway วงใน (`192.168.5.254`) ซึ่งไม่ forward คำขอ DNS ภายนอกอย่างถูกต้อง เมื่อ query ล้มเหลว Linux จึงหยุดก่อนไปหา `8.8.8.8`
* **วิธีแก้:** บันทึก IP ตรง `161.246.157.217 aipass.cskmitl.com` ลงใน `/etc/hosts` บน CT ทำให้ Server คุยกับ GPU Cluster ได้เสมอตลอด 24 ชม. แม้ DNS วงในจะมีปัญหา

### 4.3 ปัญหาภาษาไทยกลายเป็น `???` และ Shell Syntax Error
* **อาการ:** เมื่อผู้ใช้สั่งงานภาษาไทย หรือมีข้อความที่มีวงเล็บ เช่น `(เช่น โหมดฟังเพลง...)` ตัวหนังสือกลายเป็นเครื่องหมายคำถาม หรือ PowerShell พยายามประเมินวงเล็บเป็น subexpression
* **สาเหตุ:** การส่งข้อความภาษาไทยผ่าน shell argument (`/bin/sh -c "codex exec ... \"$prompt\""`) ใน Linux environment ที่ไม่ได้เซ็ต UTF-8 locale จะถูกแปลงเป็น ASCII replacement characters
* **วิธีแก้:** 
  1. เขียน Prompt ลงไฟล์ UTF-8 ชั่วคราว (`/tmp/codex_prompt_*.txt`)
  2. ไปป์เข้า Stdin ของ `codex exec -`
  3. กำหนดตัวแปรสภาพแวดล้อม `{ env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } }` ในทุก child process

### 4.4 ปัญหา MCP Tool Deadline Exceeded (> 3 นาที)
* **อาการ:** เมื่อเรียก `run_dual_task` ผ่าน Antigravity MCP แล้วเกิด error `context deadline exceeded (3m0s)`
* **สาเหตุ:** เดิมทีระบบรัน Codex CLI จนเสร็จ (~1.5 นาที) แล้วจึงเริ่ม DeepSeek R1 (~1.5 นาที) รวมกันเกิน 3 นาที
* **วิธีแก้:** รัน Network Query ของ DeepSeek R1 ขนานไปกับ Codex CLI ทันที โดยใช้ `Promise.all` ทำให้เวลาในการประมวลผล Dual Task ลดลงเหลือเพียงเวลาของโมเดลที่ช้าที่สุด (~35-45 วินาที) ไม่เกิน 3 นาทีแน่นอน

### 4.5 ปัญหา Svelte 5 `{@const}` Tag Compilation Placement
* **อาการ:** รัน `npm run build` ใน SvelteKit แล้วล้มเหลวด้วยข้อผิดพลาด `const_tag_invalid_placement`
* **สาเหตุ:** Svelte 5 มี strict syntax rule ว่า `{@const}` ต้องวางเป็น immediate child ของบล็อกควบคุมเท่านั้น (`{#if}`, `{#each}`, `{:else}`) ห้ามวางซ้อนอยู่ใต้แท็ก HTML ทั่วไป เช่น `<div>`
* **วิธีแก้:** ย้ายการประกาศ `{@const parsed = extractThoughtAndBody(...)}` ไปไว้ใต้บรรทัด `{#if}` ทันที

### 4.6 ปัญหาป้ายในแถบ History แสดงผลโมเดลสับสน
* **อาการ:** งานที่เป็น Dual Task แสดงป้าย tag สีม่วงเป็น `DeepSeek` ในแถบประวัติ
* **สาเหตุ:** เงื่อนไขการแสดงผลตรวจ `item.provider?.includes('DeepSeek')` ก่อน ซึ่งชื่อ `"Dual Agents (Codex + DeepSeek)"` มีคำว่า DeepSeek อยู่ด้วย
* **วิธีแก้:** ปรับลำดับการตรวจสอบให้เช็ค `item.mode === 'both' || item.provider?.includes('Dual')` เป็นลำดับแรกสุด

---

## 5. วิธีเชื่อมต่อ Antigravity บนเครื่องใหม่ (Client Setup on Another PC)

เมื่อต้องการใช้โน้ตบุ๊กหรือคอมพิวเตอร์เครื่องอื่นมาสั่งงาน Proxmox CT เดียวกัน:

### ขั้นตอนที่ 1: ติดตั้ง SSH Key ไปที่ Server
เปิด PowerShell หรือ Terminal บนเครื่องใหม่:
```powershell
# บน Windows:
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@192.168.5.159 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# บน Mac/Linux:
ssh-copy-id root@192.168.5.159
```

### ขั้นตอนที่ 2: ตั้งค่า Antigravity MCP Configuration
เพิ่มบล็อกนี้ลงในไฟล์การตั้งค่า MCP:
* **Windows:** `C:\Users\<username>\.gemini\config\mcp_config.json`
* **Mac/Linux:** `~/.gemini/config/mcp_config.json`

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

เมื่อเปิด Antigravity ขึ้นมา จะมี Tools ให้ใช้งานทันที:
* `proxmox-agent:run_dual_task` (รันทั้งสองโมเดลพร้อมกัน)
* `proxmox-agent:run_codex_task` (รันเฉพาะ Codex)
* `proxmox-agent:run_deepseek_task` (รันเฉพาะ DeepSeek R1)
* `proxmox-agent:list_workspaces`
* `proxmox-agent:clone_repo`

---

## 6. การใช้งาน Dashboard และฟีเจอร์ Side-by-Side Dual View

เปิดเบราว์เซอร์ไปที่: **`http://192.168.5.159:3000`**

* **ตัวกรองประวัติ (History Filter):**
  * ปุ่ม `[All]` | `[Codex]` | `[R1]` | `[Dual]` กรองดูเฉพาะโมเดลที่ต้องการได้ทันที
* **สลับมุมมองผลลัพธ์ (Model View Switcher):**
  * **`[Side-by-Side (Compare)]`**: แบ่ง 2 คอลัมน์ ซ้าย (Codex: gpt-6.1-sol) ขวา (DeepSeek R1: 14b GPU) เทียบคำตอบและการวิเคราะห์ของทั้งสองโมเดล
  * **`[Codex Only]`**: ดูเฉพาะคำตอบ, การวิเคราะห์ และ Git Diff ของ Codex เต็มจอ
  * **`[DeepSeek R1 Only]`**: ดูเฉพาะกระบวนการคิด Chain of Thought (กล่องสีม่วงพับเก็บได้) และคำตอบของ DeepSeek เต็มจอ
* **Server-Side Rendering (SSR):**
  * หน้าเว็บโหลดประวัติและสถานะจากเซิร์ฟเวอร์มาใน HTML ทันที ไม่ต้องรอ client-side fetch

---

## 7. คำสั่งจัดการและ Systemd Service

```bash
# Restart Web Dashboard
systemctl restart agent-web

# ดูสถานะและ Log แบบ Real-time
systemctl status agent-web
journalctl -u agent-web -f -n 50

# ดูประวัติ Task ในระบบ
cat /opt/agent-bridge/tasks_history.json | jq '.[0]'
```
