//! Embedded local control panel — a self-contained HTML/JS dashboard
//! served directly from sulcus-local. No Node.js required.
//!
//! The full sulcus-web React dashboard can be used for development,
//! but this embedded panel provides a zero-dependency local experience.

use axum::{
    http::{header, StatusCode},
    response::{Html, IntoResponse},
};

/// GET / — serves the embedded dashboard SPA
pub async fn index() -> Html<&'static str> {
    Html(include_str!("panel.html"))
}

/// GET /favicon.svg
pub async fn favicon() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/svg+xml")],
        include_str!("../assets/favicon.svg"),
    )
}
