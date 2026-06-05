# Bootstrap — first publish of `@particle-academy/fancy-heuristics-js`

This package is **code-complete, build-green, test-green** but has **never been
published**. The first publish needs a one-time manual gate (npm Trusted
Publisher config can't be done by an agent). Procedure mirrors
`fancy-ui/docs/publishing.md` § "Bootstrapping a brand-new package".

Current state:

- `package.json` `version` is `0.0.0` (intentionally un-bumped).
- Local git repo initialised with an initial commit. **No remote, no tags, no
  push.**
- `.github/workflows/publish.yml` is the OIDC-ready workflow (fires on `v*.*.*`
  tags). `ci.yml` type-checks + tests + builds on push/PR.

## One-time steps (user-gated)

1. **Create the GitHub repo** (public, org `Particle-Academy`):

   ```bash
   gh repo create Particle-Academy/fancy-heuristics-js \
     --public \
     --description "Zero-dependency browser collector SDK for Fancy Heuristics (human + agent interaction events)" \
     --source . --remote origin
   ```

2. **Push `main`** (no tag yet):

   ```bash
   git push -u origin main
   ```

3. **Bootstrap token for the very first publish** (npm won't let you configure a
   Trusted Publisher for a package that doesn't exist yet). Create a 7-day
   granular token at `https://www.npmjs.com/settings/<your-user>/tokens` scoped
   to `@particle-academy` (read+write), then:

   ```bash
   gh secret set NPM_TOKEN --repo Particle-Academy/fancy-heuristics-js
   ```

   Temporarily add a token step to `publish.yml` (or run `npm publish` locally
   with the token):

   ```yaml
       - name: Publish (bootstrap)
         env:
           NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
         run: npm publish --provenance --access public
   ```

4. **Bump the version and ship the first release.** From this folder:

   ```bash
   # set version 0.1.0 in package.json (first real release)
   git add package.json && git commit -m "chore: release v0.1.0"
   git tag v0.1.0 && git push origin main --tags
   ```

   CI builds and publishes the first version.

5. **Configure the Trusted Publisher (after the first publish lands).** At
   `https://www.npmjs.com/package/@particle-academy/fancy-heuristics-js/access`
   → **Trusted Publishers** → **Add**:
   - Publisher: `GitHub Actions`
   - Organization or user: `Particle-Academy`
   - Repository: `fancy-heuristics-js`
   - Workflow filename: `publish.yml`
   - Environment: *(empty)*

6. **Revoke the bootstrap token** and **remove the `NODE_AUTH_TOKEN` step** from
   `publish.yml`, leaving just
   `npx -y npm@latest publish --provenance --access public` (the committed form).
   Every subsequent release then ships via OIDC on tag push — no tokens.

## After bootstrap — normal release

```bash
# bump version in package.json
git add package.json && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z && git push origin main --tags
# verify:
npm view @particle-academy/fancy-heuristics-js version
```

## Hard requirements already satisfied (don't remove)

- `repository.url` = `git+https://github.com/Particle-Academy/fancy-heuristics-js.git`
  (npm provenance rejects publish if missing/mismatched).
- `homepage` + `bugs` URLs set.
- `files` ships `dist` + `README.md`.
- The workflow uses `npx -y npm@latest publish` (bundled npm in setup-node is too
  old for OIDC — see `docs/publishing.md`).
