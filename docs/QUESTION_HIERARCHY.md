# Full Question Hierarchy — scored questions

This document describes the complete hierarchy of questions used in the inspection flow that can be scored (1–10) by AI.

---

## Structure

```
Inspection
├── Shared Areas (inspected once)
│   ├── Exterior & Building Access
│   └── Common Areas
└── Unit blocks (per selected unit)
    ├── Entrance & Hallway
    ├── Living Room(s) — only if living_rooms ≥ 1
    ├── Kitchen
    ├── Dining Area
    ├── Bedroom(s) — count from unit config
    ├── Bathroom(s) — count from unit config
    ├── Balcony / Outdoor
    ├── Storage Areas
    └── Overall Furnishings & Décor
```

---

## Shared areas

### Exterior & Building Access (`exterior`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `ext_checkin` | check-in | Is the check-in functioning smoothly (keypad, lockbox, signage)? |
| `ext_clean`   | cleanliness | Is the exterior (entry, walls, lighting, pathways) clean and free of obstructions? |
| `ext_condition` | condition | Is building and unit access in good condition & secure? |
| `ext_accuracy` | accuracy | Is the listing accurate — does what's advertised for access, parking, and building exterior match reality? |

### Common Areas (`common`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `com_clean`   | cleanliness | Are corridors, stairwells, lifts, or shared laundry areas and guest lounges clean and tidy? |
| `com_condition` | condition | Are lighting, signage, and safety equipment functional and well maintained? |
| `com_accuracy` | accuracy | Do the shared areas match listing and guest expectations (clean, accessible, well-presented)? |

---

## Unit areas

### Entrance & Hallway (`entrance`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `ent_checkin` | check-in | Does the apartment access work smoothly with no faults? |
| `ent_clean`   | cleanliness | Is the entrance area clean, welcoming, and well-lit? |
| `ent_condition` | condition | Are walls, flooring, and paintwork in good condition with no marks or damage? |

### Living Room (`living`, `living_2`, …)

> **Note:** Only shown when unit has `living_rooms ≥ 1`. If `living_rooms = 0`, this area is skipped.

| Question ID  | Category | Question |
|--------------|----------|----------|
| `liv_clean`   | cleanliness | Is the living room clean, well presented, and guest-ready? |
| `liv_condition` | condition | Is the living room in good condition, fully functional, and safe to use? |
| `liv_accuracy` | accuracy | Is the listing accurate — does the living room layout, furniture, and amenities match the listing photos and description? |

### Kitchen (`kitchen`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `kit_clean`   | cleanliness | Is the kitchen clean, hygienic, and guest-ready? |
| `kit_condition` | condition | Is the kitchen in good condition, fully functional, and safe to use? |
| `kit_accuracy` | accuracy | Does the kitchen match the appliances, layout, and inventory shown in the listing? |

### Dining Area (`dining`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `din_clean`   | cleanliness | Is the dining area clean, well presented, and guest-ready? |
| `din_condition` | condition | Is the dining area in good condition, fully functional, and safe to use? |
| `din_accuracy` | accuracy | Does the dining area setup and capacity match the photos and description? |

### Bedroom (`bedroom`, `bedroom_2`, …)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `bed_clean`   | cleanliness | Are the bedrooms clean, well presented, and guest-ready? |
| `bed_condition` | condition | Are the bedrooms in good condition, fully functional, and safe to use? |
| `bed_accuracy` | accuracy | Listing accuracy: bed sizes, count, storage align with listing? |

### Bathroom (`bathroom`, `bathroom_2`, …)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `bath_clean`   | cleanliness | Are the bathrooms clean, hygienic, and guest-ready? |
| `bath_condition` | condition | Are the bathrooms in good condition, fully functional, and safe to use? |
| `bath_accuracy` | accuracy | Do the bathrooms match the photos and description in the listing? |

### Balcony / Outdoor (`balcony`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `balc_clean`   | cleanliness | Are all outdoor areas clean, tidy, and guest-ready? |
| `balc_condition` | condition | Is the outdoor space in good condition, safe, and functional? |
| `balc_accuracy` | accuracy | Does the outdoor area match the listing photos and description? |

### Storage Areas (`storage`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `stor_clean`   | cleanliness | Are all guest-accessible storage areas clean, tidy, and ready for use? |
| `stor_condition` | condition | Are storage areas in good condition, safe, and functional? |
| `stor_accuracy` | accuracy | Does the storage setup match what's shown or described in the listing? |

### Overall Furnishings & Décor (`overall`)

| Question ID  | Category | Question |
|--------------|----------|----------|
| `overall_standards` | strategic | Is the overall furnishing and décor level aligned with Arbio standards? |
| `overall_aesthetic` | cleanliness | Are furnishings and furniture in good aesthetic condition (beyond functionality)? |
| `overall_upgrades` | condition | Does the property require any upgrades or investments to meet brand and guest expectations? |
| `overall_accuracy` | accuracy | Is the listing's décor and furnishing representation accurate? |

---

## Deep-dive questions

Deep-dive questions are **contextual** — they appear only when apartment/deal issues mention related keywords. They are not part of the base scored set; they guide the inspector to elaborate on known concerns.

| Area       | Keywords (issue text) | Question |
|------------|------------------------|----------|
| bathroom   | bathroom, shower, grout, mold, mildew, hair, towel, dirty, toilet | Describe the condition of the bathroom in detail (grout, fixtures, cleanliness). |
| kitchen    | kitchen, stove, oven, appliance, dishwasher, refrigerator, dirty, clean | Describe the kitchen appliances and their condition. |
| bedroom    | bedroom, bed, linen, mattress, storage, closet | Describe the bedroom condition, bedding, and storage. |
| living     | living, furniture, sofa, couch, damaged, condition | Describe the living room furniture and its condition. |
| entrance   | wall, mark, paint, damage, hole | Describe any wall damage, marks, or paint issues. |
| bedroom    | window, leak, leaky, draft, broken | Describe the window condition and any leaks or drafts. |
| overall    | wi-fi, wifi, internet, connection | Note any Wi‑Fi or connectivity issues observed. |
| entrance   | door, handle, lock, broken | Describe door, handle, and lock condition. |
| balcony    | balcony, outdoor, terrace | Describe the outdoor/balcony area condition. |
| entrance   | stairwell, stair, corridor, entrance, floor, dust | Describe the entrance, stairwell, and floor condition. |
| storage    | storage, closet, wardrobe | Describe storage areas and their condition. |
| dining     | dining, table, chair | Describe the dining area and furniture condition. |

---

## Categories & colors

| Category    | Color       | Hex       |
|------------|-------------|-----------|
| check-in   | Green       | `#10b981` |
| cleanliness| Blue        | `#0ea5e9` |
| condition  | Red         | `#ef4444` |
| accuracy   | Amber       | `#f59e0b` |
| strategic  | Orange      | `#f97316` |

---

## Data model

- **Scored questions** use `question_id` values (e.g. `ext_checkin`, `kit_clean`) in `ins_question_scores`.
- **Photos** link to questions via `question_id` in `ins_inspection_photos`.
- **Deep-dive IDs** in UI use `dd_{baseAreaId}_{index}` (e.g. `dd_bathroom_0`) for photo association.
