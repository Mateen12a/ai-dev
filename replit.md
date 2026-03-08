# SudoAI — AI Development Platform

## Overview
A Replit-like AI-powered development platform. Users describe software with a prompt, and Gemini AI generates code, provides a live preview, real bash shell, secrets management, git version control, project management, and a full IDE workspace.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + shadcn/ui + Vite + Wouter + TanStack Query
- **Backend**: Express.js (Node.js) + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI Model**: Google Gemini 2.0 Flash (`gemini-2.0-flash`) — only model available on this API key tier; used for all AI calls
- **Shell**: Real bash via Node.js `child_process.exec` (server/project-fs.ts)
- **State Management**: TanStack React Query v5

## Key Features

### Home Page (`/`)
- Prompt-based project creation ("What do you want to build?")
- 16 templates across 5 categories (Backend, Full Stack, Frontend, AI/ML) — 8 shown in main grid, "Browse all (16)" opens a full modal with search + category filters
- Recent projects list at bottom
- Gemini AI generates appropriate project files based on prompt
- GitHub and ZIP import

### Projects Page (`/projects`)
- Full listing of all projects in a searchable grid
- Search/filter by project name
- Delete with confirmation dialog
- Click to open workspace

### Workspace (`/workspace/:id`) — Full-screen Replit-like IDE
- **Top bar**: Project name, Run/Stop, Preview, Config (opens `.agent.json`), Deploy, Home, Swap panels
- **`.agent.json` run config**: Gear icon button opens or creates `.agent.json` in the editor. Fields: `run` (custom start command), `install`, `description`. Process manager reads this file first when determining how to run the project.
- **Left icon sidebar** (48px): Files, Source Control (Git), Secrets, Deploy panels
- **File Explorer**: Tree view, file creation/deletion
- **Code Editor**: Multi-tab with unsaved indicator, line numbers, tab handling, Ctrl+S to save
- **Bottom panel tabs** (Console + Shell only):
  - **Console**: Live build/run logs from DB with auto-refresh
  - **Shell**: Real bash terminal with auto-detection of project type, Run App and Install buttons, command history, cwd tracking
- **AI Agent panel** (right side panel, 320px wide, collapsible):
  - Powered by Gemini 2.0 Flash
  - Agentic run-and-fix loop: writes files → runs shell commands → reads errors → fixes → up to 4 iterations
  - Live status while thinking (polls project logs)
  - Code block rendering with syntax highlighting
  - File update indicators
- **Swap panels**: Button to swap explorer and agent panel sides (left ↔ right)
- **Preview panel** (togglable, replaces agent when active): iframe preview, refresh, open in new tab
- **Git panel**: Real git status/log via git CLI, commit with message, commit history
- **Secrets panel**: Per-project environment variables, stored securely in DB, injected into shell sessions
- **Deploy panel**: One-click deployment with live URL

## API Routes

### Projects
- `GET /api/projects` — list all
- `POST /api/projects` — create (generates files via Gemini)
- `PATCH /api/projects/:id` — update
- `DELETE /api/projects/:id` — delete
- `POST /api/projects/import/github` — clone GitHub repo
- `POST /api/projects/import/zip` — extract ZIP file

### Files
- `GET /api/projects/:id/files` — list files
- `POST /api/projects/:id/files` — create file
- `PATCH /api/projects/:id/files/:fileId` — update content (syncs to filesystem)
- `DELETE /api/projects/:id/files/:fileId` — delete

### Shell (Real bash)
- `POST /api/projects/:id/shell` — execute command in project's temp dir

### Git
- `GET /api/projects/:id/git/status` / `log` / `diff`
- `POST /api/projects/:id/git/commit` / `init`

### Secrets
- `GET/POST/PATCH/DELETE /api/projects/:id/secrets`

### AI Agent
- `GET /api/projects/:id/messages` — chat history
- `POST /api/projects/:id/messages` — send message (triggers agentic loop)
- `DELETE /api/projects/:id/messages` — clear history

### Preview / Build / Deploy
- `GET /api/projects/:id/preview`
- `POST /api/projects/:id/build` / `test` / `deploy`

## Database Tables
- `projects` — project metadata
- `project_files` — file content per project
- `ai_messages` — chat history per project
- `build_logs` — console/build/agent logs per project (stage: console|build|agent)
- `deployments` — deployment history
- `project_secrets` — per-project key-value secrets
- `git_commits` — git commit history

## Project Filesystem
- Projects get real directories at `/tmp/devforge-projects/:id/`
- Files are synced to filesystem when saved
- Shell commands run in project directory with secrets as env vars
- Git repos initialized per project

## User Preferences
- Dark/light mode toggle in global header
- Workspace is full-screen (no global sidebar)
- Agent panel can be toggled and swapped to left or right side
