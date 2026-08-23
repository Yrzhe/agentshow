#!/usr/bin/env bash
# Fail if cloudflare-os is not a clean submodule gitlink.
# Notice (do not fail) when official cloudflare-os main is ahead of our pin.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

entry=$(git ls-files -s cloudflare-os || true)
if [[ -z "$entry" ]]; then
  echo "error: cloudflare-os is missing from the index"
  exit 1
fi

mode=$(awk '{print $1}' <<<"$entry")
sha=$(awk '{print $2}' <<<"$entry")

if [[ "$mode" != "160000" ]]; then
  echo "error: cloudflare-os must stay a git submodule (mode 160000)."
  echo "do not copy official source into the tree. got mode $mode"
  exit 1
fi

inside=$(git ls-files 'cloudflare-os/**' 'cloudflare-os/*' || true)
if [[ -n "$inside" ]]; then
  echo "error: files were committed inside cloudflare-os/. only the gitlink is allowed."
  echo "$inside"
  exit 1
fi

echo "ok: cloudflare-os is a submodule pin $sha"

remote=$(git ls-remote https://github.com/cloudflare/cloudflare-os.git refs/heads/main | awk '{print $1}')
if [[ -z "$remote" ]]; then
  echo "warning: could not read official main"
  exit 0
fi

if [[ "$sha" == "$remote" ]]; then
  echo "ok: pin matches cloudflare/cloudflare-os main"
else
  echo "::notice title=Official OS is ahead::pinned $sha ; official main $remote. bump the submodule when you choose to upgrade."
  echo "notice: official main is $remote ; we are on $sha (not an error)"
fi
