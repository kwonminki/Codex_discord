## Summary

- 

## Testing

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `npm pack --dry-run` when package contents may be affected
- [ ] Manual Discord test when command routing, buttons, slash commands, sync, or setup changed

## Security review

- [ ] No tokens, `.env`, `.connect/`, logs, local databases, or Codex session/transcript files are included
- [ ] Role checks and channel boundaries still fail closed
- [ ] Destructive or risky commands still require clear confirmation
- [ ] `SECURITY.md` was updated, or this PR does not affect the security model

## Notes

- Related issue:
