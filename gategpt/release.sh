#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="maciekish/gategpt"
PKG_DIR="GateGPT"                        # <-- where package.json lives
EXCLUDE_RE='\.git|vendor|node_modules|GateGPT/node_modules|package-lock\.json|yarn\.lock|pnpm-lock\.yaml'

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
# 1. Detect current version
##############################################################################
OLD_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
OLD_VER=${OLD_TAG#v}
echo "Current version: $OLD_TAG"

##############################################################################
# 2. Ask for the next version
##############################################################################
read -rp "Enter new version (vX.Y.Z) [leave blank to rebuild only]: " INPUT

BUILD_ONLY=0
if [[ -z $INPUT ]]; then
  echo "⚙️  No version entered – build images only."
  NEW_VER="$OLD_VER"
  NEW_TAG="$OLD_TAG"
  BUILD_ONLY=1
elif [[ $INPUT =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  NEW_VER="${BASH_REMATCH[1]}"
  NEW_TAG="v$NEW_VER"
  if [[ "$NEW_TAG" == "$OLD_TAG" ]]; then
    echo "⚙️  Same version as current – build images only."
    BUILD_ONLY=1
  fi
else
  echo "❌ Format must be v1.3.2"; exit 1
fi
echo "Using version: $NEW_TAG"

##############################################################################
# 3. Update sources & lock file (unless build-only)
##############################################################################
if [[ $BUILD_ONLY -eq 0 ]]; then
  echo "🔄 Updating version strings…"

  # --- bump package.json + regenerate lock, but INSIDE $PKG_DIR ---
  pushd "$PKG_DIR" >/dev/null
  npm version --no-git-tag-version "$NEW_VER"
  npm install --package-lock-only --omit=dev
  popd >/dev/null

  # Replace remaining occurrences, skipping lock files
  git ls-files -z | grep -vzE "$EXCLUDE_RE" |
    xargs -0 perl -pi -e 's/\Q'"$OLD_TAG"'\E/'"$NEW_TAG"'/g; s/\Q'"$OLD_VER"'\E/'"$NEW_VER"'/g'

  git add -u
  git commit -m "🔖 Bump version to $NEW_TAG"
  git tag -a "$NEW_TAG" -m "Release $NEW_TAG"
  git push && git push --tags
else
  echo "ℹ️  Skipping Git commit/tag/push."
fi

##############################################################################
# 4. Multi-arch build & push
##############################################################################
echo "🐳 Building & pushing Docker images…"
$DOCKER run --privileged --rm tonistiigi/binfmt:latest

export GATEGPT_VERSION="$NEW_VER"
export GATEGPT_TAG="$NEW_TAG"

$DOCKER buildx rm gategptbuilder 2>/dev/null || true   # clean up if exists
$DOCKER buildx create --name gategptbuilder --use
$DOCKER buildx bake --push
$DOCKER buildx rm gategptbuilder

##############################################################################
# 5. Done
##############################################################################
echo -e "\n✅ Operation completed!"
echo "  • Docker images: docker.io/$DOCKER_REPO:$NEW_VER  and :latest"
[[ $BUILD_ONLY -eq 0 ]] && echo "  • GitHub tag pushed ($NEW_TAG)"