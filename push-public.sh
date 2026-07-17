#!/usr/bin/env bash
#
# Push the app sources to the PUBLIC forkable Apps Script project.
#
# Plain `clasp push` still targets the PRIVATE project via .clasp.json — that
# workflow is unchanged. This script is the only thing that touches public.
#
# It pins BOTH the project file and the ignore file, so it cannot pick up the
# maintenance-script whitelist in .claspignore. See AGENT.md "Deploy workflow".
#
# Usage: ./push-public.sh [extra clasp push flags]
set -euo pipefail
cd "$(dirname "$0")"

for f in .clasp.public.json .claspignore.public; do
  if [[ ! -f "$f" ]]; then
    echo "error: $f is missing — see AGENT.md 'Deploy workflow'." >&2
    exit 1
  fi
done

echo "==> Pushing to PUBLIC project (forkable template)"
clasp -P .clasp.public.json -I .claspignore.public push --force "$@"
