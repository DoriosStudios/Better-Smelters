# Better Smelters v1.5.0

This update reworks furnace behavior, improves visuals and interfaces, expands localization, and introduces native automation compatibility with UtilityCraft Item Pipes and other compatible addons.

## HIGHLIGHTS
- Reworked all Better Smelters furnaces with safer and more efficient processing.
- Added native face-aware item automation.
- Added full UtilityCraft Item Pipe compatibility.
- Reworked furnace textures, active states, progress displays, and UI behavior.
- Added Spanish and Portuguese translations.

---

## BLOCKS
### Furnaces
- Reworked the appearance and behavior of all 11 furnace tiers.
- Furnaces now use full-block models.
- Added dedicated textures for every block face in both active and inactive states.
- Furnaces now adjust their processing interval while their interface is open.
- Improved active-state light and texture handling.

## AUTOMATION
- Automatic furnace transfers retain their traditional layout:
  - The top face pulls fuel.
  - The left face pulls smelting inputs.
  - The right face pushes smelted outputs.
- Compatible item-transfer systems receive a broader static face-aware I/O configuration:
  - The top and bottom faces accept fuel.
  - The four horizontal faces accept smelting inputs.
  - All six faces expose the output slot.
- Automated transfers now respect the source and destination faces of compatible containers.
- Added compatibility with UtilityCraft Item Pipes and other supported item-transfer systems.
- Existing furnaces automatically receive the new automation behavior when their world is loaded.
- Neighboring item networks now refresh their visual connections automatically when a furnace is broken.
- Breaking a furnace only drops its fuel, input, and output slots; UI-only flame and progress items are never dropped.

## PERFORMANCE
- Added separate processing intervals for open and closed furnace interfaces.
- Closed furnaces now use a slower tick interval to reduce unnecessary work.
- The Nether Star Furnace retains a faster closed processing interval.
- Reworked elapsed-time scaling so furnace speed, fuel consumption, particle chances, and Oak Furnace failure chance remain consistent across tick intervals.
- Improved output-capacity checks and batch processing when enough progress and inventory space are available.

## RECIPES AND FUELS
- Corrected furnace upgrade recipes and their furnace/ingredient requirements.
- Removed duplicated and outdated smelting entries.
- Removed obsolete recipes tied to unrelated third-party content.
- Improved compatibility with custom recipes and fuels provided by other addons.
- Corrected the Lava Bucket fuel value to `100000` and preserved the empty Bucket after consumption.

## UI/UX
- Expanded the furnace progress arrow from 17 to 23 visual stages.
- Updated progress textures.
- Improved flame and progress-slot rendering.
- Increased the floating-slot rendering area while preserving the intended size of UI-only elements.
- Fixed upgraded furnaces retaining the previous furnace name.
- Added Better Smelters attribution to furnace and upgrade item names.
- Added dedicated creative inventory groups for furnaces and upgrades.

## LOCALIZATION
- Updated English translations.
- Added translations for:
  - Spanish (Spain)
  - Spanish (Mexico)
  - Portuguese (Brazil)
  - Portuguese (Portugal)

## BUG FIXES
- Fixed upgraded furnaces displaying their old label.
- Fixed invalid and outdated upgrade recipes.
- Fixed the Lava Bucket using an incorrect fuel value.
- Fixed UI items being exposed to compatible inventory automation.
- Fixed furnace contents and UI elements being handled incorrectly when the block was destroyed.
- Fixed UtilityCraft Item Pipes retaining their visual connection after a furnace was broken.
