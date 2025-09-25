# ai-renamer

A Node.js CLI that uses local or hosted multimodal LLMs to inspect a file's contents and generate a descriptive, case-formatted filename. The tool was built for power users who download large research batches—investors, analysts, creative teams—and need a trustworthy assistant to triage, rename, and optionally reorganize assets.

[![npm](https://img.shields.io/npm/v/ai-renamer.svg?style=flat-square)](https://www.npmjs.com/package/ai-renamer)
[![license](https://img.shields.io/npm/l/ai-renamer?style=flat-square)](https://github.com/ozgrozer/ai-renamer/blob/main/license)

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Model Providers](#model-providers)
- [Command Options](#command-options)
- [Subject Organization Workflow](#subject-organization-workflow)
- [Contribution](#contribution)
- [License](#license)
- [Product Requirements Document](#product-requirements-document)

## Overview
`ai-renamer` is a cross-platform CLI for renaming files according to the information inside them. Point the command at a folder or a single file and the tool will extract context (text, OCR frames, metadata) before asking an LLM to craft a concise filename. Multiple providers are supported, including Ollama, LM Studio, and OpenAI.

The CLI stores your preferred switches (provider, model, case style, subject-organization behavior, etc.) in a local config file so recurring workflows stay one command away.

## Key Features
- **LLM-powered renaming** – Summarize documents, presentations, PDFs, videos, and images to craft human-readable filenames.
- **Provider flexibility** – Works with local Ollama models, LM Studio, or OpenAI models by toggling flags.
- **Case formatting** – Choose the case convention that best fits your filesystem (`camelCase`, `kebabCase`, `snakeCase`, etc.).
- **Batch processing** – Walk directory trees, optionally including subdirectories, and rename as you go.
- **Safety controls** – Use `--dry-run` to preview results, enforce size or extension allowlists/denylists, and print a summary report of every decision.
- **Subject organization** – Group files into startup- or project-specific folders, feed existing folder names back into prompts to keep naming consistent, and optionally quarantine uncertain matches in an `Unknown` folder.

## Installation
```bash
# Install globally
npm install -g ai-renamer

# Or run without installing
npx ai-renamer /path/to/files
```

## Quick Start
```bash
# Rename the files inside a directory using your saved defaults
ai-renamer ~/Downloads/Pitches

# Preview the run, print a summary, and direct new subject folders to a workspace
ai-renamer ~/Downloads/Pitches \
  --dry-run \
  --summary \
  --organize-by-subject \
  --subject-destination=~/DealRoom \
  --move-unknown-subjects
```

## Model Providers
### Ollama
Ollama is the default provider. The CLI will auto-select an available Llava model, but you can specify any local model.

```bash
npx ai-renamer /path --provider=ollama --model=llava:13b
```

### LM Studio
Point the CLI at LM Studio to reuse the model currently loaded in the desktop app.

```bash
npx ai-renamer /path --provider=lm-studio
```

### OpenAI
Set the provider to `openai` and supply an API key. The CLI defaults to `gpt-4o`, but you can request any other model.

```bash
npx ai-renamer /path --provider=openai --api-key=OPENAI_API_KEY
```

### Custom Ports
Explicitly set base URLs if your providers are exposed on non-default ports.

```bash
npx ai-renamer /path --provider=ollama --base-url=http://127.0.0.1:11434
npx ai-renamer /path --provider=lm-studio --base-url=http://127.0.0.1:1234
```

## Command Options
All CLI flags are persisted to `~/ai-renamer.json`, so you only need to configure them once. Run `npx ai-renamer --help` for the full list:

```text
Options:
  -h, --help                    Show help                              [boolean]
      --version                 Show version number                    [boolean]
  -p, --provider                Set the provider (e.g. ollama, openai,
                                lm-studio)                              [string]
  -a, --api-key                 Set the API key if you're using openai as
                                provider                                [string]
  -u, --base-url                Set the API base URL (e.g.
                                http://127.0.0.1:11434 for ollama)      [string]
  -m, --model                   Set the model to use (e.g. gemma2, llama3,
                                gpt-4o)                                 [string]
  -f, --frames                  Set the maximum number of frames to extract from
                                videos (e.g. 3, 5, 10)                  [number]
  -c, --case                    Set the case style (e.g. camelCase, pascalCase,
                                snakeCase, kebabCase)                   [string]
  -x, --chars                   Set the maximum number of characters in the new
                                filename (e.g. 25)                      [number]
  -l, --language                Set the output language (e.g. English, Turkish)
                                                                        [string]
  -s, --include-subdirectories  Include files in subdirectories when processing
                                (e.g: true, false)                      [string]
  -r, --custom-prompt           Add a custom prompt to the LLM (e.g. "Only
                                describe the background")               [string]
      --dry-run                 Preview suggestions without renaming     [boolean]
      --summary                 Print a summary report after the run     [boolean]
      --max-file-size           Skip files larger than the given size in MB
                                                                      [number]
      --only-extensions         Only process files with these extensions
                                                                      [string]
      --ignore-extensions       Skip files with these extensions         [string]
      --organize-by-subject     Group renamed files into subject folders
                                                                       [boolean]
      --subject-destination     Destination directory for subject folders
                                                                       [string]
      --move-unknown-subjects   Send low-confidence matches to an Unknown
                                 folder                                 [boolean]
```

`ai-renamer` uses the [`change-case`](https://github.com/blakeembrey/change-case) library for case styling:

```text
camelCase: twoWords
capitalCase: Two Words
constantCase: TWO_WORDS
dotCase: two.words
kebabCase: two-words
noCase: two words
pascalCase: TwoWords
pascalSnakeCase: Two_Words
pathCase: two/words
sentenceCase: Two words
snakeCase: two_words
trainCase: Two-Words
```

## Subject Organization Workflow
Enable `--organize-by-subject` to route accepted renames into folders named after their inferred company, project, or person. Before processing begins the CLI scans the destination directory, adds existing folder names to the prompt as hints, and keeps the list in memory to avoid duplicates during the run. Use `--subject-destination` to route the folders (and the generated log) to a different workspace, and add `--move-unknown-subjects` to quarantine low-confidence matches in an `Unknown` folder.

Dry-run mode prints the proposed folder moves without touching the filesystem so you can vet the plan before committing. When renames are confirmed, the tool records the chosen subject, destination, and confidence in the run summary for later auditing.

## Contribution
Feel free to contribute. Open a new [issue](https://github.com/ozgrozer/ai-renamer/issues) or start a [pull request](https://github.com/ozgrozer/ai-renamer/pulls).

## License
MIT

## Product Requirements Document
### 1. Purpose and Background
- **Problem**: Startup investors, researchers, and operators download numerous artifacts (pitch decks, financials, product shots). Files arrive with generic names, making due diligence slow and error prone.
- **Opportunity**: Automate the renaming and triage step by leveraging multimodal LLMs to understand file content, enforce a consistent taxonomy, and keep archives searchable.

### 2. Product Objectives
1. Generate concise, human-readable filenames that accurately reflect file contents.
2. Maintain a fast, privacy-friendly workflow by allowing local inference through Ollama or LM Studio.
3. Support organization features that mirror investors' mental models (by company/project/person) and prevent duplicate folders.
4. Provide safety nets—dry runs, size and extension filters, Unknown routing—so users can trust batch operations.

### 3. Target Users and Personas
- **Venture Capital Associate (Primary)**: Processes 50–200 documents per week across multiple deals, needs a sortable archive to brief partners.
- **Startup Advisor**: Collects product collateral from clients, wants folders grouped by company with minimal manual effort.
- **Operations Analyst**: Renames logs, specs, or compliance documents pulled from various systems and must guarantee traceability.

### 4. User Stories
- *As an associate*, I can point the CLI at a download folder and have files renamed and filed under the correct startup so prep work is faster.
- *As an advisor*, I can run in dry-run mode to verify subjects before allowing files to move into shared deal folders.
- *As an analyst*, I can skip oversized exports or irrelevant extensions to keep the run focused on the artifacts I need to archive.
- *As any user*, I can review a summary report to confirm what was renamed, moved, skipped, or flagged as Unknown.

### 5. Scope and Requirements
#### Functional Requirements
- The CLI SHALL support Ollama, LM Studio, and OpenAI providers, each configurable via flags.
- The CLI SHALL inspect text, images, and videos to extract meaningful context before prompting the model.
- The CLI SHALL support subject-aware organization, reusing existing folder names and logging subject confidence.
- The CLI SHALL respect dry-run mode by avoiding filesystem writes while still previewing renames and moves.
- The CLI SHALL persist user configuration between runs.

#### Non-Functional Requirements
- Operations MUST complete within a reasonable time for batches of 100 files on modern hardware (target: under 5 minutes for mixed PDFs and images with a local 7B–13B model).
- Actions MUST be transparent, with verbose logs and summary output for auditing.
- Defaults MUST favor privacy (local models, no cloud calls unless requested) and be recoverable through config resets.

### 6. Success Metrics
- ≥90% of renamed files pass manual spot checks for descriptive accuracy.
- ≥75% reduction in manual renaming time for a 50-file batch compared to baseline manual workflows.
- Zero data-loss incidents reported across the first 100 production runs (dry-run and Unknown routing prevent destructive moves).

### 7. Release Plan
1. **MVP**: Provider support, core renaming, case formatting, configuration persistence.
2. **Batch Controls**: Add dry-run, summary reporting, and filtering to improve trust in large runs.
3. **Subject Organization**: Introduce folder scanning, Unknown routing, and destination overrides tailored to startup diligence.
4. **Future Enhancements**: Add collaborative log exports, tagging, and deeper OCR integrations.

### 8. Risks and Mitigations
- **Model hallucination** → Allow manual confirmation, dry-run previews, and Unknown routing.
- **Duplicate folder sprawl** → Scan destination directories and normalize subject labels before creating folders.
- **Provider instability** → Support multiple providers and allow offline local models.

### 9. Open Questions
- Should the CLI offer plug-ins for CRM integrations (Affinity, HubSpot) to push renamed files automatically?
- Do users need a TUI/GUI layer for bulk approvals, or is the CLI sufficient for the core audience?
- What telemetry (if any) is acceptable for improving heuristics without violating privacy expectations?
