variable "GATEGPT_VERSION" { default = "1.2.4" }

target "gategpt" {
  context    = "."
  dockerfile = "Dockerfile"

  platforms  = ["linux/amd64", "linux/arm64"]

  push = true
  tags = [
    "docker.io/maciekish/gategpt:${GATEGPT_VERSION}",
    "docker.io/maciekish/gategpt:latest"
  ]
}

group "default" { targets = ["gategpt"] }