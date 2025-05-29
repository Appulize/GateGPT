variable "VERSION" {
  default = "dev"
}

target "gategpt" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64", "linux/arm/v7"]

  tags = [
    "docker.io/maciekish/gategpt:${VERSION}",
    "docker.io/maciekish/gategpt:latest"
  ]

  args = { VERSION = "${VERSION}" }
}

group "default" { targets = ["gategpt"] }