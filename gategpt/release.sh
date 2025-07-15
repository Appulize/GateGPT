#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="maciekish/gategpt"
EXCLUDE_DIRS="\\.git|vendor|node_modules|GateGPT/node_modules"

##############################################################################
# Decide whether we need sudo for Docker
##############################################################################
if [[ "$(uname -s)" == "Darwin" || "$(id -u)" -eq 0 ]]; then
  DOCKER="docker"
else
  DOCKER="sudo docker"
fi
echo "Using Docker command: $DOCKER"

##############################################################################
# 1. Detect current version (Git tag) and plain string
##############################################################################
OLD_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
OLD_VER=${OLD_TAG#v}
echo "Current version: $OLD_TAG"

##############################################################################
# 2. Ask for the next version
##############################################################################
read -rp "Enter new version (vX.Y.Z): " INPUT
if [[ $INPUT =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  NEW_VER="${BASH_REMATCH[1]}"
  NEW_TAG="v$NEW_VER"
else
  echo "❌ Format must be v1.2.3"; exit 1
fi
echo "Release will be tagged as $NEW_TAG and files updated to $NEW_VER"

##############################################################################
# 3. Replace OLD_TAG→NEW_TAG and OLD_VER→NEW_VER in every tracked file
##############################################################################
echo "🔄 Updating source tree…"
git ls-files -z | grep -vzE "$EXCLUDE_DIRS" |
  xargs -0 perl -pi -e 's/\Q'"$OLD_TAG"'\E/'"$NEW_TAG"'/g; s/\Q'"$OLD_VER"'\E/'"$NEW_VER"'/g'

##############################################################################
# 4. Commit, tag, push
##############################################################################
git add -u
git commit -m "🔖 Bump version to $NEW_TAG"
git tag -a "$NEW_TAG" -m "Release $NEW_TAG"
git push && git push --tags

##############################################################################
# 5. Multi-arch build & push to Docker Hub
##############################################################################
echo "🐳 Building & pushing Docker images…"
$DOCKER run --privileged --rm tonistiigi/binfmt:latest

# Expose version info to docker-bake.hcl
export GATEGPT_VERSION="$NEW_VER"
export GATEGPT_TAG="$NEW_TAG"

$DOCKER buildx create --name gategptbuilder --use
$DOCKER buildx bake --push
$DOCKER buildx rm gategptbuilder

##############################################################################
# 6. Done
##############################################################################
echo -e "\n✅ Release $NEW_TAG completed!"
echo "  • GitHub tag pushed"
echo "  • Docker images: docker.io/$DOCKER_REPO:$NEW_VER  and :latest"