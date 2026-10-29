#!/bin/sh
# Local Ansible entrypoint. Explicit client/environment config is required.
set -eu
exec "$(dirname "$0")/ops/run" -e bot_operation=deploy "$@"
