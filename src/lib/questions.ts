// Arbio category colors
export const COLORS = {
  categoryGreen: "#10b981", // Check-in
  categoryBlue: "#0ea5e9", // Cleanliness
  categoryRed: "#ef4444", // Condition
  categoryAmber: "#f59e0b", // Accuracy
  categoryOrange: "#f97316", // Strategic
} as const;

export const SHARED_AREAS = [
  { id: "exterior", name: "Exterior & Building Access", scope: "shared" as const },
  { id: "common", name: "Common Areas", scope: "shared" as const },
];

export const UNIT_AREAS_TEMPLATE = [
  { id: "entrance", name: "Entrance & Hallway", scope: "unit" as const, canMultiply: false },
  { id: "living", name: "Living Room", scope: "unit" as const, canMultiply: false },
  { id: "kitchen", name: "Kitchen", scope: "unit" as const, canMultiply: false },
  { id: "dining", name: "Dining Area", scope: "unit" as const, canMultiply: false },
  { id: "bedroom", name: "Bedroom", scope: "unit" as const, canMultiply: true },
  { id: "bathroom", name: "Bathroom", scope: "unit" as const, canMultiply: true },
  { id: "balcony", name: "Balcony / Outdoor", scope: "unit" as const, canMultiply: false },
  { id: "storage", name: "Storage Areas", scope: "unit" as const, canMultiply: false },
  { id: "overall", name: "Overall Furnishings & Décor", scope: "unit" as const, canMultiply: false },
];

export interface Question {
  id: string;
  label: string;  // Short, user-friendly name for reports and tables
  category: string;
  color: string;
  question: string;
}

// High-level questions only (scored 1-10 by AI). Deep-dive points are AI context, not displayed.
export const BASE_QUESTIONS: Record<string, Question[]> = {
  exterior: [
    { id: "ext_checkin", label: "Check-in & access", category: "check-in", color: COLORS.categoryGreen, question: "Is the check-in functioning smoothly (keypad, lockbox, signage)?" },
    { id: "ext_clean", label: "Exterior cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Is the exterior (entry, walls, lighting, pathways) clean and free of obstructions?" },
    { id: "ext_condition", label: "Condition & security", category: "condition", color: COLORS.categoryRed, question: "Is building and unit access in good condition & secure?" },
    { id: "ext_accuracy", label: "Listing accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Is the listing accurate — does what's advertised for access, parking, and building exterior match reality?" },
  ],
  common: [
    { id: "com_clean", label: "Corridors & shared areas", category: "cleanliness", color: COLORS.categoryBlue, question: "Are corridors, stairwells, lifts, or shared laundry areas and guest lounges clean and tidy?" },
    { id: "com_condition", label: "Lighting & safety", category: "condition", color: COLORS.categoryRed, question: "Are lighting, signage, and safety equipment functional and well maintained?" },
    { id: "com_accuracy", label: "Shared areas accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Do the shared areas match listing and guest expectations (clean, accessible, well-presented)?" },
  ],
  entrance: [
    { id: "ent_checkin", label: "Apartment access", category: "check-in", color: COLORS.categoryGreen, question: "Does the apartment access work smoothly with no faults?" },
    { id: "ent_clean", label: "Entrance cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Is the entrance area clean, welcoming, and well-lit?" },
    { id: "ent_condition", label: "Walls & flooring", category: "condition", color: COLORS.categoryRed, question: "Are walls, flooring, and paintwork in good condition with no marks or damage?" },
  ],
  living: [
    { id: "liv_clean", label: "Living room cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Is the living room clean, well presented, and guest-ready?" },
    { id: "liv_condition", label: "Living room condition", category: "condition", color: COLORS.categoryRed, question: "Is the living room in good condition, fully functional, and safe to use?" },
    { id: "liv_accuracy", label: "Living room accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Is the listing accurate — does the living room layout, furniture, and amenities match the listing photos and description?" },
  ],
  kitchen: [
    { id: "kit_clean", label: "Kitchen cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Is the kitchen clean, hygienic, and guest-ready?" },
    { id: "kit_condition", label: "Kitchen condition", category: "condition", color: COLORS.categoryRed, question: "Is the kitchen in good condition, fully functional, and safe to use?" },
    { id: "kit_accuracy", label: "Kitchen accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Does the kitchen match the appliances, layout, and inventory shown in the listing?" },
  ],
  dining: [
    { id: "din_clean", label: "Dining area cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Is the dining area clean, well presented, and guest-ready?" },
    { id: "din_condition", label: "Dining area condition", category: "condition", color: COLORS.categoryRed, question: "Is the dining area in good condition, fully functional, and safe to use?" },
    { id: "din_accuracy", label: "Dining area accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Does the dining area setup and capacity match the photos and description?" },
  ],
  bedroom: [
    { id: "bed_clean", label: "Bedroom cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Are the bedrooms clean, well presented, and guest-ready?" },
    { id: "bed_condition", label: "Bedroom condition", category: "condition", color: COLORS.categoryRed, question: "Are the bedrooms in good condition, fully functional, and safe to use?" },
    { id: "bed_accuracy", label: "Bedroom accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Listing accuracy: bed sizes, count, storage align with listing?" },
  ],
  bathroom: [
    { id: "bath_clean", label: "Bathroom cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Are the bathrooms clean, hygienic, and guest-ready?" },
    { id: "bath_condition", label: "Bathroom condition", category: "condition", color: COLORS.categoryRed, question: "Are the bathrooms in good condition, fully functional, and safe to use?" },
    { id: "bath_accuracy", label: "Bathroom accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Do the bathrooms match the photos and description in the listing?" },
  ],
  balcony: [
    { id: "balc_clean", label: "Outdoor area cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Are all outdoor areas clean, tidy, and guest-ready?" },
    { id: "balc_condition", label: "Outdoor area condition", category: "condition", color: COLORS.categoryRed, question: "Is the outdoor space in good condition, safe, and functional?" },
    { id: "balc_accuracy", label: "Outdoor area accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Does the outdoor area match the listing photos and description?" },
  ],
  storage: [
    { id: "stor_clean", label: "Storage cleanliness", category: "cleanliness", color: COLORS.categoryBlue, question: "Are all guest-accessible storage areas clean, tidy, and ready for use?" },
    { id: "stor_condition", label: "Storage condition", category: "condition", color: COLORS.categoryRed, question: "Are storage areas in good condition, safe, and functional?" },
    { id: "stor_accuracy", label: "Storage accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Does the storage setup match what's shown or described in the listing?" },
  ],
  overall: [
    { id: "overall_standards", label: "Arbio standards", category: "strategic", color: COLORS.categoryOrange, question: "Is the overall furnishing and décor level aligned with Arbio standards?" },
    { id: "overall_aesthetic", label: "Furniture condition", category: "cleanliness", color: COLORS.categoryBlue, question: "Are furnishings and furniture in good aesthetic condition (beyond functionality)?" },
    { id: "overall_upgrades", label: "Upgrades needed", category: "condition", color: COLORS.categoryRed, question: "Does the property require any upgrades or investments to meet brand and guest expectations?" },
    { id: "overall_accuracy", label: "Overall listing accuracy", category: "accuracy", color: COLORS.categoryAmber, question: "Is the listing's décor and furnishing representation accurate?" },
  ],
};

/** Get user-friendly label for a question ID (for reports, Notion, tables). */
export function getQuestionLabel(questionId: string): string {
  for (const arr of Object.values(BASE_QUESTIONS)) {
    const q = arr.find((x) => x.id === questionId);
    if (q) return q.label;
  }
  return questionId;
}

/** Deep-dive questions: keywords (most specific first) map to area + template. */
export const DEEP_DIVE_LIBRARY: {
  keywords: string[];
  areaId: string;
  question: string;
  specificTemplate?: string; // "Describe the {0} and its condition in detail." — {0} = matched keyword
}[] = [
  {
    keywords: ["grout", "mold", "mildew", "shower", "towel", "hair", "toilet", "bathroom", "dirty"],
    areaId: "bathroom",
    question: "Describe the condition of the bathroom in detail (grout, fixtures, cleanliness).",
    specificTemplate: "Describe the {0} and its condition in detail.",
  },
  {
    keywords: ["stove", "oven", "dishwasher", "refrigerator", "appliance", "kitchen", "dirty", "clean"],
    areaId: "kitchen",
    question: "Describe the kitchen appliances and their condition.",
    specificTemplate: "Describe the {0} and its condition in detail.",
  },
  {
    keywords: ["mattress", "bed", "linen", "storage", "closet", "bedroom"],
    areaId: "bedroom",
    question: "Describe the bedroom condition, bedding, and storage.",
    specificTemplate: "Describe the {0} and its condition in detail.",
  },
  {
    keywords: ["sofa", "couch", "furniture", "living", "damaged", "condition"],
    areaId: "living",
    question: "Describe the living room furniture and its condition.",
    specificTemplate: "Describe the {0} and its condition in detail.",
  },
  {
    keywords: ["wall", "mark", "paint", "damage", "hole"],
    areaId: "entrance",
    question: "Describe any wall damage, marks, or paint issues.",
  },
  {
    keywords: ["window", "leak", "leaky", "draft", "broken"],
    areaId: "bedroom",
    question: "Describe the window condition and any leaks or drafts.",
    specificTemplate: "Describe the {0} and its condition in detail.",
  },
  {
    keywords: ["wi-fi", "wifi", "internet", "connection"],
    areaId: "overall",
    question: "Note any Wi‑Fi or connectivity issues observed.",
  },
  {
    keywords: ["handle", "lock", "door", "broken"],
    areaId: "entrance",
    question: "Describe door, handle, and lock condition.",
    specificTemplate: "Describe the {0} and its condition.",
  },
  {
    keywords: ["balcony", "outdoor", "terrace"],
    areaId: "balcony",
    question: "Describe the outdoor/balcony area condition.",
  },
  {
    keywords: ["stairwell", "stair", "corridor", "entrance", "floor", "dust"],
    areaId: "entrance",
    question: "Describe the entrance, stairwell, and floor condition.",
  },
  {
    keywords: ["storage", "closet", "wardrobe"],
    areaId: "storage",
    question: "Describe storage areas and their condition.",
  },
  {
    keywords: ["dining", "table", "chair"],
    areaId: "dining",
    question: "Describe the dining area and furniture condition.",
  },
];

/** Generic keywords to deprioritize when picking the best match (prefer "stove" over "appliance"). */
const GENERIC_KEYWORDS = new Set(["kitchen", "bathroom", "appliance", "living", "bedroom", "dirty", "clean", "condition", "damaged"]);

/** Find the most specific keyword that appears in issue text (prefer specific terms like "stove" over "appliance"). */
function findBestMatchingKeyword(
  keywords: string[],
  issueText: string
): string | null {
  const lower = issueText.toLowerCase();
  const matched = keywords.filter((k) => lower.includes(k));
  if (matched.length === 0) return null;
  // Prefer non-generic, then shorter (more specific noun)
  const sorted = matched.sort((a, b) => {
    const aGeneric = GENERIC_KEYWORDS.has(a) ? 1 : 0;
    const bGeneric = GENERIC_KEYWORDS.has(b) ? 1 : 0;
    if (aGeneric !== bGeneric) return aGeneric - bGeneric; // non-generic first
    return a.length - b.length; // shorter first when both same type
  });
  return sorted[0];
}

/** Extract specific term from issue for question customization. Skip generic adjectives (dirty, clean) — they produce bad questions like "Describe the Dirty". */
function getSpecificQuestion(
  entry: (typeof DEEP_DIVE_LIBRARY)[0],
  issueText: string
): string {
  if (!entry.specificTemplate) return entry.question;
  const kw = findBestMatchingKeyword(entry.keywords, issueText);
  if (!kw || GENERIC_KEYWORDS.has(kw)) return entry.question; // Never use "dirty", "clean" etc. as the subject
  const term = kw.charAt(0).toUpperCase() + kw.slice(1);
  return entry.specificTemplate.replace("{0}", term);
}

/** Returns deep-dive questions for an area when apartment issues match. Uses specific terms when available. */
export function getDeepDiveQuestions(areaId: string, issues: string[]): { question: string }[] {
  if (!issues?.length) return [];
  const baseId = areaId.replace(/_\d+$/, "");
  const issueText = issues.join(" ").toLowerCase();
  return DEEP_DIVE_LIBRARY.filter(
    (d) => d.areaId === baseId && d.keywords.some((k) => issueText.includes(k))
  ).map((d) => ({ question: getSpecificQuestion(d, issues.join(" ")) }));
}

/** Returns true if any known issues are relevant to this area (for deep-dive). */
export function hasIssuesForArea(areaId: string, issues: string[]): boolean {
  if (!issues?.length) return false;
  const baseId = areaId.replace(/_\d+$/, "");
  const issueText = issues.join(" ").toLowerCase();
  return DEEP_DIVE_LIBRARY.some(
    (d) => d.areaId === baseId && d.keywords.some((k) => issueText.includes(k))
  );
}

/** Returns true if any focus-area issues are relevant to this shared area. */
export function hasIssuesForAreaFromFocusAreas(
  areaId: string,
  focusAreas: { category: string; issues: string[] }[]
): boolean {
  if (!focusAreas?.length) return false;
  const allIssues = focusAreas.flatMap((f) => f.issues ?? []);
  return hasIssuesForArea(areaId, allIssues);
}

/** Returns deep-dive questions for shared areas based on deal focus areas. */
export function getDeepDiveFromFocusAreas(
  areaId: string,
  focusAreas: { category: string; issues: string[] }[]
): { question: string }[] {
  if (!focusAreas?.length) return [];
  const baseId = areaId.replace(/_\d+$/, "");
  const allIssues = focusAreas.flatMap((f) => f.issues ?? []);
  const issueText = allIssues.join(" ").toLowerCase();
  return DEEP_DIVE_LIBRARY.filter(
    (d) => d.areaId === baseId && d.keywords.some((k) => issueText.includes(k))
  ).map((d) => ({ question: getSpecificQuestion(d, allIssues.join(" ")) }));
}
