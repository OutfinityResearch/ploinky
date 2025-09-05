# Ploinky - Universal Agent Platform

Ploinky is an open-source platform that simplifies working with containerized environments and AI agents through a unified interface for both CLI tools and cloud functions.

## Quick Start

```bash
# Clone and setup
git clone https://github.com/PlonkyRepos/ploinky.git
cd ploinky

# Add to PATH
export PATH="$PATH:$(pwd)/bin"

# Start Ploinky
ploinky
```

### Prerequisites
- Node.js 18+
- Docker or Podman
- Git

### Basic Commands

```bash
# List available agents
ploinky> list agents

# Run an agent
ploinky> run agent bash

# Add more agent repositories
ploinky> add repo cloud
```

## What is Ploinky?

- **🖥️ Ploinky CLI** - Command-line tool for running containerized development environments locally
- **☁️ Ploinky Cloud** - Serverless runtime for deploying agents as Lambda-style functions *(coming soon)*

Both tools use the same agent definitions from GitHub repositories, allowing seamless scaling from local development to cloud deployment.

## Documentation

Full documentation is available at **[www.ploinky.com](https://www.ploinky.com)**

## Community

- **Repository**: [github.com/PlonkyRepos/ploinky](https://github.com/PlonkyRepos/ploinky)
- **Issues**: [Report bugs or request features](https://github.com/PlonkyRepos/ploinky/issues)

## License

MIT License - see [LICENSE](LICENSE) file for details.