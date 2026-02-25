#!/usr/bin/env bash
set -euo pipefail

# Always operate relative to this script's directory (`gategpt`), no matter
# where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DOCKER_REPO="maciekish/gategpt"
PKG_DIR="GateGPT"                        # <-- where package.json lives
PKG_JSON="$PKG_DIR/package.json"
LOCK_JSON="$PKG_DIR/package-lock.json"
ADDON_JSON="config.json"
BAKE_HCL="docker-bake.hcl"
MAIN_JS="$PKG_DIR/main.js"

##############################################################################
# Update only known GateGPT version fields. Never do recursive replacements.
##############################################################################
set_gategpt_versions() {
  local new_ver="$1"

  node - "$PKG_JSON" "$LOCK_JSON" "$ADDON_JSON" "$new_ver" <<'NODE'
const fs = require('fs');
const [pkgPath, lockPath, addonPath, version] = process.argv.slice(2);

const writeJson = (filePath, mutate) => {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(data);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

writeJson(pkgPath, data => {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Invalid JSON in ${pkgPath}`);
  }
  data.version = version;
});

writeJson(lockPath, data => {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Invalid JSON in ${lockPath}`);
  }
  data.version = version;
  if (data.packages && data.packages['']) {
    data.packages[''].version = version;
  }
});

writeJson(addonPath, data => {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Invalid JSON in ${addonPath}`);
  }
  data.version = version;
});
NODE

  perl -pi -e 's/(variable "GATEGPT_VERSION" \{ default = ")[^"]+(" \})/$1'"$new_ver"'$2/' "$BAKE_HCL"
  perl -pi -e 's/(This is GateGPT v)[0-9]+\.[0-9]+\.[0-9]+/$1'"$new_ver"'/' "$MAIN_JS"
}

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
  elif git rev-parse -q --verify "$NEW_TAG" >/dev/null; then
    echo "ℹ️  Tag $NEW_TAG already exists – skipping commit & tag, building only."
    BUILD_ONLY=1
  fi
else
  echo "❌ Format must be vX.Y.Z"; exit 1
fi
echo "Using version: $NEW_TAG"

##############################################################################
# 3. Update versions (unless build-only)
##############################################################################
if [[ $BUILD_ONLY -eq 0 ]]; then
  echo "🔄 Updating GateGPT version fields only…"
  set_gategpt_versions "$NEW_VER"

  git add "$PKG_JSON" "$LOCK_JSON" "$ADDON_JSON" "$BAKE_HCL" "$MAIN_JS"
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
