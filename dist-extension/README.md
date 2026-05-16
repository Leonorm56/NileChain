# NileChain

Telegram Mini-Apps automation tool — distribution bundle in this repository.

## Release workflow

This repository contains a GitHub Actions workflow at `.github/workflows/release.yml` that:

- runs on pushed tags matching `v*` or via manual `workflow_dispatch`
- runs `npm publish` (requires `NPM_TOKEN` secret)
- creates a GitHub release with the generated `*.tgz` artifact

## Setup

1. Add `NPM_TOKEN` to repository secrets:

   - In GitHub: Settings → Secrets → Actions → New repository secret
   - Name: `NPM_TOKEN`
   - Value: your npm auth token

2. Ensure `package.json` contains correct `name`, `version`, and `repository` fields.

## Publish a release

Locally create a tag and push it to trigger the workflow:

```bash
# commit your changes
git add package.json README.md .github/workflows/release.yml
git commit -m "chore(release): prepare vX.Y.Z"
# create and push tag (example v1.0.36)
git tag v1.0.36
git push origin --tags
```

The workflow will run and publish the package to npm and create a GitHub release.

## Notes

- If a tag already exists on the remote, delete or overwrite it carefully.
- Adjust `package.json` metadata (author, license) as needed.
