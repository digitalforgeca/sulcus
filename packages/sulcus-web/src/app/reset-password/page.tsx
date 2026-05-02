import type { Metadata } from "next";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password — Sulcus",
  description: "Set a new password for your Sulcus account.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordClient />;
}
