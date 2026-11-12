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

- [x] `manifest.json`:
  - [x] `name` and `id` from section 1.
  - [x] `version` as plain `x.y.z`, e.g. `1.3.0`. Pre-release suffixes like `1.2.1-preview.4` aren't accepted. `1.3.0-preview.1` goes out first through BRAT to try the new id on a real install and the release workflow; then set `1.3.0` for the community release. The preview was published on 2026-11-09 and tested through BRAT on 2026-11-10.
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
- [ ] Optional: the GitHub repository is still a GitHub fork of upstream.
  - [x] Renamed to `hoshposh/daily-catch-up` on 2026-11-10. GitHub redirects the old URL; never create a new `obsidian-rollover-daily-todos` repo on this account, or the redirect breaks.
  - [ ] Detaching the fork needs GitHub support. It doesn't change the fork policy question in section 6, which is about inherited code.

## 5. Optional cleanup before submitting

- [ ] Triage the deferred minor findings from the review and aging work. They're listed in the local `.superpowers/sdd/2026-11-07-migration-review-and-aging/progress.md`, which isn't committed. None blocks submission.

## 6. Submit

Plugins are no longer submitted by a PR to `obsidianmd/obsidian-releases`. They go through the [Obsidian Community directory](https://community.obsidian.md) (checked 2026-11-10 against the developer docs, `en/Community directory/` in [`obsidianmd/obsidian-developer-docs`](https://github.com/obsidianmd/obsidian-developer-docs)).

- [x] Publish the first community release (section 2). `1.3.0`, published 2026-11-10.
- [ ] **Blocker: approval to list a fork.** The [developer policies](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Community%20directory/Developer%20policies.md#forks) don't allow forks in the directory unless:

  - the original author gives explicit written approval, publicly verifiable; or
  - the original author is unreachable and the project hasn't been updated for at least 6 months, and then the original author is contacted and given 30 days to respond publicly.

  In both cases the original author must be credited as a contributor. Upstream is active (Lukas Mölschl pushed `release/v1.3.0` and commented on PR #167 in May 2026), so ask for approval. Asked on 2026-11-10 in [lumoe/obsidian-rollover-daily-todos#178](https://github.com/lumoe/obsidian-rollover-daily-todos/issues/178), framed as a different approach (review before rolling over) built on Rollover Daily Todos. Upstream's `release/v1.3.0` now has a section-aware rollover too (from tyrannikal's PR #167), so heading-aware rollover is no longer a clear differentiator to cite.

  - If approval is refused or never comes: keep distributing through BRAT and GitHub releases, or start a fresh repository with no upstream code, which the policy allows.

- [x] Sign in at community.obsidian.md with an Obsidian account, and connect GitHub under **Profile** (read-only access, used to verify you own the repository). Done 2026-11-10.
- [x] Optional: run Obsidian's [ESLint plugin](https://github.com/obsidianmd/eslint-plugin) locally first. It runs the same kind of checks as the automated review. Done 2026-11-10: no errors; the fixes shipped in `1.3.1`. One warning is left on purpose: no `getSettingDefinitions()`, so the settings are not in Obsidian's settings search on 1.13 and later.
- [ ] **Plugins → New plugin**: the form asks for the GitHub repository URL and the owner (yourself or an organization). Agree to the developer policies and to keep supporting the plugin, then submit. There is no free-text field for how it differs; the directory reads `manifest.json` and the README from the default branch.
- [ ] Respond to the automated review (sections **Manifest**, **Releases**, **Source code**, **Build verification**; each check is an error, warning, recommendation or pass). Fixes need a new release with a higher version. The plugin can't be installed from Obsidian until every error is resolved. The scanner builds with the `build` script.
- [x] Optional: under **Profile**, turn on **Action required notifications** to get an email when a check fails later. Turned on 2026-11-10.
