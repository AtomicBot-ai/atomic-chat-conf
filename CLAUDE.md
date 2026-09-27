# atomic-chat-conf

## Planning and features

- Plans for this repository live in ../atomic-chat-spec (OpenSpec store
  `atomic-chat-spec`; `openspec doctor` shows it). Features are planned there
  with `/feature`; this repository's part is executed here with
  `/add-dir ../atomic-chat-spec`, then `/feature-exec <change-id>`.
- This repository's tasks.md prefix: `conf:`.
- Never plan with `superpowers:brainstorming` or `superpowers:writing-plans`,
  and never create `docs/superpowers/*`.
- Worktree preference: none. Work on branch `change/<change-id>` in place.
- Verify with: `make validate`.
- Bug fixes and small edits in this repository alone need no OpenSpec change.
