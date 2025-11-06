fast_assert_enable_alias_agent_running() {
  require_var "TEST_ENABLE_ALIAS_AGENT_CONTAINER"
  local container_name="$TEST_ENABLE_ALIAS_AGENT_CONTAINER"
  assert_container_running "$container_name"
}
