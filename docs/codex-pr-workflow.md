# Codex PR Workflow Verification

This document describes the local LLM development environment and the verification purpose using the following tools:

- **x670** – hardware accelerator used for running large language models.
- **gpt-oss-120b** – the open‑source 120‑billion‑parameter GPT model.
- **llama.cpp** – lightweight inference engine for LLaMA‑style models.
- **Codex CLI** – command‑line interface for interacting with the local Codex LLM.
- **GitHub CLI (gh)** – used to manage GitHub issues, pull requests and repository actions.

The goal is to confirm that changes made locally with these tools can be pushed to GitHub and opened as a draft Pull Request without affecting the `master` branch.
