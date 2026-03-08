# SudoAI — AI Development Platform

## Overview
SudoAI is an AI-powered development platform, akin to Replit. It enables users to describe software using natural language prompts, upon which Gemini AI generates the necessary code. The platform provides a comprehensive development environment including a live preview, a real bash shell, secrets management, Git version control, project management tools, and a full IDE workspace. Its core vision is to democratize software development by making it accessible through AI-driven code generation and a streamlined development workflow.

## User Preferences
- Dark/light theme toggle in workspace header (Sun/Moon icon), persisted in localStorage
- CodeMirror editor switches between light and dark themes dynamically
- Workspace is full-screen (no global sidebar)
- Agent panel can be toggled and swapped to left or right side

## System Architecture
The platform is built with a modern web stack:
- **Frontend**: React, TypeScript, Tailwind CSS, shadcn/ui, Vite, Wouter, and TanStack Query.
- **Backend**: Express.js with Node.js and TypeScript.
- **Database**: PostgreSQL with Drizzle ORM.
- **AI Model**: Primarily Google Gemini 2.0 Flash (`gemini-2.0-flash`), with Claude (Anthropic) as an optional fallback.
- **Shell & Terminal**: A real bash shell is provided via Node.js `child_process.exec`, and a real PTY terminal is implemented using `node-pty`.
- **State Management**: TanStack React Query v5 handles client-side state.

**Key Architectural Features:**
- **AI Agent Modes**: The AI agent operates in 7 distinct modes (Lite, Economy, Power, Agent, Max, Test, Optimize), each automatically selecting the optimal Gemini model based on task complexity (Flash for speed, Pro for complex tasks and deep reasoning).
- **Workspace IDE**: A full-screen, Replit-like IDE featuring a CodeMirror 6 editor with extensive language support, syntax highlighting, code folding, and advanced editing features. It includes a file explorer, integrated Git control, secrets management, and a deploy panel.
- **Real-time Feedback**: The AI agent provides structured, real-time feedback during execution, showing actions like thinking, file edits, shell commands, and error detection through inline indicators.
- **Process Management**: Supports running and managing multiple project processes with live logs and individual controls.
- **Runtime Detection**: Automatically detects project languages (Node.js, Python, Go, Rust, Ruby, Java) and frameworks to configure appropriate run and install commands.
- **Mobile Responsiveness**: Adapts the UI for smaller screens by collapsing sidebars, providing mobile-specific panel toggles, and optimizing information display.

## External Dependencies
- **Google Gemini API**: Used for AI code generation and agentic operations.
- **Anthropic Claude API**: Serves as an optional AI provider fallback.
- **PostgreSQL**: The primary relational database for storing project data, files, messages, and configurations.
- **npm registry**: For package management and dependency resolution in Node.js projects.
- **Git CLI**: Integrated for version control functionalities within the workspace.
- **xterm.js**: Used for rendering the interactive terminal within the IDE.