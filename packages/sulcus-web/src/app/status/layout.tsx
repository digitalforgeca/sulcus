import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status | SULCUS",
  description:
    "Real-time system health and aggregate statistics for the Sulcus memory network. No PII — just uptime, node counts, and thermodynamic metrics.",
  openGraph: {
    title: "Sulcus System Status",
    description: "Live health metrics for the Sulcus thermodynamic memory network.",
    url: "https://sulcus.ca/status",
    siteName: "SULCUS",
  },
};

export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
