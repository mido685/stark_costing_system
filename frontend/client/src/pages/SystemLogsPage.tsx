import { SystemLogsTab } from "@/components/SystemLogsTab";

export default function SystemLogsPage() {
  return (
    <div className="space-y-6">
      <SystemLogsTab branchId={0} />
    </div>
  );
}