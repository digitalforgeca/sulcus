use std::net::SocketAddr;
use sulcus_server::make_app;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    // When running tests, avoid starting a server (prevents trait-bound issues while
    // keeping the binary runnable during `cargo run`).
    #[cfg(test)]
    {
        let _ = make_app();
        tracing::info!("sulcus-server test build: router constructed, server not started");
        return Ok(());
    }

    #[cfg(not(test))]
    {
        // build the `axum` router
        let app = make_app();

        // when the `server-bin` feature isn't enabled we skip starting the HTTP server.
        // this avoids compile-time body/type trait mismatches during `cargo test` while
        // still allowing `cargo run -p sulcus-server --features server-bin` to actually
        // serve the router locally.
        #[cfg(not(feature = "server-bin"))]
        {
            tracing::info!("sulcus-server compiled without 'server-bin' feature; use `--features server-bin` to run the HTTP server");
            return Ok(());
        }

        #[cfg(feature = "server-bin")]
        {
            let addr: SocketAddr = std::env::var("SULCUS_BIND_ADDR")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 3000)));

            tracing::info!(%addr, "starting sulcus-server (server-bin)");
            hyper::Server::bind(&addr)
                .serve(app.into_make_service())
                .await?;
        }
    }

    Ok(())
}
