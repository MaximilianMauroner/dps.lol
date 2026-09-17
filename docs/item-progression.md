# Level-aware Yunara inventory progression

The private prototype derives attacker inventory defaults from the existing verified `26.18`
timeline rows. It never calls Riot or treats enemy target samples as attacker-build evidence.

For each Yunara match/participant/level, extraction keeps one observation: the latest timeline
frame observed while that participant was at that level. This removes repeated minute frames and
prevents a long level interval from receiving more weight than a short one. The aggregate reports
distinct matches and deduped observations separately.

Inventory classification uses the patch-pinned Data Dragon item fields and the same completed-item
classifier used by third-item anchors. Completed legendaries are counted separately from boots
(basic/upgraded), components, wards, trinkets, consumables, and support quest intermediates. Unknown
items are retained only as `componentOrOther` server-side and are not silently promoted to
legendaries.

The authenticated `/api/progression?champion=Yunara&level=13` endpoint returns sanitized aggregate
data only. It includes exact-level and selected nearby-level sample counts, distribution percentages,
mean/median/mode, common cores, boot frequencies, exact-count frequency, and supported-core
frequencies. If the exact level has fewer than 20 observations, the selector widens to ±1 and then
±2 levels when that reaches the threshold; the response labels the levels used and remains
low-sample when the exact level is small. No match IDs, PUUIDs, or raw archives reach the client.

For a chosen completed-legendary count `k`, progression percentile is the empirical midrank
`P(X < k) + 0.5 P(X = k)`. Tail rarity is `P(X >= k)`, and exact-count frequency is `P(X = k)`.
These describe economic/item progression only, never skill, rank quality, or win probability.
Build cards show each build's count, both rarity measures, exact count frequency, and observed core
frequency independently. Manual item edits are preserved across level changes; “Use realistic level
default” explicitly resets both builds. The selection also returns the excluded observed item IDs
and names: if the modal observed core contains an item without a verified combat plugin (for
example Yun Tal Wildarrows (3032) in this corpus), the UI calls it out beside the build cards and
removes it from both simulated builds. The omitted item is not treated as a zero-stat item; the
result is explicitly a nearest-supported subset until that item's patch mechanics are verified.
Gluttonous Greaves (3008) remains selectable and costed, while its omnivamp/takedown effects are
called out as unmodeled.
