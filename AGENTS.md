<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CC-Kit React Project Architecture

This project is a Web 3D Skyrim Character Creator & Asset Studio powered by Next.js 16, React 19, Three.js, and Claude Code Game Studios presets.

- See [CLAUDE.md](file:///c:/Users/kenko/Desktop/priject/cc-kit-react/CLAUDE.md) for full project stack and guidelines.
- See [.claude/](file:///c:/Users/kenko/Desktop/priject/cc-kit-react/.claude/) for Claude Code Game Studios agents, rules, and skills.
- See [.agents/skills/rigging-expert/](file:///c:/Users/kenko/Desktop/priject/cc-kit-react/.agents/skills/rigging-expert/) and [.claude/agents/rigging-engineer.md](file:///c:/Users/kenko/Desktop/priject/cc-kit-react/.claude/agents/rigging-engineer.md) for 3D rigging and skeletal architecture.
- See [.agents/skills/skyrim-mod-expert/](file:///c:/Users/kenko/Desktop/priject/cc-kit-react/.agents/skills/skyrim-mod-expert/) and [.claude/agents/skyrim-mod-expert.md](file:///c:/Users/kenko/Desktop/priject/cc-kit-react/.claude/agents/skyrim-mod-expert.md) for Skyrim engine internals, NIF, DDS, and MO2 pipelines.

