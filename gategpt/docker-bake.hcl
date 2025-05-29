variable "VERSION" { default = "0.8.9" }      # bump each release

target "gategpt" {
  context    = "."
  dockerfile = "Dockerfile"

  platforms  = ["linux/amd64", "linux/arm64"]   # add linux/arm/v7 if you need it

  # amd64 is the default (matches Dockerfile’s default)
  args = { BUILD_FROM = "ghcr.io/home-assistant/amd64-base:3.19" }

  overrides = {
    "linux/arm64" = {
      args = { BUILD_FROM = "ghcr.io/home-assistant/aarch64-base:3.19" }
    }
    # If you ever add armv7 back:
    # "linux/arm/v7" = {
    #   args = { BUILD_FROM = "ghcr.io/home-assistant/armv7-base:3.19" }
    # }
  }

  push = true
  tags = [
    "docker.io/maciekish/gategpt:${VERSION}",
    "docker.io/maciekish/gategpt:latest"
  ]
}

group "default" { targets = ["gategpt"] }