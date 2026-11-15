# Security Specification — ChatCraft Studio

## Data Invariants
1. Every document under `/users/{userId}/...` strictly belongs to `request.auth.uid == userId` with verified email (`request.auth.token.email_verified == true`).
2. PII (`email`) is isolated inside `/users/{userId}/private/info` and never exposed on `/users/{userId}`.
3. Users cannot self-assign elevated roles (`role` is strictly constrained to `'trainee'`).
4. Subcollection writes under `/users/{userId}/sessions/{sessionId}/messages/{messageId}` must pass the Master Gate verifying the parent session exists and belongs to `userId`.
5. Evaluated sessions (`status == 'evaluated'`) are terminally locked against subsequent client updates.
6. All `createdAt` and `updatedAt` timestamps must match `request.time`.

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/uid1/attempts/a1` (`request.auth == null`).
2. Unverified email write (`email_verified == false`) to `/users/uid1/attempts/a1`.
3. Cross-user read/list of `/users/uid2/private/info` by `uid1`.
4. Role escalation on profile creation (`role: "admin"`).
5. Shadow field injection on profile update (`{ displayName: "Test", isAdmin: true }`).
6. Oversized document ID poisoning (`attemptId` > 128 chars or invalid regex characters).
7. Oversized string injection (`summaryVerdict` > 2000 chars or `text` > 4000 chars).
8. Fake client-forged timestamp (`createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`).
9. Modifying immutable `userId` or `createdAt` during session update.
10. Updating a terminally locked session (`status == 'evaluated'` -> `'active'`).
11. Orphaned message creation under a non-existent `sessionId`.
12. Unbounded `dimensions` array (> 5 elements) or invalid `overallScore` (> 100 or < 0).
