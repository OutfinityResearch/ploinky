# Podman Configuration for Ploinky

## Fix for Short-Name Resolution Errors

If you encounter errors like:
```
Error: short-name resolution enforced but cannot prompt without a TTY
```

### Solution 1: Configure Registries (Recommended)

Create or edit `~/.config/containers/registries.conf`:

```toml
unqualified-search-registries = ["docker.io"]

[[registry]]
location = "docker.io"
prefix = "docker.io"

[registries.search]
registries = ['docker.io']
```

### Solution 2: Configure Short-Name Aliases

Create or edit `~/.config/containers/registries.conf.d/000-shortnames.conf`:

```toml
[aliases]
"debian" = "docker.io/library/debian"
"ubuntu" = "docker.io/library/ubuntu"
"alpine" = "docker.io/library/alpine"
"buildpack-deps" = "docker.io/library/buildpack-deps"
"node" = "docker.io/library/node"
"python" = "docker.io/library/python"
"golang" = "docker.io/library/golang"
"rust" = "docker.io/library/rust"
"fedora" = "docker.io/library/fedora"
```

### Solution 3: Disable Short-Name Prompt

Edit `/etc/containers/registries.conf` or `~/.config/containers/registries.conf`:

```toml
[engine]
short-name-mode = "disabled"
```

### Solution 4: Use Full Registry Names

Always use full registry names in manifest.json files:

**Instead of:**
```json
"container": "debian:stable-slim"
```

**Use:**
```json
"container": "docker.io/library/debian:stable-slim"
```

### Common Full Names for Popular Images:

- `docker.io/library/debian:stable-slim`
- `docker.io/library/ubuntu:22.04`
- `docker.io/library/alpine:latest`
- `docker.io/library/buildpack-deps:stable`
- `docker.io/library/node:20`
- `docker.io/library/python:3.11`
- `docker.io/library/golang:1.21`
- `docker.io/library/rust:latest`
- `docker.io/library/fedora:latest`

## Testing the Configuration

After configuration, test with:

```bash
podman pull debian:stable-slim
```

If it works without prompting, Ploinky agents will also work correctly.