import { getDealById } from "@/lib/data";
import InspectionFlowClient from "./InspectionFlowClient";

export default async function InspectionPage({
  params,
}: {
  params: Promise<{ dealId: string; inspectionId: string }>;
}) {
  const { dealId, inspectionId } = await params;
  const deal = await getDealById(dealId);

  return <InspectionFlowClient deal={deal} inspectionId={inspectionId} />;
}
