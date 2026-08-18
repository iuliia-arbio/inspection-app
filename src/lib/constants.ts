/** Supabase storage bucket names */
export const STORAGE_BUCKETS = {
  AUDIO: "inspection-audio-recordings",
  PHOTOS: "inspection-photos",
} as const;

/**
 * Storage path for one area's audio recording.
 *
 * The apartment segment is what makes it unique. Unit area ids repeat across
 * units — every unit has `bathroom_1` — so a path built from the area id alone
 * plus `upsert: true` meant the second unit's bathroom recording silently
 * overwrote the first unit's audio file in the bucket. Both flow and API build
 * paths through here so they always agree.
 */
export function areaAudioPath(
  inspectionId: string,
  areaId: string,
  apartmentId?: string | null
): string {
  return `${inspectionId}/${apartmentId ?? "shared"}/${areaId}.webm`;
}

/**
 * Folder holding one area's photos. Also the ownership boundary the API uses when
 * reconciling an area's photos: rows outside this prefix belong to something else
 * (follow-up answers, or inspections that predate unit-namespaced paths) and are
 * never removed on its behalf.
 */
export function areaPhotoFolder(
  inspectionId: string,
  areaId: string,
  apartmentId?: string | null
): string {
  return `${inspectionId}/${apartmentId ?? "shared"}/${areaId}/`;
}

/** Storage path for one photo attached to an area. Unique per photo id. */
export function areaPhotoPath(
  inspectionId: string,
  areaId: string,
  apartmentId: string | null | undefined,
  photoId: string
): string {
  return `${areaPhotoFolder(inspectionId, areaId, apartmentId)}${photoId}.jpg`;
}
