use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;

#[derive(Debug, Deserialize)]
pub struct KeycloakAdminToken {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

#[derive(Debug, Serialize)]
pub struct RoleRepresentation {
    pub id: String,
    pub name: String,
}

/// Fetches an admin access token from Keycloak using password grant (admin/admin).
pub async fn get_admin_token() -> Result<KeycloakAdminToken> {
    let keycloak_url =
        env::var("AUTH_KEYCLOAK_ISSUER").map_err(|_| anyhow!("AUTH_KEYCLOAK_ISSUER not set"))?;
    let admin_user = env::var("KEYCLOAK_ADMIN").unwrap_or_else(|_| "admin".to_string());
    let admin_password = env::var("KEYCLOAK_ADMIN_PASSWORD")
        .map_err(|_| anyhow!("KEYCLOAK_ADMIN_PASSWORD not set"))?;

    let client = Client::new();
    // Admin tokens usually come from the master realm
    let token_url = format!(
        "{}/realms/master/protocol/openid-connect/token",
        keycloak_url
            .split("/realms/")
            .next()
            .unwrap_or(&keycloak_url)
            .trim_end_matches('/')
    );

    let mut params = HashMap::new();
    params.insert("client_id", "admin-cli".to_string());
    params.insert("username", admin_user);
    params.insert("password", admin_password);
    params.insert("grant_type", "password".to_string());

    let response = client
        .post(&token_url)
        .form(&params)
        .send()
        .await?
        .error_for_status()?;

    let token: KeycloakAdminToken = response.json().await?;
    Ok(token)
}

/// Assigns a role to a Keycloak user.
pub async fn assign_user_role(keycloak_user_id: &str, plan_tier: &str) -> Result<()> {
    let keycloak_url =
        env::var("AUTH_KEYCLOAK_ISSUER").map_err(|_| anyhow!("AUTH_KEYCLOAK_ISSUER not set"))?;

    // Extract the realm from the issuer URL
    let realm = keycloak_url
        .split("/realms/")
        .nth(1)
        .ok_or_else(|| anyhow!("Could not extract realm from AUTH_KEYCLOAK_ISSUER"))?
        .trim_end_matches('/');

    let token_data = get_admin_token().await?;
    let token = token_data.access_token;
    let client = Client::new();

    let role_name = match plan_tier {
        "enterprise" => "sulcus-enterprise",
        "team" => "sulcus-team",
        "pro" => "sulcus-pro",
        _ => "sulcus-free",
    };

    let base_admin_url = keycloak_url
        .split("/realms/")
        .next()
        .unwrap_or(&keycloak_url)
        .trim_end_matches('/');

    // 1. Get the role representation to find its ID
    let roles_url = format!(
        "{}/admin/realms/{}/roles/{}",
        base_admin_url, realm, role_name
    );

    let role_resp = client
        .get(&roles_url)
        .bearer_auth(&token)
        .send()
        .await?
        .error_for_status()?;

    let role: serde_json::Value = role_resp.json().await?;
    let role_id = role["id"]
        .as_str()
        .ok_or_else(|| anyhow!("Role '{}' has no ID", role_name))?;

    // 2. Assign the role to the user
    let user_roles_url = format!(
        "{}/admin/realms/{}/users/{}/roles/realm",
        base_admin_url, realm, keycloak_user_id
    );

    let role_representation = vec![serde_json::json!({
        "id": role_id,
        "name": role_name,
    })];

    client
        .post(&user_roles_url)
        .bearer_auth(&token)
        .json(&role_representation)
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}
