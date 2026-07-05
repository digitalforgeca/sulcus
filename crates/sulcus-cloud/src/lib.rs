//! sulcus-cloud — Sulcus Cloud REST API client.
//!
//! Typed HTTP client for the Sulcus Cloud API (`api.sulcus.ca`).
//! Uses `reqwest` with rustls for zero OpenSSL dependency.

mod client;

pub use client::{SulcusClient, SulcusConfig};
