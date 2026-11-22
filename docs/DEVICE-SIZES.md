# Device sizes for TRIF phone view

Compiled 2026-11-22. All sizes are portrait unless stated. "CSS" = what `screen.width x screen.height` / `window.innerWidth` report at the device's default display settings (points on iOS, dp on Android). "DPR" = device pixel ratio. "Page height" = usable height with the browser bars showing.

Legend: **(u)** = unconfirmed (inferred, or sources disagree; the note says why). "(est)" = my arithmetic from a confirmed pixel size and a typical DPR. Nothing here was measured on a real device.

## Sources

| Id | Source | Used for |
|---|---|---|
| A | Apple tech specs / compare pages: apple.com/iphone/compare, apple.com/ipad/compare, apple.com/iphone-17e/specs, apple.com/iphone-duo/specs, support.apple.com/149482 | iPhone/iPad diagonals and **physical pixels** (authoritative) |
| B | ios-resolution.com (a points database; Apple's HIG Layout page would not load as text) | iPhone/iPad **points**, scale, Display Zoom values. Cross-checked: points = Apple pixels / scale for every row used |
| C | yesviz.com/viewport (database of Chrome-style viewports) | Samsung / Pixel / Xiaomi / OnePlus CSS widths up to ~2025 |
| D | screensizechecker.com/devices/android-viewport-sizes (self-labelled "not independently verified") | Pixel 9/10, Galaxy S21-S25, foldables, Display-size caveats |
| E | Manufacturer pages: store.google.com Pixel 10/11 specs, samsung.com S26 / Z8 / Tab S11 pages | Android diagonals and physical pixels |
| F | StatCounter Global Stats, screen resolution, October 2026 (gs.statcounter.com) | Popularity |
| G | Chrome DevTools device list (from memory, not re-fetched) | Sanity checks only |

CSS width is not something Android manufacturers publish. For Android, widths come from C/D/G, and where the physical pixels and typical DPR give a different number I say so. A real-device check with `innerWidth` / `devicePixelRatio` is the only certainty.

## iPhone (source A for pixels and diagonals, B for points)

All iPhones since the X use 375 pt or wider; every model here is DPR 3 except iPhone 11 and SE (DPR 2).

| Device | Year | CSS W x H | DPR | Physical px | Diagonal | Display Zoom (CSS) |
|---|---|---|---|---|---|---|
| iPhone 18 Pro Max | 2026 | 440 x 956 | 3 | 1320 x 2868 | 6.9" | 375 x 812 |
| iPhone 18 Pro | 2026 | 402 x 874 | 3 | 1206 x 2622 | 6.3" | 320 x 693 |
| iPhone Duo (foldable), inner | 2026 | 626 x 890 | 3 | 1878 x 2670 | 7.6" | (u) |
| iPhone Duo, outer | 2026 | 466 x 678 | 3 | 1398 x 2034 | 5.4" | (u) |
| iPhone 17e | 2026 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | (u) |
| iPhone 17 Pro Max | 2025 | 440 x 956 | 3 | 1320 x 2868 | 6.9" | 375 x 812 |
| iPhone 17 Pro | 2025 | 402 x 874 | 3 | 1206 x 2622 | 6.3" | 320 x 693 |
| iPhone 17 | 2025 | 402 x 874 | 3 | 1206 x 2622 | 6.3" | 320 x 693 |
| iPhone Air | 2025 | 420 x 912 | 3 | 1260 x 2736 | 6.5" | 375 x 812 |
| iPhone 16e | 2025 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | (u) |
| iPhone 16 Pro Max | 2024 | 440 x 956 | 3 | 1320 x 2868 | 6.9" | 375 x 812 |
| iPhone 16 Pro | 2024 | 402 x 874 | 3 | 1206 x 2622 | 6.3" | 320 x 693 |
| iPhone 16 Plus | 2024 | 430 x 932 | 3 | 1290 x 2796 | 6.7" | 375 x 812 |
| iPhone 16 | 2024 | 393 x 852 | 3 | 1179 x 2556 | 6.1" | 320 x 693 |
| iPhone 15 Pro Max | 2023 | 430 x 932 | 3 | 1290 x 2796 | 6.7" | 375 x 812 |
| iPhone 15 Pro | 2023 | 393 x 852 | 3 | 1179 x 2556 | 6.1" | 320 x 693 |
| iPhone 15 Plus | 2023 | 430 x 932 | 3 | 1290 x 2796 | 6.7" | 375 x 812 |
| iPhone 15 | 2023 | 393 x 852 | 3 | 1179 x 2556 | 6.1" | 320 x 693 |
| iPhone 14 Pro Max | 2022 | 430 x 932 | 3 | 1290 x 2796 | 6.7" | 375 x 812 |
| iPhone 14 Pro | 2022 | 393 x 852 | 3 | 1179 x 2556 | 6.1" | 320 x 693 |
| iPhone 14 Plus | 2022 | 428 x 926 | 3 | 1284 x 2778 | 6.7" | 375 x 812 |
| iPhone 14 | 2022 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | 320 x 693 |
| iPhone SE (3rd gen) | 2022 | 375 x 667 | 2 | 750 x 1334 | 4.7" | 320 x 568 |
| iPhone 13 Pro Max | 2021 | 428 x 926 | 3 | 1284 x 2778 | 6.7" | 375 x 812 |
| iPhone 13 Pro | 2021 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | 320 x 693 |
| iPhone 13 | 2021 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | 320 x 693 |
| iPhone 13 mini | 2021 | 375 x 812 | 3 | 1080 x 2340 | 5.4" | 320 x 693 |
| iPhone 12 Pro Max | 2020 | 428 x 926 | 3 | 1284 x 2778 | 6.7" | 375 x 812 |
| iPhone 12 Pro | 2020 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | 320 x 693 |
| iPhone 12 | 2020 | 390 x 844 | 3 | 1170 x 2532 | 6.1" | 320 x 693 |
| iPhone 12 mini | 2020 | 375 x 812 | 3 | 1080 x 2340 | 5.4" | 320 x 693 |
| iPhone SE (2nd gen) | 2020 | 375 x 667 | 2 | 750 x 1334 | 4.7" | 320 x 568 |
| iPhone 11 Pro Max | 2019 | 414 x 896 | 3 | 1242 x 2688 | 6.5" | 375 x 812 |
| iPhone 11 Pro | 2019 | 375 x 812 | 3 | 1125 x 2436 | 5.8" | 320 x 693 |
| iPhone 11 | 2019 | 414 x 896 | 2 | 828 x 1792 | 6.1" | 375 x 812 |

Notes
- Apple pixel counts for 18 Pro / 18 Pro Max / Duo / 17e / Air / 17 / 16 come from Apple's compare and spec pages (A). Points for 18 Pro, 18 Pro Max, 17e, Duo come only from B (pixels / 3 agrees exactly with A). I could not find an Apple page stating points directly; Apple's Layout page did not render as text.
- A separate source (mobileviewer.github.io) lists the 17 as 393 x 852; that is wrong (it would need 1179 px, Apple says 1206). Ignore it.
- Display Zoom ("Larger Text") column is from B only; Apple publishes no such table. iPhone 17e / 16e / Duo zoom values are not listed there, so (u).
- **Page height (Safari, bars shown):** unconfirmed for all iPhones. Rule of thumb, not verified on devices: Safari with the bottom tab bar visible leaves roughly 190 pt (iPhone 15/16 class) to ~200 pt (Pro Max class) less than the screen height, e.g. about 660 pt of page on a 393 x 852 phone. Safari in iOS 26 changed bar heights, so measure before relying on it. The standalone-app / full-screen case is the full CSS height minus safe-area insets.
- 11 / XR-class 414 x 896 is still extremely common in StatCounter data (see Summary).

## iPad (source A for pixels, B for points; DPR 2 on all)

Landscape = swap W and H.

| Device | Year | CSS portrait | Landscape | Physical px | Diagonal | Display Zoom / More Space (CSS portrait) |
|---|---|---|---|---|---|---|
| iPad mini (A20 Pro) | 2026 | 756 x 1158 (u) | 1158 x 756 | 1512 x 2316 | 8.5" | (u) |
| iPad Air 13" (M4) | 2026 | 1024 x 1366 | 1366 x 1024 | 2048 x 2732 | 13" | 768x1024 / 1192x1590 |
| iPad Air 11" (M4) | 2026 | 820 x 1180 | 1180 x 820 | 1640 x 2360 | 11" | More Space 1024x1366 |
| iPad Pro 13" (M5) | 2025 | 1032 x 1376 | 1376 x 1032 | 2064 x 2752 | 13" | 768x1024 / 1192x1590 |
| iPad Pro 11" (M5) | 2025 | 834 x 1210 | 1210 x 834 | 1668 x 2420 | 11" | More Space 1024x1366 |
| iPad (A16) / iPad 11th gen | 2025 | 820 x 1180 | 1180 x 820 | 1640 x 2360 | 11" (10.9" nominal) | none |
| iPad Air 13" / 11" (M3) | 2025 | 1024 x 1366 / 820 x 1180 | swap | 2048 x 2732 / 1640 x 2360 | 13" / 11" | as M4 |
| iPad mini (A17 Pro, 7th gen) | 2024 | 744 x 1133 | 1133 x 744 | 1488 x 2266 | 8.3" | none |
| iPad Pro 13" / 11" (M4) | 2024 | 1032 x 1376 / 834 x 1210 | swap | 2064 x 2752 / 1668 x 2420 | 13" / 11" | as M5 |
| iPad Air 13" / 11" (M2) | 2024 | 1024 x 1366 / 820 x 1180 | swap | 2048 x 2732 / 1640 x 2360 | 13" / 11" | as M4 |
| iPad (10th gen) | 2022 | 820 x 1180 | 1180 x 820 | 1640 x 2360 | 10.9" | none |
| iPad Pro 12.9" (6th gen) / 11" (4th gen) | 2022 | 1024 x 1366 / 834 x 1194 | swap | 2048 x 2732 / 1668 x 2388 | 12.9" / 11" | 768x1024 / 1192x1590; 11" More Space 1024x1366 |
| iPad Air (5th gen) | 2022 | 820 x 1180 | 1180 x 820 | 1640 x 2360 | 10.9" | More Space 1024x1366 |
| iPad (9th gen) | 2021 | 810 x 1080 | 1080 x 810 | 1620 x 2160 | 10.2" | none |
| iPad mini (6th gen) | 2021 | 744 x 1133 | 1133 x 744 | 1488 x 2266 | 8.3" | none |
| iPad Pro 12.9" / 11" (5th gen) | 2021 | 1024 x 1366 / 834 x 1194 | swap | 2048 x 2732 / 1668 x 2388 | 12.9" / 11" | as 6th gen |
| iPad Air (4th gen) | 2020 | 820 x 1180 | 1180 x 820 | 1640 x 2360 | 10.9" | none |
| iPad (8th gen) / (7th gen) | 2020 / 2019 | 810 x 1080 | 1080 x 810 | 1620 x 2160 | 10.2" | none |
| iPad Air (3rd gen) | 2019 | 834 x 1112 | 1112 x 834 | 1668 x 2224 | 10.5" | none |
| iPad mini (5th gen) | 2019 | 768 x 1024 | 1024 x 768 | 1536 x 2048 | 7.9" | none |

Notes
- iPad mini A20 Pro (Oct 2026, OLED): Apple gives 2316 x 1512 at 326 ppi (support.apple.com/149482). Points are inferred as pixels / 2 following every earlier mini (326 ppi, DPR 2); no source states them, so (u). B does not list this model.
- 13" iPad Air (M2/M3/M4) is 1024 x 1366 like the older 12.9" Pro; the 13" Pro (M4/M5) is 1032 x 1376.
- **Page height:** Safari on iPad shows a toolbar of roughly 50-70 pt; (u), not verified. iPadOS 26 windowing also lets users resize Safari, so the width can be anything; screen.width stays the device width.
- iPad Safari requests the desktop site by default, so `screen.width` (820, 1024...) differs from what the site sees in CSS media queries only if Display Zoom is on.

## Android phones: Samsung Galaxy (sources C, D, E; widths are third-party)

Samsung ships WQHD+ panels (S22+/S23+/S24 Ultra etc.) with the default resolution set to FHD+ in many regions, which changes DPR: the same phone reports **384** wide at FHD+ default scaling on S21-S23+ class and **412** where WQHD+ is on. Default state for S24/S25/S26 Plus and Ultra is **unconfirmed**. Source D's own FAQ says Ultras "ship FHD+" and the CSS width stays about 384-412.

| Device | Year | CSS W x H | DPR | Physical px | Diagonal | Notes |
|---|---|---|---|---|---|---|
| Galaxy S26 Ultra | 2026 | 412 x 891 (C) or 412 x 924 (u) | 3.5 | 1440 x 3120 | 6.9" | sources disagree on height |
| Galaxy S26+ | 2026 | 412 x 891 (C) or 390 x 844 (u) | 3.5 | 1440 x 3120 | 6.7" | sources disagree; width (u) |
| Galaxy S26 | 2026 | 360 x 780 | 3.0 | 1080 x 2340 | 6.3" | |
| Galaxy S25 Ultra | 2025 | 412 x 891 | 3.5 | 1440 x 3120 | 6.9" | |
| Galaxy S25+ | 2025 | 412 x 891 | 3.5 | 1440 x 3120 | 6.7" | |
| Galaxy S25 | 2025 | 360 x 780 | 3.0 | 1080 x 2340 | 6.2" | |
| Galaxy S24 Ultra | 2024 | 412 x 891 | 3.5 | 1440 x 3120 | 6.8" | |
| Galaxy S24+ | 2024 | 412 x 891 | 3.5 | 1440 x 3120 | 6.7" | |
| Galaxy S24 | 2024 | 360 x 780 | 3.0 | 1080 x 2340 | 6.2" | |
| Galaxy S23 Ultra | 2023 | 412 x 915 | 3.5 | 1440 x 3088 | 6.8" | |
| Galaxy S23+ | 2023 | 384 x 854 | 2.8125 | 1080 x 2340 | 6.6" | FHD+ default |
| Galaxy S23 | 2023 | 360 x 780 | 3.0 | 1080 x 2340 | 6.1" | |
| Galaxy S22 / S22+ / S22 Ultra | 2022 | 360 x 780 / 384 x 854 / 412 x 915 | 3.0 / 2.8125 / 3.5 | 1080 x 2340 / 1080 x 2340 / 1440 x 3088 | 6.1 / 6.6 / 6.8" | |
| Galaxy S21 / S21+ / S21 Ultra | 2021 | 360 x 800 / 384 x 854 / 384 x 854 | 3.0 / 2.8125 / 3.75 | 1080 x 2400 / 1080 x 2400 / (u) | 6.2 / 6.7 / 6.8" | |
| Galaxy A36 | 2025 | 412 x 918 | 2.625 | 1080 x 2408 | 6.7" | |
| Galaxy A55 / A35 | 2024 | 412 x 892 | 2.625 | 1080 x 2340 | 6.6" | |
| Galaxy A54 | 2023 | 412 x 892 | 2.625 | 1080 x 2340 | 6.4" | |
| Galaxy A16 / A26 / A56 / A06 / A15 / A14 / A13 / A12 | 2021-26 | (u) | | 720 x 1600 on A1x/A0x; 1080 x 2340-2400 on A26/A56/A55 | 6.5-6.7" | A5x/A3x are 412-wide. 720 x 1600 phones report 360 x 800 (DPR 2.0 est); StatCounter's #2 value is 360 x 800 |
| Galaxy Z Fold8 Ultra | 2026 | (u) | (u) | (u); 8.0" main, 6.5" cover | | Samsung's pages gave sizes but no pixels |
| Galaxy Z Fold8 | 2026 | (u) | (u) | (u); 7.6" 4:3 main, 5.5" cover | | |
| Galaxy Z Flip8 | 2026 | (u) | (u) | (u); 6.7" main, 4.1" cover | | Samsung pages differ (6.7" vs 6.9") |
| Galaxy Z Fold7, unfolded | 2025 | 984 x 1092 (u) | 2.0 | 1968 x 2184 | 8.0" | width from C, DPR is an inference from ppi |
| Galaxy Z Flip7, main | 2025 | 360 x 840 | 3.0 | 1080 x 2520 | 6.9" | |
| Galaxy Z Fold6, cover / unfolded | 2024 | 323 x 792 / 619 x 720 | 3.0 | (u) | 6.3" / 7.6" | D; the Fold6 cover is narrower than a "phone" |
| Galaxy Z Flip6, main | 2024 | 393 x 960 | 2.75 | (u) | 6.7" | D |
| Galaxy Z Flip (original) | 2020 | 412 x 1004 | 2.625 | 1080 x 2636 | 6.7" | |

**Page height (Chrome, bars shown):** unconfirmed for all. Typical Android with status bar (~24-28 dp), Chrome toolbar (~56 dp) and gesture-nav handle: subtract about 130 dp from the CSS height (e.g. a 412 x 915 phone gives a page of about 780-790 dp). Estimate only.

## Android phones: Google Pixel (source E for pixels; C/D for CSS)

| Device | Year | CSS W x H | DPR | Physical px | Diagonal | Notes |
|---|---|---|---|---|---|---|
| Pixel 11 Pro XL | 2026 | (u) | (u) | 1344 x 2992 | 6.8" | likely 414 x 921 like 9/10 Pro XL, but not checked |
| Pixel 11 Pro | 2026 | (u) | (u) | 1280 x 2856 | 6.3" | likely 410 x 914 |
| Pixel 11 | 2026 | (u) | (u) | 1080 x 2424 | 6.3" | likely 412 x 923 |
| Pixel 10 Pro Fold, inner / cover | 2025 | 692 x 717 (D) / (u) | 3.0 / 2.625 | 2076 x 2152 / 1080 x 2364 (D) or 2424 (C) | 8.0" / 6.4" (u) | |
| Pixel 10 Pro XL | 2025 | 414 x 921 (D) or 412 x 914 (u) | 3.25 | 1344 x 2992 | 6.8" | two sources disagree |
| Pixel 10 Pro | 2025 | 410 x 914 | 3.125 | 1280 x 2856 | 6.3" | |
| Pixel 10 | 2025 | 412 x 923 | 2.625 | 1080 x 2424 | 6.3" | one source says 393 x 851; the 1080 px / 2.625 arithmetic favours 412 |
| Pixel 9 Pro XL | 2024 | 414 x 921 | 3.25 | 1344 x 2992 | 6.8" | C says 448 x 997 at 3.0 (Chrome "Display size" differs) |
| Pixel 9 Pro | 2024 | 410 x 914 | 3.125 | 1280 x 2856 | 6.3" | C says 427 x 952 |
| Pixel 9 | 2024 | 412 x 923 | 2.625 | 1080 x 2424 | 6.3" | C says 360 x 808 |
| Pixel 9a / 10a | 2025-26 | 412 x ~923 (u) | (u) | 1080 x 2424 (u) | 6.3" (u) | not checked |
| Pixel 8a | 2024 | 412 x 915 | 2.625 | 1080 x 2400 | 6.1" | |
| Pixel 8 Pro | 2023 | 412 x 921 (D) | 3.25 | 1344 x 2992 | 6.7" | C says 448 x 997 |
| Pixel 8 | 2023 | 412 x 915 | 2.625 | 1080 x 2400 | 6.2" | |
| Pixel 7 / 7a | 2022-23 | 412 x 915 | 2.625 | 1080 x 2400 | 6.3 / 6.1" | |
| Pixel 7 Pro | 2022 | 412 x 892 (C) or 412 x 915 (D) | 3.5 | 1440 x 3120 | 6.7" | |
| Pixel Fold (1st gen) | 2023 | (u) | | 2208 x 1840 inner | 7.6" | not checked |

Pixel notes: Pixel 8 Pro and later report a different CSS width depending on the "Display size" setting and a default Chrome "adaptive" scaling. Sources C and D disagree by up to 36 px on the Pro models; this is why those are flagged.

## Android phones: other big sellers (sources C, D; weakest data)

| Device | Year | CSS W x H | DPR | Physical px | Diagonal | Notes |
|---|---|---|---|---|---|---|
| Xiaomi 15 Pro | 2024 | 412 x 914 | 3.5 | (u) | 6.7" | D |
| Redmi Note 13 / Note 12 (FHD+ 1080 x 2400) | 2022-24 | 393 x 873 (est) | 2.75 | 1080 x 2400 | 6.67-6.7" | same as Redmi Note 9 Pro in C; matches StatCounter's 393 x 873 (4.43%) |
| Redmi Note 14 Pro / Pro+ | 2024-25 | 407 x 904 (u) | | 1220 x 2712 | 6.67" | one estimator site only |
| Redmi 13C / 14C / A-class (720 x 1640) | 2023-25 | (u) | | 720 x 1640 | 6.7-6.9" | not checked |
| OnePlus 13 / 12 | 2024-25 | 412 x 905 | 3.5 | 1440 x 3168 | 6.82" | C |
| OnePlus 15 / Nord 5 | 2025-26 | (u) | | (u) | | not checked |
| OnePlus Nord 4 | 2024 | 360 x 924 | 3.0 | 1080 x 2772 | 6.74" | C |
| Motorola Moto G (Power / Play / Stylus / 5G, 2024-26) | | (u) | | mostly 720 x 1600 HD+ or 1080 x 2400 | 6.5-6.8" | no per-device source found; 720 x 1600 phones normally report 360 x 800 or 412 x 915 |
| Motorola Razr 2025 family | 2025 | (u) | | | | not checked |
| Honor Magic7 Pro / vivo X200 Pro / OPPO Find X8 Pro | 2024-25 | 400 x 875 / 394 x 875 / 395 x 869 | 3.2 | (u) | | D, flagged "TBV" by its author |

## Android tablets (weakest data; pixels from E, CSS mostly (u))

| Device | Year | CSS portrait | DPR | Physical px | Diagonal | Notes |
|---|---|---|---|---|---|---|
| Galaxy Tab S11 Ultra | 2025 | (u) | (u) | 2960 x 1848 | 14.6" | |
| Galaxy Tab S11 | 2025 | (u), est 800 x 1280 | 2.0 (est) | 2560 x 1600 (one source; Samsung page gave size only) | 11" | |
| Galaxy Tab S10 Ultra / S10+ / S10 FE | 2024-25 | (u) | | S10 FE: (u) | 14.6 / 12.4 / 10.9" | |
| Galaxy Tab S9 / S9+ / S9 Ultra | 2023 | (u) | | S9: 2560 x 1600 | 11 / 12.4 / 14.6" | |
| Galaxy Tab A9+ / A11+ | 2023-25 | (u) | | A9+: 1920 x 1200 (u) | 11" | |
| Pixel Tablet | 2023 | 800 x 1280 (u) | (u) | 1600 x 2560 (u) | 10.95" (u) | landscape 1280 x 800 matches StatCounter's top tablet value; per-device not confirmed |
| Amazon Fire HD 10 (2023) | 2023 | (u) | (u) | 1920 x 1200 (listing, not Amazon's developer page) | 10.1" | StatCounter's 601 x 1007 (4.02%) is probably a Fire/Kindle-class tablet but this is a guess |

Tablet sizes: Samsung and Google tablets seem to land on 800 x 1280 (portrait) / 1280 x 800 (landscape), the top two StatCounter tablet entries. Treat as a default, not per-model data.

## Summary

### Distinct CSS widths and who shares them (portrait)

| CSS width | Devices |
|---|---|
| 320 | iPhone Display Zoom on non-Max models; iPhone SE/5-class |
| 323 | Galaxy Z Fold6 cover (outlier) |
| 360 | Galaxy S24/S25/S26 base, S23, S22, Flip7 main, many Samsung A1x/A0x (720 x 1600), Moto G low end, Pixel 9 (per C only) |
| 375 | iPhone SE 2/3, iPhone 13 mini / 12 mini, iPhone 11 Pro / XS / X, Display Zoom on Plus/Max iPhones |
| 384 | Galaxy S21+/S21 Ultra/S22+/S23+ at FHD+ default scaling |
| 390 | iPhone 12, 13, 14, 16e, 17e (and Pro versions up to 13) |
| 393 | iPhone 14 Pro, 15, 15 Pro, 16; Redmi/Xiaomi 1080 x 2400 (393 x 873); older Pixel 4a/5 |
| 402 | iPhone 16 Pro, 17, 17 Pro, 18 Pro (**TRIF's current default**) |
| 410-414 | Pixel 9/10 Pro and Pro XL; iPhone 11 / XR / XS Max / 11 Pro Max (414) |
| 412 | Pixel 6-10 base and Plus-size, Galaxy S23 Ultra / S24 Ultra / S25 Ultra, Galaxy A3x/A5x, OnePlus 12/13: the single most common Android width |
| 420 | iPhone Air |
| 428-430 | iPhone Plus / Pro Max up to 16 Plus |
| 440 | iPhone 16 Pro Max / 17 Pro Max / 18 Pro Max |
| 466 | iPhone Duo outer |
| 600-692 | Pixel 10 Pro Fold inner (692), Galaxy Z Fold6 inner (619), Duo inner (626) |
| 744-768 | iPad mini (744), iPad mini 5 (768) |
| 800 | Galaxy / Pixel tablets (u) |
| 810-834 | iPad 10.2" (810), iPad 10.9"/11" (820), iPad Pro 11" (834) |
| 984-1032 | Galaxy Z Fold7 unfolded (984, u), iPad Pro 13" (1032) |
| 1024 | iPad Air 13" / older Pro 12.9" |

### Most common today: StatCounter, October 2026

Source F (gs.statcounter.com screen resolution stats, worldwide). Mobile (all phones): 414 x 896 12.67%, 360 x 800 8.57%, 384 x 832 7.24%, 390 x 844 5.33%, 393 x 873 4.43%, 360 x 780 3.31% (these six are what the page lists; the rest is "Other"). Tablet: 1280 x 800 7.96%, 800 x 1280 7.89%, 768 x 1024 7.39%, 820 x 1180 4.71%, 810 x 1080 4.66%, 601 x 1007 4.02%.

Caution: StatCounter reports what browsers send, which for iOS is quantised to a few buckets (414 x 896 is far above the real iPhone 11 / XR share, so it also absorbs Plus / Max iPhones) and Android values vary by display-size settings. Popular values (414, 360, 384, 390, 393) are not the newest devices. It does not list 402 or 412 in its top six.

### Common CSS breakpoints used by sites

Frameworks and designers commonly use: 320-360 (small phone floor), 375 / 390 (iPhone), 414-430 (large phone), 480 (phone ceiling), 576 (Bootstrap sm), 600 (Material "compact" ceiling), 640 (Tailwind sm), 768 (Bootstrap md, Tailwind md, iPad portrait), 820-834 (iPad Air/Pro 11"), 1024 (Tailwind lg, iPad landscape), 1280 (Tailwind xl). The phone / tablet divider on most sites is 600-768. A phone preview at 402 or 412 is safely below 480 / 600 / 640 and above 375.

### Recommended picker

| Size (CSS) | Label | Why |
|---|---|---|
| 402 x 874 | iPhone 17 / 17 Pro / 18 Pro (**default**, keeps today's behaviour) | Current flagship iPhone; matches TRIF now |
| 390 x 844 | iPhone 12-14 / 16e / 17e | 5.33% of mobile sessions in StatCounter (iPhone size with the biggest installed base) |
| 412 x 915 | Android (Pixel / Galaxy A / S Ultra) | The most common Android width; use 915 as the representative height (Pixel 6-8 / A5x; 923 for Pixel 9-11) |
| 360 x 800 | Small / budget Android | Second most common value in StatCounter (8.57%) and Galaxy S base |
| 440 x 956 | iPhone Pro Max (large) | Upper bound for phone-sized layouts; Plus/Max width |
| 820 x 1180 | iPad 11" / Air (tablet portrait) | 4.71% of tablet sessions; also iPad 10th/11th gen |
| optional: 375 x 667 | iPhone SE | Smallest viewport anyone still tests against (SE 2/3 still sold-in-use) |
| optional: 1180 x 820 | iPad landscape | Landscape counterpart of the above |

Picker advice: offer the six rows as preset names with a "rotate" toggle, plus a free-form W x H. Default 402 x 874 unchanged. Tall height only matters for `100vh` layouts; remember that browsers' bars eat 100-190 CSS px, so consider offering a "with browser bars" mode of height minus 190 (iOS Safari) or minus 130 (Android Chrome); both numbers are estimates (u).

## What I could not confirm

- Apple does not publish points in any page I could read; points come from ios-resolution.com (pixels / scale matches Apple's pixels for every row). Display Zoom and "More Space" values come from that site alone.
- iPad mini (A20 Pro) points; iPhone 17e/16e/Duo Display Zoom.
- Samsung Z Fold8 / Fold8 Ultra / Flip8 pixels and CSS; all Galaxy Tab S9/S10/S11/A-series CSS widths; Pixel 11 / 11 Pro / Pro XL, Pixel 9a/10a, Pixel Fold, Pixel Tablet, Fire HD 10 CSS widths; most Moto and Redmi 14-series values; OnePlus 15.
- Galaxy S26+ / S26 Ultra / Pixel 10 / Pixel Pro XL CSS values where sources disagree (flagged inline).
- Every "page height with bars" value: none of the sources give them; the numbers above are rules of thumb.
