import type { Metadata } from "next";
import { OnboardingScreen } from "@/components/onboarding-screen";

export const metadata: Metadata = { title: "Join the private beta — Vessel" };

export default function OnboardingPage() {
  return <OnboardingScreen />;
}
