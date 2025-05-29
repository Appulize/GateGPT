#!/usr/bin/env bash
# release.sh – bump version, tag, push, build, publish
# Works with version strings 0.8.0 or v0.8.0 in prompts & files.

set -euo pipefail

DOCKER_REPO="maciekish/gategpt"
EXCLUDE_DIRS="\\.git|vendor|node_modules|GateGPT/node_modules"

#───────────────────────────────────────────────────────────────────────
# 1. Detect current version
#───────────────────────────────────────────────────────────────────────
OLD_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
OLD_VER=${OLD_TAG#v}                # strip leading 'v'
echo "Current version: $OLD_TAG  (plain: $OLD_VER)"

#───────────────────────────────────────────────────────────────────────
# 2. Ask for the new version
#   Accept 0.8.1  or  v0.8.1  and normalise both forms
#───────────────────────────────────────────────────────────────────────
read -rp "Enter new version (X.Y.Z or vX.Y.Z): " INPUT
if [[ $INPUT =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  NEW_VER="${BASH_REMATCH[1]}"
  NEW_TAG="v$NEW_VER"
elif [[ $INPUT =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VER="$INPUT"
  NEW_TAG="v$NEW_VER"
else
  echo "❌  Format must be 1.2.3 or v1.2.3"; exit 1
fi
echo "Release will be tagged as $NEW_TAG and files updated to $NEW_VER"

#───────────────────────────────────────────────────────────────────────
# 3. Replace every occurrence  OLD_TAG → NEW_TAG   and  OLD_VER → NEW_VER
#───────────────────────────────────────────────────────────────────────
echo "🔄  Updating source tree…"
git ls-files -z | grep -vzE "$EXCLUDE_DIRS" |
  xargs -0 perl -pi -e 's/\Q'"$OLD_TAG"'\E/'"$NEW_TAG"'/g' \
                 -e 's/\Q'"$OLD_VER"'\E/'"$NEW_VER"'/g'

#───────────────────────────────────────────────────────────────────────
# 4. Commit, tag, push
#───────────────────────────────────────────────────────────────────────
git add -u
git commit -m "🔖 Bump version to $NEW_TAG"
git tag -a "$NEW_TAG" -m "Release $NEW_TAG"
git push && git push --tags

#───────────────────────────────────────────────────────────────────────
# 5. Multi-arch build & push to Docker Hub
#───────────────────────────────────────────────────────────────────────
echo "🐳  Building & pushing Docker images…"
export VERSION="$NEW_VER"                 # used by docker-bake.hcl
docker buildx bake --push

echo -e "\n✅  Release $NEW_TAG completed!"
echo "   • GitHub tag pushed"
echo "   • Docker images: docker.io/$DOCKER_REPO:$NEW_VER  &  :latest"