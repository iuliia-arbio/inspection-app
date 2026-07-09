// PMS mapping for the V1 redesign question set: slug → pms_target path.
// Applied by gen.mjs onto the overlay. Slugs NOT in PMS resolve to
// pms_target = null (hub-only — never pushed to the PMS).
//
// Reconciled field-by-field against the LIVE PMS OpenAPI schema
// (https://pms.dev.arbio.io/docs) on 2026-06-25. Decisions (with Joshua):
//   - Gate booleans + the Issue log are hub-only.
//   - Only paths that resolve to a real schema location are pushed. That means
//     TYPED fields, plus keys under the FREEFORM objects profile / operationalInfo
//     / houseRules / categoryProfile (additionalProperties — accepted + returned
//     in GET; downstream consumption to be confirmed by the hub).
//   - Concepts with NO field anywhere in the schema (fireSafety, propertyAssessment,
//     accessibilityInfo, locationProfile, commonAreas, parking type/spot/bike,
//     elevator working/size/condition, host-start date, equip videoUrl, …) are
//     left UNMAPPED (hub backlog) and listed in HUB_BACKLOG → the missing-list doc.
//   - Tags: (T)=typed schema field, (F)=freeform object, (C)=catalog-resolved.

export const PMS = {
  // Phase 1 · Visit metadata (visit-level entity)
  fv_visit_date: 'SiteVisit.visitDate',
  fv_visit_visitor_name: 'SiteVisit.visitorName',

  // Phase 2 · Location & neighbourhood
  fv_location_safety_concern: 'operationalInfo.safetyConcern', // F

  // Phase 3 · Building exterior & parking
  fv_parking_dedicated_spots: 'accessInfo.parking.numberOfSpaces', // T
  fv_parking_access_instructions: 'accessInfo.parking.instructions', // T
  fv_video_parking_access: 'accessInfo.parking.video', // T
  fv_parking_nearby_options: 'nearby.description', // T (POI list)
  fv_building_state: 'operationalInfo.buildingState', // F
  fv_building_mold: 'operationalInfo.buildingMold', // F
  fv_building_construction_nearby: 'operationalInfo.constructionNearby', // F
  fv_building_amenities_verify: 'equipmentAndAmenities (amenity entries)', // C

  // Phase 4 · Building access & check-in (checkin_step repeater)
  fv_step_name: 'accessInfo.checkInSteps.name', // T
  fv_step_access_point: 'accessInfo.checkInSteps.accessPoint', // T
  fv_step_lock_type: 'accessInfo.checkInSteps.lock.type', // T
  fv_step_smart_lock_provider: 'accessInfo.checkInSteps.lock.provider', // T
  fv_step_smart_lock_device_id: 'accessInfo.checkInSteps.lock.externalId', // T
  fv_step_lock_brand: 'accessInfo.checkInSteps.lock.brand', // T
  fv_step_lock_classification: 'accessInfo.checkInSteps.lock.classification', // T
  fv_step_key_storage_method: 'accessInfo.checkInSteps.lock.storageType', // T
  fv_step_storage_brand: 'accessInfo.checkInSteps.lock.storageBrand', // T
  fv_step_default_access_code: 'accessInfo.checkInSteps.lock.defaultCode', // T
  fv_video_checkin_walkthrough: 'accessInfo.checkInSteps.videoUrl', // T
  fv_checkin_complexity: 'operationalInfo.checkinComplexity', // F

  // Phase 5 · Building infrastructure & services
  fv_storage_onsite_check: 'otherDetails.storageInfo.storageSpaceAvailable', // T
  fv_storage_location: 'otherDetails.storageInfo.internalStorageRoomInstructions', // T
  fv_storage_access_instructions: 'otherDetails.storageInfo.internalStorageRoomInstructions', // T
  fv_photo_storage_room: 'profile.photos.url', // F
  fv_storage_comments: 'otherDetails.storageInfo.luggageStorageInformation', // T
  fv_trash_container_location: 'houseRules.garbageDisposal.trashLocationInstructions.description', // F
  fv_trash_pickup_schedule: 'houseRules.garbageDisposal.collectionSchedule', // F
  fv_trash_guest_instructions: 'houseRules.garbageDisposal.guestInstructions', // F
  fv_video_trash_location: 'houseRules.garbageDisposal.trashLocationVideo', // F
  fv_fusebox_location: 'equipmentAndAmenities.location', // T
  fv_fusebox_access: 'equipmentAndAmenities.instructions', // T
  fv_fusebox_reset_instructions: 'equipmentAndAmenities.instructions', // T
  fv_fire_exit_route_notes: 'houseRules.fireSafetyInstructions.description', // F
  fv_video_fire_exit: 'houseRules.fireSafetyInstructions.video', // F
  fv_photo_fire_safety: 'profile.photos.url', // F

  // Phase 6 · Cleaning & laundry  (operationalModel absent → operationalInfo freeform, per decision)
  fv_cleaning_setup: 'operationalInfo.cleaning', // F
  fv_laundry_setup: 'operationalInfo.laundry', // F
  fv_laundry_delivery_frequency: 'equipmentAndAmenities.notes', // T
  fv_laundry_nearest_laundromat: 'nearby.title', // T (POI list)

  // Phase 7 · WiFi (profile freeform)
  fv_wifi_ssid: 'profile.wifiDetails.networkName', // F
  fv_wifi_password: 'profile.wifiDetails.password', // F
  fv_wifi_download_speed_mbps: 'profile.wifiDetails.downloadSpeedMbps', // F
  fv_wifi_upload_speed_mbps: 'profile.wifiDetails.uploadSpeedMbps', // F
  fv_wifi_router_location: 'profile.wifiDetails.routerLocation', // F
  fv_wifi_guest_router_access: 'profile.wifiDetails.guestRouterAccess', // F

  // Phase 8 · Unit identity
  fv_unit_floor_number: 'profile.floor', // F
  fv_unit_location_in_building: 'profile.locationInBuilding', // F
  fv_unit_type_check: 'profile.unitType', // F
  fv_unit_balconies_count: 'balconies', // T
  // fv_unit_terraces_count: no PMS 'terraces' field — annotation-only mapping deliberately omitted
  fv_view_actual: 'profile.viewType', // F
  fv_location_noise_level: 'operationalInfo.noiseLevel', // F
  fv_location_noise_source: 'operationalInfo.noiseSource', // F

  // Phase 9 · Unit capacity
  fv_capacity_base: 'profile.baseCapacity', // F (maxOccupancy is the only typed capacity field)
  fv_capacity_max: 'property.maxOccupancy', // T

  // Phase 11 · Unit appliances & amenities (item repeater)
  item_name: 'equipmentAndAmenities.name', // C (resolved from resourceId)
  item_kind: 'equipmentAndAmenities.type', // C
  item_brand: 'equipmentAndAmenities.brand', // T
  item_location: 'equipmentAndAmenities.location', // T
  item_instructions: 'equipmentAndAmenities.instructions', // T
  item_availability_type: 'equipmentAndAmenities.availabilityType', // T

  // Phase 12 · Unit safety equipment
  fv_unit_fusebox_location: 'equipmentAndAmenities.location', // T
  fv_unit_fusebox_reset_instructions: 'equipmentAndAmenities.instructions', // T
  fv_fire_extinguisher_location: 'equipmentAndAmenities.location', // T
  fv_first_aid_location: 'houseRules.firstAidInstructions.description', // F

  // Phase 13 · Unit amenities & details
  fv_blackout_curtains: 'equipmentAndAmenities (amenity entry)', // C
  fv_ceiling_height_m: 'profile.ceilingHeightM', // F

  // Phase 14 · Unit photos & videos
  fv_photo_bathroom: 'profile.photos.url', // F
  fv_photo_kitchen: 'profile.photos.url', // F
  fv_photo_general_apartment: 'profile.photos.url', // F
  fv_photo_window_ceiling: 'profile.photos.url', // F

  // Phase 15 · Final assessment / readiness
  fv_readiness_overall: 'status.readinessStatus', // T
  fv_readiness_health_score: 'status.healthLevel', // T
};

// Hub backlog: survey data points with NO storable PMS location today. Left
// unmapped (pms_target = null) by decision; the hub must add a typed field (or
// we re-point) before these persist to the PMS. slug → why.
export const HUB_BACKLOG = {
  // Location profile — no locationProfile object on the (typed) property root
  fv_location_quality: 'no location-quality field in PMS',
  fv_neighbourhood_narrative: 'no neighbourhood-narrative field in PMS',
  fv_neighbourhood_vibe_tags: 'no vibe-tags field in PMS',
  fv_best_for_guest_type: 'no best-for-guest field in PMS',
  // Parking detail — accessInfo.parking is typed {instructions, video, numberOfSpaces, parkingIncluded}
  fv_parking_actual_type: 'accessInfo.parking has no type field',
  fv_parking_spot_number: 'accessInfo.parking has no spot-number field',
  fv_parking_bike_available: 'accessInfo.parking has no bike-parking field',
  // Elevator detail — otherDetails.elevator is typed {available, instructions}
  fv_building_elevator_working: 'otherDetails.elevator has no working/status field',
  fv_building_elevator_size: 'otherDetails.elevator has no size field',
  fv_building_elevator_condition: 'otherDetails.elevator has no condition field',
  // Accessibility — no accessibilityInfo object
  fv_accessibility_step_free_entry: 'no accessibility object in PMS',
  fv_accessibility_ramps: 'no accessibility object in PMS',
  fv_accessibility_notes: 'no accessibility object in PMS',
  fv_accessibility_unit_door_widths: 'no accessibility object in PMS',
  // Condition / assessment — no propertyAssessment object
  fv_furniture_status: 'no propertyAssessment object in PMS',
  fv_equipment_status: 'no propertyAssessment object in PMS',
  fv_bathroom_condition: 'no propertyAssessment object in PMS',
  // Fire safety — no fireSafety object
  fv_fire_exit_secondary: 'no fireSafety object in PMS',
  fv_fire_safety_concerns: 'no fireSafety object in PMS',
  fv_fire_extinguisher_service_date: 'no fireSafety object in PMS',
  fv_smoke_detector_working: 'no fireSafety object in PMS',
  fv_co_detector_working: 'no fireSafety object in PMS',
  // Other absent fields
  fv_common_area: 'no commonAreas field on the typed property root',
  fv_checkin_notes_overall: 'accessInfo has no overallNotes field',
  fv_video_fusebox: 'equipmentAndAmenities has no videoUrl field',
  item_video: 'equipmentAndAmenities has no videoUrl field',
  fv_readiness_host_start_date: 'status/dealProfile have no host-start date field',
  fv_readiness_recommendation_summary: 'status has no recommendation-summary field',
};
