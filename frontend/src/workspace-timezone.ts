import { ApiError, request, type RecordData } from "./api";
import { isTimeZone } from "./zoned-time";

type WorkspaceResponse = { data: RecordData };

export async function loadWorkspace(browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  let { data } = await request<WorkspaceResponse>("/workspace");
  if (data.timezone_configured === false && isTimeZone(browserZone)) {
    try {
      ({ data } = await request<WorkspaceResponse>("/workspace", {
        method: "PATCH", revision: data.revision, body: { timezone: browserZone },
      }));
    } catch (error) {
      if (!(error instanceof ApiError) || ![409, 412].includes(error.status)) throw error;
      ({ data } = await request<WorkspaceResponse>("/workspace"));
      if (data.timezone_configured === false) throw error;
    }
  }
  if (typeof data.timezone !== "string" || !isTimeZone(data.timezone)) {
    throw new Error("The workspace timezone is unavailable.");
  }
  return data;
}
