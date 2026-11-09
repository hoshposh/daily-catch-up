# Becoming an independent community plugin

What remains for this fork to be listed in Obsidian's community plugins under its own name and identity, separate from the upstream [Rollover Daily Todos](https://github.com/lumoe/obsidian-rollover-daily-todos).

State as of 2026-11-09: the review and aging features and the grouped settings screen are on `main`, pushed, and CI is green. What's left is identity, packaging and cleanup.

Why the plugin is distinct: see `docs/superpowers/specs/2026-11-03-migration-review-and-aging-design.md` (Intent). Its own work is the review dialog, rollover counting and stale todos, the backlog note, and the heading-aware rollover. Mark-as-moved, skip-existing, the Templater safeguard, `ignoreBlockquotes` and `skipCompletedChildren` came from upstream's unreleased `release/v1.3.0` branch, so they are not differentiators. Credit them as upstream's.

## 1. Identity (decide first; everything below depends on it)

- [ ] **Plugin name.** It must not contain "Obsidian" and must be clearly different from "Rollover Daily Todos". Build it around reviewing and carrying todos forward.
- [ ] **Plugin id** (`manifest.json` `id`, currently `rollover-daily-todos-lw`).
  - It is permanent once listed. It must be unique among community plugins, can't contain "obsidian", and can't end in "plugin".
  - Changing it moves where Obsidian keeps the plugin's settings (`.obsidian/plugins/<id>/data.json`).
    - [ ] Copy `data.json` into the new folder in each vault you use.
    - [ ] Rename the test vault's symlinked plugin folder, and update the plugin path in the local `/setup-test-fixture` script.

## 2. Release metadata

- [ ] `manifest.json`:
  - [ ] `name` and `id` from section 1.
  - [ ] `version` as plain `x.y.z`, e.g. `1.3.0`. Pre-release suffixes like `1.2.1-preview.4` aren't accepted.
  - [ ] `description`: one sentence starting with a verb, under 250 characters, ending with a period. No "This Obsidian.md plugin", no URL, no credit line (credit goes in the README).
- [ ] `package.json` `name` and `description` to match.
- [ ] `versions.json`: add the new version mapped to the current `minAppVersion` (`1.1.0`). The last entry is still `1.2.0` with `0.12.12`.
- [ ] A release process for community releases:
  - A normal GitHub release, not a pre-release.
  - Its tag equals the manifest version exactly, with no `v`.
  - Assets are `main.js`, `manifest.json` and `styles.css`.
  - Consider a tag-triggered GitHub Actions workflow that builds and attaches them. The current `ci.yml` only builds.
- [ ] Update the README's "Releasing a new version" section. It currently describes BRAT preview releases only.

## 3. Code that community review checks

- [ ] **Command ids.** Drop the embedded old plugin id, because Obsidian already prefixes command ids:
  - `obsidian-rollover-daily-todos-rollover` and `obsidian-rollover-daily-todos-undo` (`src/index.js`).
  - Changing them resets hotkeys bound to those commands.
- [ ] **Command name.** "Rollover Todos Now" becomes sentence case, e.g. "Roll over todos now", like "Undo last rollover".
- [ ] **Leftover upstream branding:**
  - [ ] the notice "RolloverTodosPlugin unable to rollover…" (`src/index.js`);
  - [ ] the `rollover-daily-todos:` prefix on console messages.
- [ ] **Console output.** Remove the per-rollover `console.log` ("N todos found in …", `src/index.js`). Keep `console.warn`/`console.error` only for real problems.
- [ ] **`vault.process` instead of `vault.modify`** for today's note (`src/index.js`) and in undo (`src/ui/UndoModal.js`). This is recommended rather than required, but it is flagged often.
- [ ] **Undo dialog title.** Use the modal's `titleEl` instead of `h3`/`h4` elements (`src/ui/UndoModal.js`). Minor.

## 4. Docs and repository

- [ ] README:
  - [x] Replace the "personal fork" banner at the top. Done with an "Origins and status" section. Trim it to a credit line once the plugin is listed.
  - [ ] Replace the install section that says the fork isn't in the community list and points to BRAT. Use normal installation once listed.
  - [ ] Lead with what's distinct (review, aging, backlog, heading-aware rollover).
  - [x] Keep a short credit section for the original plugin and its authors, noting what came from upstream's `release/v1.3.0`. Done in "Origins and status".
- [ ] `LICENSE`: keep Lukas Mölschl's MIT copyright line and add your own.
- [ ] `CLAUDE.md`:
  - [ ] Update the plugin name.
  - [ ] Keep or retire the "Fork and upstream relationship" section, depending on whether you still plan to cherry-pick from upstream.
- [ ] Optional: the GitHub repository is still a GitHub fork of upstream.
  - Listing doesn't require changing that.
  - For a separate identity, you can ask GitHub to detach the fork, and rename the repo to match the new name. GitHub redirects the old URL.

## 5. Optional cleanup before submitting

- [ ] Triage the deferred minor findings from the review and aging work. They're listed in the local `.superpowers/sdd/2026-11-07-migration-review-and-aging/progress.md`, which isn't committed. None blocks submission.

## 6. Submit

- [ ] Publish the first community release (section 2).
- [ ] Open a PR to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) adding the plugin to `community-plugins.json`:
  - `id`, `name`, `author` and `description` match `manifest.json` exactly;
  - `repo` is `owner/repo`.
- [ ] In the PR description, add a short "How this differs from Rollover Daily Todos" section: review, aging, backlog, heading-aware rollover. Credit upstream for the features that came from it.
- [ ] Respond to the automated validation and the human review. This can take weeks.
