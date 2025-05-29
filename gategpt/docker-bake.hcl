variable "VERSION" { default = "0.8.7" }

target "gategpt_amd64" {
  context     = "."
  dockerfile  = "Dockerfile"
  platforms   = ["linux/amd64"]
  args        = { BUILD_FROM = "ghcr.io/home-assistant/amd64-base:3.19" }
  tags        = ["docker.io/maciekish/gategpt:${VERSION}"]
}

target "gategpt_arm64" {
  inherits    = ["gategpt_amd64"]
  platforms   = ["linux/arm64"]
  args        = { BUILD_FROM = "ghcr.io/home-assistant/aarch64-base:3.19" }
}

# Home Assistant has dropped support for 32-bit HA
#target "gategpt_armv7" {
#  inherits    = ["gategpt_amd64"]
#  platforms   = ["linux/arm/v7"]
#  args        = { BUILD_FROM = "ghcr.io/home-assistant/armv7-base:3.19" }
#}

group "default" {
  targets = ["gategpt_amd64", "gategpt_arm64"]
  tags    = [
    "docker.io/maciekish/gategpt:${VERSION}",
    "docker.io/maciekish/gategpt:latest"
  ]
}