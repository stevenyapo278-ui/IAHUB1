#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a
MCP_TRANSPORT=http MCP_PORT=3333 node "$(dirname "$0")/dist/index.js"
