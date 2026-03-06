# Release Workflow

## Feature or Fix

```
1. Create branch      git checkout -b feat/my-feature
2. Make changes        (code + tests)
3. Update docs         (alerts.md, cli-reference.md, configuration.md, etc.)
4. Update CHANGELOG    (add entry under new version heading)
5. Push branch         git push origin feat/my-feature
6. Create PR           gh pr create
7. Wait for CI         (typecheck + lint + tests must pass)
8. Merge PR
```

## Publish to npm

After merging:

```
9.  Pull main          git checkout main && git pull
10. Bump version       npm version patch|minor|major --no-git-tag-version
11. Build              npm run build
12. Publish            npm publish
13. Commit version     git add package.json && git commit -m "chore: bump to vX.Y.Z"
14. Push               git push
15. Create release     gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

## Version Bumps

| Change | Bump | Example |
|--------|------|---------|
| Bug fix, typo, lint fix | `patch` | 1.1.1 → 1.1.2 |
| New feature, new provider, new command | `minor` | 1.1.0 → 1.2.0 |
| Breaking config change, removed feature | `major` | 1.0.0 → 2.0.0 |

## Checklist

Before publishing:

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` has 0 errors (warnings OK)
- [ ] `npm test` passes
- [ ] CHANGELOG.md updated
- [ ] Docs updated if new feature
- [ ] Version bumped in package.json

## Quick Reference

```bash
# Full release flow (after PR is merged)
git checkout main && git pull
npm version minor --no-git-tag-version
npm run build
npm publish
git add package.json && git commit -m "chore: bump to v$(node -p 'require("./package.json").version')"
git push
gh release create "v$(node -p 'require("./package.json").version')" --generate-notes
```
