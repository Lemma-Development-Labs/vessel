import { StatusScreen } from "@/components/status-screen";

export const metadata = {
  title: "Status — Vessel testnet",
  description:
    "Keeper liveness, gas runway, indexer lag and RPC health for the Vessel testnet deployment.",
};

export default function StatusPage() {
  return <StatusScreen />;
}
