# Design records

One document per feature, written before it is built: why it exists, its goals, non-goals and anti-goals, the approaches considered, and the decisions made. Named `YYYY-MM-DD-<topic>-design.md` after the day it was written. [The roadmap](../roadmap.md) says which feature each one belongs to and whether it shipped.

A design is kept as it was approved, plus any follow-ups decided later, so it explains why the code behaves as it does. The code, the tests and `CLAUDE.md` describe how it behaves today.

Implementation plans (the step-by-step task lists a feature is built from) live in `plans/` while their feature is in progress and are deleted when it merges. Older ones are in git history:

```bash
git log --diff-filter=D --name-only -- 'docs/superpowers/plans/*' 'docs/design/plans/*'
```
