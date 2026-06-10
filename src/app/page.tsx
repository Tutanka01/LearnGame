import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Dashboard username={user.username} />;
}
