# Becoming an independent community plugin

What remains for this fork to be listed in Obsidian's community plugins under its own name and identity, separate from the upstream [Rollover Daily Todos](https://github.com/lumoe/obsidian-rollover-daily-todos).

State as of 2026-11-09: the review and aging features and the grouped settings screen are on `main`, pushed, and CI is green. What's left is identity, packaging and cleanup.

Why the plugin is distinct: see `docs/superpowers/specs/2026-11-03-migration-review-and-aging-design.md` (Intent). Its own work is the review dialog, rollover counting and stale todos, the backlog note, and the heading-aware rollover. Mark-as-moved, skip-existing, the Templater safeguard, `ignoreBlockquotes` and `skipCompletedChildren` came from upstream's unreleased `release/v1.3.0` branch, so they are not differentiators. Credit them as upstream's.

## 1. Identity (decide first; everything below depends on it)

- [x] **Plugin name.** It must not contain "Obsidian" and must be clearly different from "Rollover Daily Todos". Build it around reviewing and carrying todos forward.
  - Chosen: **Daily Catch-Up** (decided 2026-11-09; no community plugin used "catch" in its id or name at the time).
  - The name doesn't say "todos", so the description and README carry the search terms ("todo", "roll over"). Description: "Catch up on unfinished todos from your previous daily note: roll them over to today, park them in a backlog, or cancel them."
- [x] **Plugin id**: `daily-catch-up` (was `rollover-daily-todos-lw`; free as of 2026-11-09).
  - It is permanent once listed. It must be unique among community plugins, can't contain "obsidian", and can't end in "plugin".
  - Changing it moves where Obsidian keeps the plugin's settings (`.obsidian/plugins/<id>/data.json`), and it resets hotkeys, which Obsidian stores as `<plugin id>:<command id>`.
    - [ ] Copy `data.json` into the new folder in each vault you use, and enable the plugin again there.
    - [x] Rename the test vault's symlinked plugin folder, and update the plugin path in the local `/setup-test-fixture` script.
    - [x] Vaults that installed a preview through BRAT: the first release with the new id installs as a second plugin next to the old one. Remove the old one after copying its `data.json`. Confirmed with `1.3.0-preview.1` on 2026-11-10: BRAT installed Daily Catch-Up next to Rollover Daily Todos (fork), both listed; copying `data.json` and disabling the old one worked.

## 2. Release metadata

- [ ] `manifest.json`:
  - [x] `name` and `id` from section 1.
  - [ ] `version` as plain `x.y.z`, e.g. `1.3.0`. Pre-release suffixes like `1.2.1-preview.4` aren't accepted. `1.3.0-preview.1` goes out first through BRAT to try the new id on a real install and the release workflow; then set `1.3.0` for the community release. The preview was published on 2026-11-09 and tested through BRAT on 2026-11-10.
  - [x] `description`: one sentence starting with a verb, under 250 characters, ending with a period. No "This Obsidian.md plugin", no URL, no credit line (credit goes in the README).
- [x] `package.json` `name` and `description` to match.
- [x] `versions.json`: add the new version mapped to the current `minAppVersion` (`1.1.0`). Added `"1.3.0": "1.1.0"`.
- [x] A release process for community releases:
  - A normal GitHub release, not a pre-release.
  - Its tag equals the manifest version exactly, with no `v`.
  - Assets are `main.js`, `manifest.json` and `styles.css`.
  - Done: `.github/workflows/release.yml` runs on a pushed tag, checks the tag against `manifest.json`, `package.json` and (for `x.y.z`) `versions.json`, runs the tests, builds, and creates a draft release with the three assets. A tag with a suffix becomes a pre-release, so it also serves BRAT previews. Publishing the draft stays manual. First run: `1.3.0-preview.1`, 2026-11-09, succeeded.
- [x] Update the README's "Releasing a new version" section. It now covers community releases and BRAT previews through the workflow.

## 3. Code that community review checks

- [x] **Command ids.** Drop the embedded old plugin id, because Obsidian already prefixes command ids:
  - `obsidian-rollover-daily-todos-rollover` is now `rollover`, and `obsidian-rollover-daily-todos-undo` is now `undo-rollover` (`src/index.js`). `review-and-rollover` was already fine.
  - Changing them resets hotkeys bound to those commands (done together with the plugin id change, so hotkeys only need re-binding once).
- [x] **Command name.** "Rollover Todos Now" is now "Roll over todos now", in sentence case like "Undo last rollover". The README, CONTRIBUTING, CLAUDE.md, the settings help and the Templater notice use the new name.
- [x] **Leftover upstream branding:**
  - [x] the notice "RolloverTodosPlugin unable to rollover…" (`src/index.js`), now "Couldn't roll over unfinished todos. Enable Daily Notes, or Periodic Notes with daily notes turned on.";
  - [x] the `rollover-daily-todos:` prefix on console messages, now `Daily Catch-Up:` (also added to the `Intl.Segmenter` fallback error, which had none).
- [x] **Console output.** Removed the per-rollover `console.log` ("N todos found in …", `src/index.js`). The remaining `console.warn`/`console.error` calls are for real problems only.
- [x] **`vault.process` instead of `vault.modify`** for today's note (`src/index.js`) and in undo (`src/ui/UndoModal.js`). This is recommended rather than required, but it is flagged often. Today's note is now read, planned and written in one `vault.process()`; undo restores every note with it. No `vault.modify` is left.
- [x] **Undo dialog title.** Uses the modal's `titleEl` instead of an `h3`, and a setting heading (`setHeading()`) instead of the `h4` (`src/ui/UndoModal.js`).

## 4. Docs and repository

- [ ] README:
  - [x] Replace the "personal fork" banner at the top. Done with an "Origins and status" section. Trim it to a credit line once the plugin is listed.
  - [ ] Replace the install section that says the fork isn't in the community list and points to BRAT. Use normal installation once listed.
    - Prepared: it names the community list as the way to install once listed, uses the new folder name for manual installs, and has an "Upgrading from Rollover Daily Todos (fork)" section (copy `data.json`, remove the old plugin, re-bind hotkeys). Drop the BRAT and "not yet listed" wording once listed.
  - [x] Lead with what's distinct (review, aging, backlog, heading-aware rollover).
  - [x] Keep a short credit section for the original plugin and its authors, noting what came from upstream's `release/v1.3.0`. Done in "Origins and status".
- [x] `LICENSE`: keep Lukas Mölschl's MIT copyright line and add your own.
- [x] `CLAUDE.md`:
  - [x] Update the plugin name.
  - [x] Keep or retire the "Fork and upstream relationship" section, depending on whether you still plan to cherry-pick from upstream. Kept and trimmed as "Origins and upstream": cherry-picking from upstream stays possible.
- [ ] Optional: the GitHub repository is still a GitHub fork of upstream. Left as is for now (2026-11-09); revisit before submitting.
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
