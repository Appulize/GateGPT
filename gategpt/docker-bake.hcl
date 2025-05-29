variable "VERSION" { default = "0.8.10" }

target "gategpt" {
  context    = "."
  dockerfile = "Dockerfile"

  platforms  = ["linux/amd64", "linux/arm64"]

  push = true
  tags = [
    "docker.io/maciekish/gategpt:${VERSION}",
    "docker.io/maciekish/gategpt:latest"
  ]
}

group "default" { targets = ["gategpt"] }