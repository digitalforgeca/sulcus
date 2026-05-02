// Middleware is not used in static export mode.
// Dashboard auth protection is handled client-side by the dashboard layout.
// Route protection for Azure Static Web Apps is configured in staticwebapp.config.json.

export function middleware() {}

export const config = {
  matcher: [],
};
