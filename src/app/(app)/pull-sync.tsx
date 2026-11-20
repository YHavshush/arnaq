import { PullToRefresh } from "@/components/arnaq/pull-to-refresh";
import { userDb } from "@/lib/auth/request";
import { requestTime } from "@/lib/api";
import { listConnections } from "@/lib/banking/connections";
import { bankingConfig } from "@/lib/banking/enable-banking";

/** The pull down to fetch the banks, only while linking banks is on here and a bank is linked. */
export async function PullSync() {
  await requestTime();
  if (!bankingConfig()) return null;
  try {
    const linked = await userDb((db) => listConnections(db));
    if (!linked.some((c) => c.status === "active")) return null;
  } catch {
    return null; // a failing check must not take the whole shell down
  }
  return <PullToRefresh />;
}
