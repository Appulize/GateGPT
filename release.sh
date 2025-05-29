#!/usr/bin/env bash
# release.sh – bump version, tag, push, build, publish

set -euo pipefail

DOCKER_REPO="maciekish/gategpt"
EXCLUDE_DIRS="\.git|vendor|node_modules|GateGPT/node_modules"

# 1. Current version = most recent tag
OLD_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo "Current version: $OLD_TAG"

# 2. Ask for the new version
read -rp "Enter new version tag (format vX.Y.Z): " NEW_TAG
[[ $NEW_TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "❌  Tag must look like v1.2.3"; exit 1; }

# 3. Replace everywhere (portable Perl inline; sed -i differs on macOS/GNU)
echo "🔄  Replacing $OLD_TAG → $NEW_TAG in source tree…"
OLD_ESC=$(printf '%s' "$OLD_TAG" | perl -pe 's/[][\/.^$*+?{}()|]/\\$&/g')
NEW_ESC=$(printf '%s' "$NEW_TAG" | perl -pe 's/\\/\\\\/g')

git ls-files -z | grep -vzE "$EXCLUDE_DIRS" \
  | xargs -0 perl -pi -e "s/$OLD_ESC/$NEW_ESC/g"

# 4. Commit + tag + push
git add -u
git commit -m "🔖 Bump version to $NEW_TAG"
git tag -a "$NEW_TAG" -m "Release $NEW_TAG"
git push && git push --tags

# 5. Buildx: multi-arch build + push to Docker Hub
echo "🐳  Building & pushing Docker images…"
export VERSION="$NEW_TAG"
docker buildx bake --push

echo -e "\n✅  Release $NEW_TAG is live!\n  • GitHub tag pushed\n  • Image: docker.io/$DOCKER_REPO:$NEW_TAG\n"ch