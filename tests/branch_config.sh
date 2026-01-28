#!/bin/bash
# Branch configuration for testing profile_implementation changes
# Uncomment the relevant lines to test against feature branches
#
# Usage:
#   export PLOINKY_BASIC_BRANCH="profile_implementation"
#   ./test_all.sh
#
# Or source this file after uncommenting the desired branches.

# Predefined repo branch overrides
# When set, enable_repo_with_branch will clone the repo at this branch

# export PLOINKY_BASIC_BRANCH="profile_implementation"
# export PLOINKY_CLOUD_BRANCH=""
# export PLOINKY_VIBE_BRANCH=""
# export PLOINKY_SECURITY_BRANCH=""
# export PLOINKY_EXTRA_BRANCH=""

# For testing profile-based manifest changes, enable these branches:
# (These are now merged to main, so no branch override is needed)
# export PLOINKY_DEMO_BRANCH="profile_implementation"
# export PLOINKY_FILEEXPLORER_BRANCH="profile_implementation"
# export PLOINKY_SOPLANGBUILDER_BRANCH="profile_implementation"
