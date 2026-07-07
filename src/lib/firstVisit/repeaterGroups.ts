// Display metadata for block-repeater groups. The survey renders consecutive
// questions sharing a `group_id` (see groupIdFor / buildRenderPlan) inside a
// repeating block. Field feedback (§3.1) was that these blocks appeared with no
// title or intro and a bare "Step N" label, so it was unclear what was being
// asked. This map gives each known group a human title, an optional one-line
// intro, and the noun used to label each block ("Finding 1", "Step 1", ...).
//
// Unknown groups fall back to the legacy "Step N" behaviour (no title/intro)
// so any group_id we haven't catalogued still renders sensibly.

export type RepeaterGroupMeta = {
  title?: string;
  intro?: string;
  itemNoun: string;
};

// Keyed by the V1-redesign repeater group_ids (see questionStructure.ts overlay):
// checkin_step, issue, item. Unknown groups fall back to a bare "Step N".
const GROUPS: Record<string, RepeaterGroupMeta> = {
  checkin_step: {
    title: 'Check-in steps',
    intro: 'Document each access point in sequence, from building entrance to unit door.',
    itemNoun: 'Step',
  },
  issue: {
    title: 'Issue log',
    intro: 'List each issue found — one per problem (broken, damaged, dirty, or missing).',
    itemNoun: 'Issue',
  },
  prop_issue: {
    title: 'Building issue log',
    intro: 'List each building / common-area issue — one per problem (broken, damaged, dirty, or missing).',
    itemNoun: 'Issue',
  },
  item: {
    title: 'Appliances & amenities',
    intro: 'Catalogue each appliance or amenity — its kind, brand, location, and how to use it.',
    itemNoun: 'Item',
  },
};

// Resolve the display metadata for a group_id. Defaults to itemNoun 'Step' and
// no title/intro for unknown / null / undefined groups (back-compat with the
// previous hardcoded "Step N" rendering).
export function repeaterGroupMeta(
  groupId: string | null | undefined,
): RepeaterGroupMeta {
  if (groupId && GROUPS[groupId]) return GROUPS[groupId];
  return { itemNoun: 'Step' };
}
