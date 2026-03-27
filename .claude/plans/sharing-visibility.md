# Sharing Visibility — Show group info on trips & trip info on groups

## Current State
- Groups, sharing, inviting, unshare, roles — all already implemented
- Unshare by group owner — already works (groups.py:570)
- Missing: **trips don't show which groups they're shared with**
- Missing: **group cards don't show shared item counts**
- Missing: **share button on trip cards** (currently must go to Groups page)

## Changes

### 1. Backend: Add `shared_with_groups` to trip list endpoints

**`trips.py` — `GET /api/trips`**
- Join against `group_shared_items` + `adventure_groups` to get group names
- Add `shared_with_groups: [{id, name}]` to each trip in the response

**`trip_planner.py` — `GET /api/trip-planner/trips`**
- Same join pattern for multi-day trips

### 2. Backend: Add `shared_item_count` to group list endpoint

**`groups.py` — `GET /api/groups`**
- Add a subquery to count shared items per group
- Return `shared_item_count` on each group card

### 3. Frontend Types

**`types.ts`**
- Add `shared_with_groups?: { id: string; name: string }[]` to `TripSummary`

### 4. Frontend: Group badges on trip cards

**`SavedTrips.tsx`**
- Show small colored badges with group names below the stats row
- Each badge is a pill like `[Alps 2026]` in a muted blue/purple

### 5. Frontend: Share button on trip cards + Share dialog

**`SavedTrips.tsx`**
- Add a "Share" button in the hover actions row (next to Export/Delete)
- Opens a small inline dropdown listing user's groups
- Select a group → calls `POST /api/groups/{id}/share`
- Need to pass user's groups list down as prop (loaded in page.tsx)

**`page.tsx`**
- Load user's groups list for the share dropdown
- Pass to SavedTrips as prop

### 6. Frontend: Shared item count on group cards

**`groups/page.tsx`**
- Show `shared_item_count` on each group card (e.g., "3 shared trips")

### 7. Frontend: Unshare from trip card

- On trip cards that are shared, show an "Unshare" option per group badge
- Calls `DELETE /api/groups/{gid}/shared/{shared_item_id}`
- Need shared_item_id — backend should return it with the shared_with_groups data

## Files to modify
- `backend/app/api/trips.py` — add shared_with_groups to list
- `backend/app/api/trip_planner.py` — add shared_with_groups to list
- `backend/app/api/groups.py` — add shared_item_count to list
- `web/src/lib/types.ts` — add shared_with_groups type
- `web/src/components/route/SavedTrips.tsx` — badges + share button
- `web/src/app/page.tsx` — load groups, pass to SavedTrips
- `web/src/app/groups/page.tsx` — show shared count on cards
