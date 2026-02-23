use std::net::SocketAddr;
use sulcus_server::make_app;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    // build the router (connects to database, runs migrations)
    let app = make_app().await?;

    #[cfg(not(feature = "server-bin"))]
    {
        tracing::info!("sulcus-server compiled without 'server-bin' feature; \
                        use `--features server-bin` to run the HTTP server");
        return Ok(());
    }

    #[cfg(feature = "server-bin")]
    {
        let addr: SocketAddr = std::env::var("SULCUS_BIND_ADDR")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 3000)));

        tracing::info!(%addr, "starting sulcus-server");
        hyper::Server::bind(&addr)
            .serve(app.into_make_service())
            .await?;
    }

    Ok(())
}
