#!/bin/bash
# Setup Keycloak for SSO testing using Admin API
# Creates realm, clients, users, roles, and protocol mappers automatically

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Note: We don't source lib.sh here because it requires FAST_STATE_FILE
# and would cause the script to exit if not set. This script is standalone.

# Configuration - can be overridden by environment variables
KEYCLOAK_URL="${KEYCLOAK_URL:-${SSO_BASE_URL:-http://127.0.0.1:9090}}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-${SSO_ADMIN:-admin}}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-${SSO_ADMIN_PASSWORD:-admin}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-${SSO_REALM:-ploinky}}"
ROUTER_CLIENT_ID="${ROUTER_CLIENT_ID:-${SSO_CLIENT_ID:-ploinky-router}}"
ROUTER_REDIRECT_URI="${ROUTER_REDIRECT_URI:-http://127.0.0.1:8080/auth/callback}"
ROUTER_LOGOUT_REDIRECT_URI="${ROUTER_LOGOUT_REDIRECT_URI:-${SSO_LOGOUT_REDIRECT_URI:-${KEYCLOAK_LOGOUT_REDIRECT_URI:-http://127.0.0.1:8080/auth/logged-out}}}"

# Test agent configuration
TEST_AGENT_CLIENT_ID="${TEST_AGENT_CLIENT_ID:-agent-test-client}"
TEST_AGENT_NAME="${TEST_AGENT_NAME:-test-agent}"
TEST_AGENT_ALLOWED_TARGETS="${TEST_AGENT_ALLOWED_TARGETS:-coral-agent,test-agent}"

# Test user configuration
TEST_USER_USERNAME="${TEST_USER_USERNAME:-testuser}"
TEST_USER_PASSWORD="${TEST_USER_PASSWORD:-testpass123}"
TEST_USER_EMAIL="${TEST_USER_EMAIL:-testuser@example.com}"
TEST_USER_ROLES="${TEST_USER_ROLES:-user,admin}"

# Remove trailing slash
KEYCLOAK_URL="${KEYCLOAK_URL%/}"

# Colors for output
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Check dependencies
check_dependencies() {
    local missing=0
    for cmd in curl jq; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_error "Required command not found: $cmd"
            missing=1
        fi
    done
    if [ $missing -eq 1 ]; then
        log_error "Please install missing dependencies: curl, jq"
        return 1
    fi
    return 0
}

# Get admin access token
get_admin_token() {
    local response
    response=$(curl -sS -X POST \
        -H 'Content-Type: application/x-www-form-urlencoded' \
        -d "username=${KEYCLOAK_ADMIN}" \
        -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
        -d 'grant_type=password' \
        -d 'client_id=admin-cli' \
        "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" 2>/dev/null || echo "")
    
    if [ -z "$response" ]; then
        log_error "Failed to connect to Keycloak at ${KEYCLOAK_URL}"
        return 1
    fi
    
    local token
    token=$(echo "$response" | jq -r '.access_token // empty' 2>/dev/null || echo "")
    
    if [ -z "$token" ] || [ "$token" = "null" ]; then
        local error
        error=$(echo "$response" | jq -r '.error_description // .error // "Unknown error"' 2>/dev/null || echo "Unknown error")
        log_error "Failed to obtain admin token: $error"
        return 1
    fi
    
    echo "$token"
}

# Make authenticated API call
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"
    local token="$4"
    
    local url="${KEYCLOAK_URL}${endpoint}"
    local response_file
    response_file=$(mktemp)
    local curl_args=(
        -sS
        -w "\n%{http_code}"
        -X "$method"
        -H "Authorization: Bearer ${token}"
        -H "Content-Type: application/json"
        -o "$response_file"
    )
    
    if [ -n "$data" ]; then
        curl_args+=(-d "$data")
    fi
    
    local http_code
    http_code=$(curl "${curl_args[@]}" "$url" 2>/dev/null | tail -n1)
    local response
    response=$(cat "$response_file" 2>/dev/null || echo "")
    rm -f "$response_file"
    
    # Return response, but also check HTTP code
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo "$response"
        return 0
    else
        # Log error for debugging
        if [ -n "$response" ]; then
            log_error "API call failed (HTTP $http_code): $response" >&2
        fi
        echo ""
        return 1
    fi
}

# Check if realm exists
realm_exists() {
    local token="$1"
    local status
    status=$(curl -sS -o /dev/null -w '%{http_code}' \
        -H "Authorization: Bearer ${token}" \
        "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}" 2>/dev/null || echo "000")
    [ "$status" = "200" ]
}

# Create realm
create_realm() {
    local token="$1"
    log_info "Creating realm '${KEYCLOAK_REALM}'..."
    
    local realm_data
    realm_data=$(jq -n \
        --arg realm "$KEYCLOAK_REALM" \
        '{
            realm: $realm,
            enabled: true,
            displayName: $realm,
            loginWithEmailAllowed: true,
            duplicateEmailsAllowed: false,
            resetPasswordAllowed: true,
            editUsernameAllowed: false,
            bruteForceProtected: false,
            permanentLockout: false,
            maxFailureWaitSeconds: 900,
            minimumQuickLoginWaitSeconds: 60,
            waitIncrementSeconds: 60,
            quickLoginCheckMilliSeconds: 1000,
            maxDeltaTimeSeconds: 43200,
            failureFactor: 30
        }')
    
    local response
    response=$(api_call "POST" "/admin/realms" "$realm_data" "$token")
    
    if [ -z "$response" ]; then
        log_error "Failed to create realm"
        return 1
    fi
    
    # Wait for realm to be ready
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if realm_exists "$token"; then
            log_success "Realm '${KEYCLOAK_REALM}' created successfully"
            return 0
        fi
        sleep 1
        attempts=$((attempts + 1))
    done
    
    log_error "Realm created but not ready after 30 seconds"
    return 1
}

# Check if client exists
client_exists() {
    local token="$1"
    local client_id="$2"
    
    local response
    response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${client_id}" "" "$token")
    
    if [ -z "$response" ]; then
        return 1
    fi
    
    local count
    count=$(echo "$response" | jq 'length' 2>/dev/null || echo "0")
    [ "$count" -gt 0 ]
}

# Get client UUID
get_client_uuid() {
    local token="$1"
    local client_id="$2"
    
    local response
    response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${client_id}" "" "$token")
    
    if [ -z "$response" ]; then
        return 1
    fi
    
    echo "$response" | jq -r '.[0].id // empty' 2>/dev/null || echo ""
}

# Create router client (public, for user authentication)
create_router_client() {
    local token="$1"
    log_info "Ensuring router client '${ROUTER_CLIENT_ID}' is configured..."
    
    local client_data
    client_data=$(jq -n \
        --arg client_id "$ROUTER_CLIENT_ID" \
        --arg redirect_uri "$ROUTER_REDIRECT_URI" \
        --arg post_logout_redirect_uri "$ROUTER_LOGOUT_REDIRECT_URI" \
        '{
            clientId: $client_id,
            enabled: true,
            publicClient: true,
            standardFlowEnabled: true,
            directAccessGrantsEnabled: false,
            serviceAccountsEnabled: false,
            implicitFlowEnabled: false,
            redirectUris: [$redirect_uri, $post_logout_redirect_uri],
            validRedirectUris: [$redirect_uri],
            webOrigins: ["+"],
            protocol: "openid-connect",
            attributes: {
                "pkce.code.challenge.method": "S256",
                "post.logout.redirect.uris": $post_logout_redirect_uri
            }
        }')

    if client_exists "$token" "$ROUTER_CLIENT_ID"; then
        local client_uuid
        client_uuid=$(get_client_uuid "$token" "$ROUTER_CLIENT_ID")
        if [ -z "$client_uuid" ]; then
            log_error "Failed to get client UUID for existing router client"
            return 1
        fi
        local update_data
        update_data=$(echo "$client_data" | jq --arg client_uuid "$client_uuid" '.id = $client_uuid')
        if ! api_call "PUT" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}" "$update_data" "$token" >/dev/null; then
            log_error "Failed to update router client"
            return 1
        fi
        log_success "Router client '${ROUTER_CLIENT_ID}' updated successfully"
        return 0
    fi
    
    local response
    response=$(api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/clients" "$client_data" "$token")
    
    if [ -z "$response" ]; then
        log_error "Failed to create router client"
        return 1
    fi
    
    log_success "Router client '${ROUTER_CLIENT_ID}' created successfully"
    return 0
}

# Create agent client (confidential, for agent authentication)
create_agent_client() {
    local token="$1"
    log_info "Creating agent client '${TEST_AGENT_CLIENT_ID}'..."
    
    if client_exists "$token" "$TEST_AGENT_CLIENT_ID"; then
        log_warn "Client '${TEST_AGENT_CLIENT_ID}' already exists, updating..."
        local client_uuid
        client_uuid=$(get_client_uuid "$token" "$TEST_AGENT_CLIENT_ID")
        if [ -z "$client_uuid" ]; then
            log_error "Failed to get client UUID for existing client"
            return 1
        fi
        
        local client_data
        client_data=$(jq -n \
            '{
                serviceAccountsEnabled: true,
                standardFlowEnabled: false,
                directAccessGrantsEnabled: false,
                publicClient: false
            }')
        
        if ! api_call "PUT" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}" "$client_data" "$token" >/dev/null; then
            log_error "Failed to update agent client"
            return 1
        fi
    else
        local client_data
        client_data=$(jq -n \
            --arg client_id "$TEST_AGENT_CLIENT_ID" \
            '{
                clientId: $client_id,
                enabled: true,
                publicClient: false,
                serviceAccountsEnabled: true,
                standardFlowEnabled: false,
                directAccessGrantsEnabled: false,
                implicitFlowEnabled: false,
                protocol: "openid-connect"
            }')
        
        if ! api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/clients" "$client_data" "$token" >/dev/null; then
            log_error "Failed to create agent client (check if client ID is valid)"
            return 1
        fi
        
        # Wait a moment for client to be created
        sleep 1
    fi
    
    # Get client UUID for secret and mappers
    local client_uuid
    client_uuid=$(get_client_uuid "$token" "$TEST_AGENT_CLIENT_ID")
    if [ -z "$client_uuid" ]; then
        log_error "Failed to get client UUID after creation"
        return 1
    fi
    
    # Get or generate client secret
    local secret_response
    secret_response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}/client-secret" "" "$token")
    local client_secret
    client_secret=$(echo "$secret_response" | jq -r '.value // empty' 2>/dev/null || echo "")
    
    if [ -z "$client_secret" ] || [ "$client_secret" = "null" ]; then
        # Regenerate secret
        api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}/client-secret" "" "$token" >/dev/null
        secret_response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}/client-secret" "" "$token")
        client_secret=$(echo "$secret_response" | jq -r '.value // empty' 2>/dev/null || echo "")
    fi
    
    if [ -n "$client_secret" ] && [ "$client_secret" != "null" ]; then
        log_success "Agent client '${TEST_AGENT_CLIENT_ID}' created/updated successfully"
        echo "CLIENT_SECRET=${client_secret}" >&2
        echo "export TEST_AGENT_CLIENT_SECRET='${client_secret}'" >&2
    else
        log_error "Failed to get client secret"
        return 1
    fi
    
    # Add protocol mappers for agent name and allowed targets
    add_agent_protocol_mappers "$token" "$client_uuid"
    
    return 0
}

# Add protocol mappers for agent client
add_agent_protocol_mappers() {
    local token="$1"
    local client_uuid="$2"
    
    log_info "Adding protocol mappers for agent client..."
    
    # Get existing mappers
    local existing_mappers
    existing_mappers=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}/protocol-mappers/models" "" "$token")
    
    # Check if agent_name mapper exists
    local has_agent_name
    has_agent_name=$(echo "$existing_mappers" | jq -r '.[] | select(.name == "agent-name") | .id' 2>/dev/null || echo "")
    
    if [ -z "$has_agent_name" ]; then
        local agent_name_mapper
        agent_name_mapper=$(jq -n \
            --arg agent_name "$TEST_AGENT_NAME" \
            '{
                name: "agent-name",
                protocol: "openid-connect",
                protocolMapper: "oidc-hardcoded-claim-mapper",
                config: {
                    "claim.value": $agent_name,
                    "user.attribute": "",
                    "id.token.claim": "false",
                    "access.token.claim": "true",
                    "claim.name": "agent_name",
                    "jsonType.label": "String"
                }
            }')
        
        api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}/protocol-mappers/models" "$agent_name_mapper" "$token" >/dev/null
        log_success "Added agent-name protocol mapper"
    fi
    
    # Check if allowed_targets mapper exists
    local has_allowed_targets
    has_allowed_targets=$(echo "$existing_mappers" | jq -r '.[] | select(.name == "allowed-targets") | .id' 2>/dev/null || echo "")
    
    if [ -z "$has_allowed_targets" ]; then
        local allowed_targets_mapper
        allowed_targets_mapper=$(jq -n \
            --arg targets "$TEST_AGENT_ALLOWED_TARGETS" \
            '{
                name: "allowed-targets",
                protocol: "openid-connect",
                protocolMapper: "oidc-hardcoded-claim-mapper",
                config: {
                    "claim.value": $targets,
                    "user.attribute": "",
                    "id.token.claim": "false",
                    "access.token.claim": "true",
                    "claim.name": "allowed_targets",
                    "jsonType.label": "String"
                }
            }')
        
        api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/clients/${client_uuid}/protocol-mappers/models" "$allowed_targets_mapper" "$token" >/dev/null
        log_success "Added allowed-targets protocol mapper"
    fi
}

# Check if user exists
user_exists() {
    local token="$1"
    local username="$2"
    
    local response
    response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/users?username=${username}" "" "$token")
    
    if [ -z "$response" ]; then
        return 1
    fi
    
    local count
    count=$(echo "$response" | jq 'length' 2>/dev/null || echo "0")
    [ "$count" -gt 0 ]
}

# Get user ID
get_user_id() {
    local token="$1"
    local username="$2"
    
    local response
    response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/users?username=${username}" "" "$token")
    
    if [ -z "$response" ]; then
        return 1
    fi
    
    echo "$response" | jq -r '.[0].id // empty' 2>/dev/null || echo ""
}

# Create test user
create_test_user() {
    local token="$1"
    log_info "Creating test user '${TEST_USER_USERNAME}'..."
    
    if user_exists "$token" "$TEST_USER_USERNAME"; then
        log_warn "User '${TEST_USER_USERNAME}' already exists, updating password..."
        local user_id
        user_id=$(get_user_id "$token" "$TEST_USER_USERNAME")
        if [ -z "$user_id" ]; then
            log_error "Failed to get user ID"
            return 1
        fi
        
        # Update password
        local password_data
        password_data=$(jq -n \
            --arg password "$TEST_USER_PASSWORD" \
            '{
                type: "password",
                value: $password,
                temporary: false
            }')
        
        if ! api_call "PUT" "/admin/realms/${KEYCLOAK_REALM}/users/${user_id}/reset-password" "$password_data" "$token" >/dev/null; then
            log_warn "Failed to update password, but continuing"
        else
            log_success "Test user password updated"
        fi
    else
        local user_data
        user_data=$(jq -n \
            --arg username "$TEST_USER_USERNAME" \
            --arg email "$TEST_USER_EMAIL" \
            '{
                username: $username,
                email: $email,
                enabled: true,
                emailVerified: true,
                credentials: [{
                    type: "password",
                    value: "'"${TEST_USER_PASSWORD}"'",
                    temporary: false
                }]
            }')
        
        if ! api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/users" "$user_data" "$token" >/dev/null; then
            log_error "Failed to create test user (user may already exist or invalid data)"
            # Try to continue anyway - user might already exist
            if user_exists "$token" "$TEST_USER_USERNAME"; then
                log_warn "User exists, continuing with role assignment"
            else
                return 1
            fi
        else
            log_success "Test user '${TEST_USER_USERNAME}' created successfully"
        fi
    fi
    
    # Assign roles to user
    assign_roles_to_user "$token" "$TEST_USER_USERNAME"
    
    return 0
}

# Check if role exists
role_exists() {
    local token="$1"
    local role_name="$2"
    
    local response
    response=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/roles/${role_name}" "" "$token" 2>/dev/null || echo "")
    
    if [ -z "$response" ]; then
        return 1
    fi
    
    local error
    error=$(echo "$response" | jq -r '.error // empty' 2>/dev/null || echo "")
    [ -z "$error" ] || [ "$error" = "null" ]
}

# Create role
create_role() {
    local token="$1"
    local role_name="$2"
    
    if role_exists "$token" "$role_name"; then
        return 0
    fi
    
    local role_data
    role_data=$(jq -n \
        --arg name "$role_name" \
        '{
            name: $name,
            description: "Test role: \($name)"
        }')
    
    api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/roles" "$role_data" "$token" >/dev/null
}

# Assign roles to user
assign_roles_to_user() {
    local token="$1"
    local username="$2"
    
    if [ -z "$TEST_USER_ROLES" ]; then
        return 0
    fi
    
    log_info "Assigning roles to user '${username}'..."
    
    local user_id
    user_id=$(get_user_id "$token" "$username")
    if [ -z "$user_id" ]; then
        log_error "Failed to get user ID for role assignment"
        return 1
    fi
    
    # Create roles if they don't exist and assign them
    IFS=',' read -ra ROLES <<< "$TEST_USER_ROLES"
    local roles_to_assign=()
    
    for role in "${ROLES[@]}"; do
        role=$(echo "$role" | xargs) # trim whitespace
        if [ -n "$role" ]; then
            create_role "$token" "$role"
            roles_to_assign+=("$role")
        fi
    done
    
    # Get role representations
    local role_representations=()
    for role in "${roles_to_assign[@]}"; do
        local role_data
        role_data=$(api_call "GET" "/admin/realms/${KEYCLOAK_REALM}/roles/${role}" "" "$token")
        if [ -n "$role_data" ]; then
            role_representations+=("$role_data")
        fi
    done
    
    # Combine role representations
    local roles_json
    roles_json=$(printf '%s\n' "${role_representations[@]}" | jq -s '.')
    
    # Assign roles
    api_call "POST" "/admin/realms/${KEYCLOAK_REALM}/users/${user_id}/role-mappings/realm" "$roles_json" "$token" >/dev/null
    
    log_success "Assigned roles: ${TEST_USER_ROLES}"
    return 0
}

# Main setup function
main() {
    log_info "Setting up Keycloak for SSO testing..."
    log_info "Keycloak URL: ${KEYCLOAK_URL}"
    log_info "Realm: ${KEYCLOAK_REALM}"
    log_info "Router Client: ${ROUTER_CLIENT_ID}"
    log_info "Logout Redirect URI: ${ROUTER_LOGOUT_REDIRECT_URI}"
    log_info "Agent Client: ${TEST_AGENT_CLIENT_ID}"
    log_info "Test User: ${TEST_USER_USERNAME}"
    
    if ! check_dependencies; then
        log_error "Dependency check failed"
        return 1
    fi
    
    # Check if Keycloak is accessible
    log_info "Checking Keycloak connectivity..."
    if ! curl -sSf "${KEYCLOAK_URL}/health" >/dev/null 2>&1 && \
       ! curl -sSf "${KEYCLOAK_URL}/realms/master/.well-known/openid-configuration" >/dev/null 2>&1; then
        log_error "Cannot connect to Keycloak at ${KEYCLOAK_URL}"
        log_error "Please ensure Keycloak is running: ploinky start keycloak"
        return 1
    fi
    
    # Get admin token
    log_info "Obtaining admin token..."
    local token
    token=$(get_admin_token)
    if [ -z "$token" ]; then
        log_error "Failed to obtain admin token. Check Keycloak credentials and URL."
        log_error "Admin: ${KEYCLOAK_ADMIN}, URL: ${KEYCLOAK_URL}"
        return 1
    fi
    
    log_success "Admin token obtained"
    
    # Create realm if it doesn't exist
    if ! realm_exists "$token"; then
        if ! create_realm "$token"; then
            log_error "Failed to create realm"
            return 1
        fi
    else
        log_info "Realm '${KEYCLOAK_REALM}' already exists"
    fi
    
    # Create router client
    if ! create_router_client "$token"; then
        log_error "Failed to create router client"
        return 1
    fi
    
    # Create agent client
    if ! create_agent_client "$token"; then
        log_error "Failed to create agent client"
        return 1
    fi
    
    # Create test user
    if ! create_test_user "$token"; then
        log_error "Failed to create test user"
        return 1
    fi
    
    log_success "Keycloak setup completed successfully!"
    log_info ""
    log_info "Test credentials:"
    log_info "  Username: ${TEST_USER_USERNAME}"
    log_info "  Password: ${TEST_USER_PASSWORD}"
    log_info "  Email: ${TEST_USER_EMAIL}"
    log_info "  Roles: ${TEST_USER_ROLES}"
    log_info ""
    log_info "Agent client credentials are shown above (CLIENT_SECRET)"
}

# Run main function with error handling
main "$@" || {
    exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log_error "Setup failed with exit code: $exit_code"
        exit $exit_code
    fi
}
exit 0
