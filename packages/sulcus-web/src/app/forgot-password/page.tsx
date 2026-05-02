import type { Metadata } from "next";
import ForgotPasswordClient from "./ForgotPasswordClient";

export const metadata: Metadata = {
  title: "Forgot Password — Sulcus",
  description: "Reset your Sulcus account password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient />;
}
