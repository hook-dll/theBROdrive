# Physics references: published figures per car

The yardstick for the car-physics work: every published performance and handling figure found for each running gear the game drives, with its conditions and source. Factory passport figures (also in `tools/reality.ts`) and measured road tests sit side by side, kept apart by the `figure` qualifier. Research cut-off: 2026-10-17.

## How to read this file

- One section per drivable car (`CAR_MODELS` = `KIT_CARS` in `src/vehicle/carmodels.ts`), headed `## <game id> — <name>`. The running-gear sibling each kit car takes is in the heading line below it.
- Table columns: `figure | value | conditions | source | confidence`. `tools/physics-suite.ts` parses them.
- **The figure key is the cell's first word.** Comparable keys: `0-80` (s), `0-100` (s), `top` (km/h), `brake100` (m), `brake80` (m), `skidpad_g` (g), `understeer` (deg/g), `dlc` (km/h), `coast50` (m), `turn_circle` (m, diameter). Any other key (`0-60mph`, `brake_g_30mph`, `handling`, …) is context and is not compared.
- **The qualifier follows the key:**
  - `passport`: the factory's claimed figure.
  - `ceiling`: a type-approval upper bound ("не более"). The car fails only by exceeding it.
  - `floor`: a factory lower bound ("не менее"). Used only for coastdown.
  - `measured`: a road test of this car.
  - `derived`: arithmetic on a measured figure, assuming constant deceleration (a = v²/2s), and stated in the row.
  - `sibling`: a measured figure from a different variant, named in the conditions. Weak evidence.
- Values are plain numbers or a range `a–b`. `—` means none was found.
- **Turning circle is always a diameter.** A factory "радиус поворота по колее наружного колеса" (turning radius on the outer wheel's track) is doubled, and the row says so. Western "between kerbs" is a kerb-to-kerb diameter; "between walls" is body-swept.
- Units: 1 mph = 1.609 km/h, 1 ft = 0.3048 m, 1 lb = 0.4536 kgf.
- Confidence:
  - **high**: the primary document was read (a manual, a magazine test scan, or the magazine's own web article).
  - **med**: a reputable secondary source, or a magazine's own retrospective of its test.
  - **low**: a forum post, a second-hand quote, or a search-result snippet (marked "snippet").
- Passport rows marked "via reality.ts" were read and recorded by the `tools/reality.ts` audit, whose manifest names the same URLs. Everything else was read for this file.

### Source keys used in many tables

| key | document | URL |
|---|---|---|
| AO | autoopt.ru encyclopedia, reprints of the period factory catalogues | `https://www.autoopt.ru/auto/encyclopedia/car/<make>/mark/<model>` (full URL per row) |
| M74 | *Motor* Road Test 39/74, Lada 1200, MIRA (typed transcription) | https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf |
| AC75 | *Autocar* 25 Jan 1975, Lada 1200, MIRA (typed transcription) | https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOCAR-1975-01-25-Lada-1200.pdf |
| PM74 | *Popular Motoring* Nov 1974, Lada 1200 (scan) | https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/Popular-Motoring-Road-Test.pdf |
| CAR75 | *CAR* Giant Test, March 1975 (scans) | https://www.flickr.com/photos/triggerscarstuff/sets/72157628606450259/ |
| AS75 | *Autosport* 18 Dec 1975, Lada 1200 estate | https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOSPORT-1975-12-18-Lada-1200-Kombi.pdf |
| AR72 | Swiss *Automobil Revue* test table, reprinted in *Autó-Motor* 1972-04-06 | https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1972_04_06_02.jpg |
| KERMI71 | Hungarian state test institute, VAZ-2101, *Autó-Motor* 1971-03-21 | https://www.veteranzsiguli.hu/wp-content/uploads/2018/06/AM_1971_03_21_04.jpg |
| M76 | *Motor* Road Test 32/76, Lada 1500 (scan) | https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1976-Lada-1500.pdf |
| KERMI73 | KERMI, VAZ-2103, *Autó-Motor* 1973-08-21 | https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1973_08_21_4.jpg |
| KERMI78 | KERMI, Lada 1600 (VAZ-2106), *Autó-Motor* 1978-12-24 | https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/ |
| AP90 | *Autópiac* 1990/16–17, Samara vs 2105 | https://www.veteranzsiguli.hu/wp-content/uploads/2020/07/Szamara-2105_2109.pdf |
| A294 | *A2* Dec 1994, 21061 vs 21053 | https://www.veteranzsiguli.hu/korabeli-ujsagcikkek-tesztek/a2-21061-21053-teszt/14641/ |
| WC85 | *What Car?* July 1985, Riva 1500 GLS (scan) | https://www.flickr.com/photos/triggerscarstuff/3032693338 |
| AC86 | *Autocar* 2 Jul 1986, Riva 1500 Estate, MIRA (scan) | https://www.flickr.com/photos/triggerscarstuff/3058241785 |
| AC87 | *Autocar* 2 Dec 1987, Samara 1300 SL 3-door, Millbrook (scan) | https://www.flickr.com/photos/triggerscarstuff/albums/72157615677413212/ |
| ACM88 | *Autocar & Motor* 14 Dec 1988, Samara 1300L 5-door (scan) | https://www.flickr.com/photos/triggerscarstuff/albums/72157617135250114/ |
| CAR88 | *CAR* Dec 1988, Escort 1.3 vs Samara 1300 SL | https://www.flickr.com/photos/triggerscarstuff/4475995541 |
| CAR94 | *CAR* Oct 1994, Samara 1.5GL 3-door | https://www.flickr.com/photos/triggerscarstuff/albums/72157629535623725/ |
| CD89 | *Car and Driver* June 1989, Samara 1500 3-door (data box re-read for this file) | https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/ |
| ZR02 | *За рулём* 10/2002, measured top speeds per UNECE R68, quoted second-hand | http://autofaq.ru/articles/299/2369 |
| ZR04 | *За рулём* Nov 2004, VAZ-21102 vs 21103, Dmitrov | https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/ |
| AR22 | *Авторевю* 12/2022, quotes AR's own 2110 stop | https://autoreview.ru/articles/kak-eto-rabotaet/espasi-i-absohrani |
| AR-ixbt | *Авторевю* 100-0 figures quoted in a 2004 forum post | https://forum.ixbt.com/post.cgi?id=print%3A70%3A872 |
| AC87N | *Autocar* 4 Feb 1987, Niva Cossack Cabrio, Millbrook (scan) | https://www.flickr.com/photos/triggerscarstuff/albums/72157611289350006/ |
| ADAC11 | ADAC Autotest Dec 2011, Niva 1.7i | https://assets.adac.de/image/upload/Autodatenbank/Autotest/AT4692_Lada_Niva_1_7i_Exclusiv/Lada_Niva_1_7i_Exclusiv.pdf |
| AB02 | *Auto Bild* 23 Mar 2002, Niva 1.7i | https://www.autobild.de/artikel/unterwegs-mit-dem-lada-niva-35815.html |
| PB00 | *Parabrisas* (AR) 257, Mar 2000, Niva 1.7i | https://importados.testdelayer.com.ar/test/lada-niva.htm |
| AWfi | autowiki.fi pages quoting Tekniikan Maailma / Tuulilasi (snippets: the pages timed out) | https://www.autowiki.fi/index.php/Lada_Samara, …/Lada_4x4, …/GAZ-24_Volga, …/Lada_110 |
| AR92 | *Авторевю* 9-10/1992, Moskvich-2141 vs Fiat Croma, as retold by AR in 2020 (read for this file) | https://autoreview.ru/special/thirty-years/167367 |
| AR16V | *Авторевю* 18/2016 retrotest, 1976 GAZ-24 | https://autoreview.ru/articles/retrotest/gazgolder |

---

## kit_vaz2101 — VAZ-2101 Zhiguli

Running gear: `sv_vaz2101`. 1.2 L, 4-speed, 4.30 axle, 155 R13 / 165/80 R13 radial, front disc / rear drum, no servo.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 142 | 1982 catalogue | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2101) via reality.ts | high |
| top measured | 144.3 | Mean, MIRA banked circuit; overcast, wind 5–12 mph; test mass 1145 kg; Dunlop SP4 155SR13 | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| top measured | 146 | Mean by fifth wheel; +6 °C, 550 m altitude; DIN kerb 963 kg | [AR72](https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1972_04_06_02.jpg) | high |
| top measured | 137 | Mean 85 mph in the table (86 in the text); MIRA; laden 1141 kg; Michelin ZX 155-13 | [AC75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOCAR-1975-01-25-Lada-1200.pdf) | high |
| top measured | 141.6 | 88 mph true; dry; kerb 950 kg | [PM74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/Popular-Motoring-Road-Test.pdf) | high |
| 0-100 passport | 20 | Driver + passenger | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2101) via reality.ts | high |
| 0-100 measured | 18.1 | M74 test as above (2 crew + gear, 1145 kg) | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| 0-100 measured | 17.9 | Two persons aboard | [AR72](https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1972_04_06_02.jpg) | high |
| 0-100 measured | 23.5 | Half load (200 kg), winter, ~3600 km on the car | [KERMI71](https://www.veteranzsiguli.hu/wp-content/uploads/2018/06/AM_1971_03_21_04.jpg) | high |
| 0-80 measured | 10.5 | As the M74 0-100 row | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| 0-80 measured | 11.4 | As the AR72 0-100 row | [AR72](https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1972_04_06_02.jpg) | high |
| 0-60mph measured | 14.4–18.4 | 14.7 (M74), 18.4 (AC75, an outlier), 14.4 (PM74), 18.1 (CAR75, conditions not printed) | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf), [AC75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOCAR-1975-01-25-Lada-1200.pdf), [PM74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/Popular-Motoring-Road-Test.pdf), [CAR75](https://www.flickr.com/photos/triggerscarstuff/sets/72157628606450259/) | high/med |
| brake80 ceiling | 43.2 | GOST 22895-77, at gross mass 1355 kg. The repair manual RK prints 38 m | [AP](https://autoprospect.ru/vaz/2101-zhiguli/1-4-tekhnicheskaya-kharakteristika-avtomobilejj.html) via reality.ts; [RK](https://remkomplekt.org/vaz-2101/tehnicheskie-harakteristiki.html) | high |
| brake_dist_mph measured | 9.4 / 19.8 / 32.0 / 45.7 | Stops from 30 / 40 / 50 / 60 mph, in m (31 / 65 / 105 / 150 ft); "averaged distances"; pedal force not stated; no ABS | [PM74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/Popular-Motoring-Road-Test.pdf) | high |
| brake100 derived | 49.0 | PM74 60 mph stop (0.80 g mean) rescaled to 100 km/h | [PM74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/Popular-Motoring-Road-Test.pdf) | derived |
| brake_g_30mph measured | 1.00 | 90 lb (41 kgf) pedal, 9 m. Also 0.87 g at 75 lb, 0.65 g at 50 lb; SP4 155SR13 27/28 psi; servo per the spec block | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| brake_g_30mph measured | 0.95 | 100 lb (45 kgf) pedal, in neutral, no servo. 0.82 g at 80 lb, 0.60 g at 60 lb; handbrake 0.33 g | [AC75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOCAR-1975-01-25-Lada-1200.pdf) | high |
| brake_fade measured | 45→75 lb | Pedal force for 0.5 g: stop 1 → stop 10 of 20 stops from 65 mph at 1 min intervals | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| turn_circle passport | 11.2 | 2 × 5.6 m radius by the outer wheel | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2101) via reality.ts | high |
| turn_circle measured | 10.3–11.3 | Between kerbs, L/R; 2.7 turns lock to lock | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| turn_circle measured | 10.5–10.7 | Between kerbs L 34 ft 6 in, R 35 ft 0 in; between walls ~10.9–11.1 m | [AC75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOCAR-1975-01-25-Lada-1200.pdf) | high |
| turn_circle_walls measured | 11.3 | Body-swept (wall-to-wall); 3 turns lock to lock | [AR72](https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1972_04_06_02.jpg) | high |
| weight_front measured | 0.54 | Kerb front axle share | [AR72](https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1972_04_06_02.jpg) | high |
| handling measured | understeer | "Understeers much more consistently than a 124"; steering heavy and frictional | [M74](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1974-08-03-Lada-1200.pdf) | high |
| coast50 floor | — | The AO 1982 table has no coastdown row | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2101) | — |

## kit_vaz2102 — VAZ-2102 estate

Running gear: `sv_vaz2102`. The 2101 with a 4.44 axle and 165 R13.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 138 | ru.wikipedia. RK prints 135 km/h at full mass | [wiki](https://ru.wikipedia.org/wiki/ВАЗ-2102) via reality.ts; [RK](https://remkomplekt.org/vaz-2101/tehnicheskie-harakteristiki.html) | med |
| 0-100 passport | 23 | Driver + passenger | [RK](https://remkomplekt.org/vaz-2101/tehnicheskie-harakteristiki.html) via reality.ts | high |
| top measured | 145 | "Genuine 90 mph"; high-mileage press car; method not stated | [AS75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOSPORT-1975-12-18-Lada-1200-Kombi.pdf) | med |
| 0-60mph measured | 14.8 | Weight 965 kg; standing ¼ mile 20.1 s; timing method not stated | [AS75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOSPORT-1975-12-18-Lada-1200-Kombi.pdf) | med |
| brake80 ceiling | 43.2 | Gross mass 1440 kg (kerb + 430 kg) | [AP](https://autoprospect.ru/vaz/2101-zhiguli/1-4-tekhnicheskaya-kharakteristika-avtomobilejj.html) via reality.ts | high |
| turn_circle passport | 11.2 | 2 × 5.6 m, as the VAZ-2101 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2101) via reality.ts | high |
| handling measured | understeer | "Less understeer than on the 124" | [AS75](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/AUTOSPORT-1975-12-18-Lada-1200-Kombi.pdf) | med |

## kit_vaz2103 — VAZ-2103

Running gear: `sv_vaz2103`. 1.45 L, 4.10 axle, 165/80 R13, servo.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 152 | Driver + passenger (stated) | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2103) via reality.ts | high |
| 0-100 passport | 17 | — | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2103) via reality.ts | high |
| top measured | 147.7 | Mean, MIRA; hot, dry, wind 0–10 mph; new car (~3500 mi); test mass 1179 kg (unladen 991); Kleber V12 165SR13 24/28 psi | [M76](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1976-Lada-1500.pdf) | high |
| 0-100 measured | 16.5 | Same test. 0-120 27.2 s | [M76](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1976-Lada-1500.pdf) | high |
| 0-80 measured | 9.9 | Same test | [M76](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1976-Lada-1500.pdf) | high |
| 0-60mph measured | 15.4 | Same test | [M76](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1976-Lada-1500.pdf) | high |
| 0-100 measured | 17.8 | Shifting at 6150–6200 rpm (~14 s revving to 7100); load not stated; given in the text, not a table | [KERMI73](https://www.veteranzsiguli.hu/wp-content/uploads/2020/05/AM_1973_08_21_4.jpg) | med |
| brake80 ceiling | 43.2 | Gross mass 1430 kg | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2103) via reality.ts | high |
| turn_circle passport | 11.2 | 2 × 5.6 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2103) via reality.ts | high |
| handling measured | understeer | "Understeers strongly but progressively"; grip "quite high in the dry"; brakes "unprogressive and over-servoed" | [M76](https://www.veteranzsiguli.hu/wp-content/uploads/2020/12/MOTOR-ROAD-TEST-1976-Lada-1500.pdf) | high |

## kit_vaz2104 — VAZ-2104 estate

Running gear: `sv_vaz2104`. 1.3, 4-speed, 4.3 axle, 165/80 R13.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 137 | Base 2104, 1.3 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2104) via reality.ts | high |
| 0-100 passport | 18.5 | — | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2104) via reality.ts | high |
| brake80 ceiling | 38 | Gross 1475 kg; figure from the 2105 table | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| brake100 measured | 49.4 | *Авторевю*, quoted second-hand on a forum; tyres, load and year unknown | [AR-ixbt](https://forum.ixbt.com/post.cgi?id=print%3A70%3A872) | low |
| top sibling | 138 | Riva 1500 Estate (21043, 1.45, 5-speed). Mean in 4th (5th OD: 128); MIRA, dry; test mass 1246 kg, kerb 1060 kg (F/R 52/48) | [AC86](https://www.flickr.com/photos/triggerscarstuff/3058241785) | high |
| 0-60mph sibling | 16.4 | 21043, same test | [AC86](https://www.flickr.com/photos/triggerscarstuff/3058241785) | high |
| brake_g_30mph sibling | 0.76 | 21043 at 80 lb pedal, in neutral; Bobruisk 165SR13 24/28 psi; servo, no ABS. Looks pedal-limited | [AC86](https://www.flickr.com/photos/triggerscarstuff/3058241785) | high |
| turn_circle passport | 11.2 | 2 × 5.6 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| turn_circle sibling | 11.2 | 21043 between kerbs, L = R 36 ft 9 in; 3.1 turns lock to lock | [AC86](https://www.flickr.com/photos/triggerscarstuff/3058241785) | high |
| coast50 floor | — | Not in the AO table | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2104) | — |

## kit_vaz2105 — VAZ-2105

Running gear: `sv_vaz2105`. 1.3, 4-speed, 4.3 axle, 165/80 R13 (or 175/70 R13).

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 145 | — | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| 0-100 passport | 18 | — | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| brake80 ceiling | 38 | Gross 1395 kg | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| coast50 floor | 500 | Factory catalogue minimum | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) | med |
| turn_circle passport | 11.2 | 2 × 5.6 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| axle_kerb passport | 545/450 | Kerb front/rear kg, 995 kg total | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) via reality.ts | high |
| 80-120_4th measured | 17.4 | 4-speed 1.3; conditions not printed. This is the test's only own measurement; its 0-100 and top speed are factory figures | [AP90](https://www.veteranzsiguli.hu/wp-content/uploads/2020/07/Szamara-2105_2109.pdf) | med |
| 0-60mph sibling | 14.3 | Riva 1500 GLS saloon (UK, 1.45); kerb 1057 kg; 165SR13; conditions not printed | [WC85](https://www.flickr.com/photos/triggerscarstuff/3032693338) | med |
| top sibling | 151 | Same car, 94 mph in 4th | [WC85](https://www.flickr.com/photos/triggerscarstuff/3032693338) | med |
| turn_circle sibling | 11.0 | Same car, 36.0 ft; type not stated | [WC85](https://www.flickr.com/photos/triggerscarstuff/3032693338) | med |
| handling sibling | understeer | CAR Jan 1985, Riva 1500: "an inveterate understeer but it corners tidily enough" | [CAR snippet](https://www.carmagazine.co.uk/features/car-culture/the-untouchables-skoda-vs-2cv-vs-reliant-vs-lada-car-archive-january-1985/) | low |

## kit_vaz2106 — VAZ-2106

Running gear: `sv_vaz2106`. 1.6, 4-speed, 165/80 R13, servo.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 150 | carexpert.ru prints 154 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2106) via reality.ts | high |
| 0-100 passport | 16 | — | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2106) via reality.ts | high |
| brake80 ceiling | 43.2 | Gross 1435 kg | [manual](http://welove2106.narod.ru/objie/ob_1.htm) via reality.ts | high |
| coast50 floor | 500 | Factory catalogue minimum | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2106) | med |
| turn_circle passport | 11.2 | 2 × 5.6 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2106) via reality.ts | high |
| top measured | 150.2 | True speed; car after a ~20,000 km road trial | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | high |
| 0-100 measured | 18.6 | Two persons aboard; average of several runs; 300 m to 100 km/h. 0-120 27.0, 0-140 46.6 | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | high |
| 0-80 measured | 10.4 | Same | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | high |
| brake82 measured | 41 | 82→0 km/h at 20 kp (196 N) pedal, mean 6.3 m/s² (0.64 g); Soviet 165-13 tubed radials; no ABS; load not stated | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | high |
| brake80 derived | 39.2 | The row above at 6.3 m/s², from 80 km/h | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | derived |
| brake80_front_only measured | 64.2 | Rear circuit off; 19 kp pedal; mean 4.03 m/s² | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | high |
| rolling_radius measured | 0.287 | Dynamic, m, 165-13 tyres | [KERMI78](https://www.veteranzsiguli.hu/korabeli-auto-motor-cikkek/1978-12-24/14560/) | high |
| top sibling | 149–151 | 21061 (2106 body, 1.5); one person aboard, 20–25 °C; the box does not say which of the two cars ran which speed | [A294](https://www.veteranzsiguli.hu/korabeli-ujsagcikkek-tesztek/a2-21061-21053-teszt/14641/) | med |
| 0-100 sibling | 17 | Same | [A294](https://www.veteranzsiguli.hu/korabeli-ujsagcikkek-tesztek/a2-21061-21053-teszt/14641/) | med |

## kit_vaz2107 — VAZ-2107

Running gear: `sv_vaz2107`. 1.5, 5-speed (0.82 OD), 165/80 R13, servo.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 150 | Driver + passenger | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2107) via reality.ts | high |
| 0-100 passport | 17 | — | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2107) via reality.ts | high |
| brake80 ceiling | 38 | Greatest load, gross 1430 kg | [manual](https://vazbook.ru/07/2107/main/manual/osnovnye-ekspluatacionnye-parametry-i-razmery) via reality.ts | high |
| coast50 floor | 500 | Factory catalogue minimum | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2107) | med |
| turn_circle passport | 11.2 | 2 × 5.6 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2107) via reality.ts | high |
| top sibling | 149–151 | 21053 (2105 body, same 1.5 5-speed drivetrain); one person, 20–25 °C | [A294](https://www.veteranzsiguli.hu/korabeli-ujsagcikkek-tesztek/a2-21061-21053-teszt/14641/) | med |
| 0-100 sibling | 17 | Same | [A294](https://www.veteranzsiguli.hu/korabeli-ujsagcikkek-tesztek/a2-21061-21053-teszt/14641/) | med |
| brake_g_30mph sibling | 0.76 | Riva 1500 Estate (21043, 5-speed); see kit_vaz2104 | [AC86](https://www.flickr.com/photos/triggerscarstuff/3058241785) | high |
| handling measured | — | ZR 2107-20 vs 21074, numbers not in the reprint. The carb car fell 11 km/h short of its claimed top speed; both "roll poorly" in coastdown; rear wheels locked before the fronts on a rolling-road brake test | [ZR reprint](https://vaz-2107.infocar.ua/test4888_2107_id307.html) | med |
| cx measured | 0.546 | *Авторевю* wind tunnel (Dmitrov); snippet | [AR snippet](https://autoreview.ru/articles/kak-eto-rabotaet/vaz-dinamika-aerodinamiki) | low |

## kit_vaz2108 — VAZ-2108 Sputnik

Running gear: `sv_vaz2108`. 1.3, 5-speed, 3.9 final drive, 165/70 R13, front-wheel drive.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 148 | Driver + passenger | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2108); [manual](https://vaz-sputnik.ru/2109/1-4.html) via reality.ts | high |
| 0-100 passport | 16 | Driver + passenger | same | high |
| brake80 ceiling | 38 | Gross 1370 kg | [ZRW](https://wiki.zr.ru/Технические_характеристики_автомобилей2108) via reality.ts | high |
| coast50 floor | 500 | Factory catalogue minimum | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2108) | high |
| turn_circle passport | 10.0 | 2 × 5.0 m by the outer wheel; 5.5 m "габаритный" (body-swept). reality.ts uses 5.2 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2108) | high |
| top measured | 145–151 | Mean 145 in 5th (OD), 151 in 4th. 1300 SL; test mass 1094 kg (kerb 923, F/R 62/38); Goodyear GT 165/70SR13 28/28 psi; damp, 12 °C, Millbrook | [AC87](https://www.flickr.com/photos/triggerscarstuff/albums/72157615677413212/) | high |
| 0-60mph measured | 14.0 | Same. 0-80 mph 30.0 s; standing ¼ mile 19.6 s | [AC87](https://www.flickr.com/photos/triggerscarstuff/albums/72157615677413212/) | high |
| 0-60mph measured | 13.6 | 1300 SL; method not printed | [CAR88](https://www.flickr.com/photos/triggerscarstuff/4475995541) | high |
| 0-100 measured | 15.5 | *Auto Bild* 1986 twin test vs Ibiza 1.2 (Ibiza 14.5); top 149 | [Auto Bild](https://www.autobild.de/klassik/artikel/lada-samara-1300-seat-ibiza-1-2-l-1227231.html) | med |
| 0-100 measured | 15.7 | Tuulilasi 10/1986, 1300, 940 kg; snippet | [AWfi](https://www.autowiki.fi/index.php/Lada_Samara) | low |
| 0-80 measured | 10.0 | Same Tuulilasi test; snippet | [AWfi](https://www.autowiki.fi/index.php/Lada_Samara) | low |
| brake_g_30mph measured | 0.90 | 60 lb pedal, in neutral, damp, no ABS. 0.77 g at 50 lb, 0.57 g at 40 lb; handbrake 0.30 g | [AC87](https://www.flickr.com/photos/triggerscarstuff/albums/72157615677413212/) | high |
| turn_circle measured | — | AC87 prints "between kerbs 5 m", which looks like a radius; 3.65 turns lock to lock | [AC87](https://www.flickr.com/photos/triggerscarstuff/albums/72157615677413212/) | med |
| skidpad_g sibling | 0.71 | Samara 1500 3-door (21083 carb, 74 hp SAE), 300 ft (91.4 m) skidpad; Goodyear Arriva M+S P175/70R13; curb 966 kg. The only measured lateral g for any car in this file | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |
| brake70mph sibling | 70.4 | Same car, 70→0 mph = 231 ft; no ABS; M+S tyres | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |
| brake100 sibling-derived | 55.5 | The 70-0 mph stop (6.95 m/s², 0.71 g) rescaled to 100 km/h | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | derived |
| top sibling | 143 | Same CD89 car, 89 mph | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |
| 0-60mph sibling | 13.8 | Same CD89 car | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |
| top sibling | 152.3 | 21083-20 1.5i, new stock car, UNECE R68; second-hand | [ZR02](http://autofaq.ru/articles/299/2369) | low |
| handling measured | understeer | ACM88 (5-door, same chassis): more understeer and roll than Western rivals; lift-off tightens the line; on a wet road a lift can break the rear, "not too abrupt". CD89: torque steer, inside rear wheel lifts | [ACM88](https://www.flickr.com/photos/triggerscarstuff/albums/72157617135250114/), [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |

## kit_vaz2109 — VAZ-2109 Samara

Running gear: `sv_vaz2109`. As the 2108, 5 doors, +15 kg.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 148 | Driver + passenger | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2109) via reality.ts | high |
| 0-100 passport | 16 | Driver + passenger | same | high |
| brake80 ceiling | 38 | Gross 1370 kg | [ZRW](https://wiki.zr.ru/Технические_характеристики_автомобилей2108) via reality.ts | high |
| coast50 floor | 500 | Factory catalogue minimum (2109 and 21093) | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2109) | med |
| turn_circle passport | 10.0 | 2 × 5.0 m, as the 2108 catalogue; reality.ts uses 5.2 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2108) | high |
| top measured | 143–150 | Mean 143 in 5th, 150 in 4th. 1300L; test mass 1097 kg (kerb 933, F/R 62/38); 165/70SR13; damp, 10 °C, Millbrook | [ACM88](https://www.flickr.com/photos/triggerscarstuff/albums/72157617135250114/) | high |
| 0-60mph measured | 13.4 | Same. Standing ¼ mile 19.5 s | [ACM88](https://www.flickr.com/photos/triggerscarstuff/albums/72157617135250114/) | high |
| 0-100 measured | 14.5 | *Auto Hebdo* 266 (1990, Spain), 1.3 S 5-door, 165/70R13, 900 kg; top 152 per the table | [Auto Hebdo](https://www.pieldetoro.net/web/pruebas/ver.php?ID=704.30) | med |
| top measured | 152 | Same | [Auto Hebdo](https://www.pieldetoro.net/web/pruebas/ver.php?ID=704.30) | med |
| brake100 measured | 44.7 | *Авторевю*, quoted second-hand; year, tyres and engine not given | [AR-ixbt](https://forum.ixbt.com/post.cgi?id=print%3A70%3A872) | low |
| brake_g_30mph measured | 0.80 | 50 lb pedal, damp. The test car had air in its hydraulics (stated) | [ACM88](https://www.flickr.com/photos/triggerscarstuff/albums/72157617135250114/) | high (faulty car) |
| brake_valve passport | 3.0 / 3.7–4.5 | Rear regulator bench check: cut-in set to 3.0 ± 0.1 MPa; 8 MPa in → 3.7–4.5 MPa out (slope ≈ 0.22); checked over 3–10 MPa in. Load-sensing lever on the rear arm, adjusted at kerb | [manual](https://autoruk.ru/vaz-2108-2170/regulyator-davleniya-tormozov-vaz-2109) | high |
| skidpad_g sibling | 0.71 | CD89 Samara 1500 3-door; see kit_vaz2108 | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |
| handling measured | understeer | Slight understeer, corrected with throttle; heavy roll lifts the inside rear wheel | [Auto Hebdo](https://www.pieldetoro.net/web/pruebas/ver.php?ID=704.30) | med |

## kit_vaz21099 — VAZ-21099

Running gear: `sv_vaz21099`. 1.5 carb, 5-speed, 165/70 R13.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 154 | Driver + passenger | [manual](https://vaz-sputnik.ru/21099/1.html) via reality.ts | high |
| 0-100 passport | 13.5 | Driver + passenger | same | high |
| brake80 ceiling | 38 | Gross 1395 kg | [ZRW](https://wiki.zr.ru/Технические_характеристики_автомобилей2108) via reality.ts | high |
| coast50 floor | 500 | The AO 21099 page reprints the 2109/21093 table | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-21099) | med |
| turn_circle passport | 10.4 | 2 × 5.2 m | [manual](https://vaz-sputnik.ru/21099/1.html) via reality.ts | high |
| 0-100 sibling | 13.9 | Tekniikan Maailma 13/1989, Samara 1.5, 55 kW, 960 kg, body not stated; 0-80 8.9; snippet | [AWfi](https://www.autowiki.fi/index.php/Lada_Samara) | low |
| 0-80 sibling | 8.9 | Same | [AWfi](https://www.autowiki.fi/index.php/Lada_Samara) | low |
| 0-100 sibling | 14.9 | Tuulilasi 6/1990, Samara 1500 Kat, 950 kg; snippet | [AWfi](https://www.autowiki.fi/index.php/Lada_Samara) | low |
| top sibling | 145.3 | 21093 (same 1.5 carb and gearbox, hatch); new stock car, R68; second-hand | [ZR02](http://autofaq.ru/articles/299/2369) | low |
| skidpad_g sibling | 0.71 | CD89 Samara 1500 3-door (same engine); see kit_vaz2108 | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | high |
| brake100 sibling-derived | 55.5 | CD89 70-0 mph rescaled | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) | derived |
| 0-60mph sibling | 13.8–15.0 | CD89 1500 13.8; CAR94 1.5GL 3-door 15.0 (top 148–149) | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/), [CAR94](https://www.flickr.com/photos/triggerscarstuff/albums/72157629535623725/) | high |

## kit_vaz2115 — VAZ-2115 Samara

Running gear: `sv_vaz21099` body with `GEAR_VAZ_2115` (2115 1.5i, 2111 injection engine).

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 158 | ladaonline. drom.ru prints 155 | [LO](https://ladaonline.ru/catalog/index.php?SECTION_ID=358&ELEMENT_ID=12598) via reality.ts; [drom](https://www.drom.ru/catalog/lada/2115/77754/) | high |
| 0-100 passport | 13.2 | ladaonline / carexpert. drom.ru prints 14 | same; [CE](https://carexpert.ru/models/vaz/2115/tech/vaz15s.htm) | high |
| brake80 ceiling | 38 | "Груженого" (laden); gross 1410 kg | [LO](https://ladaonline.ru/catalog/index.php?SECTION_ID=358&ELEMENT_ID=12598) via reality.ts | high |
| turn_circle passport | 10.4 | 2 × 5.2 m | same | high |
| top sibling | 152.3 | 21083-20 (the same 1.5i in the 2108 body); R68; second-hand | [ZR02](http://autofaq.ru/articles/299/2369) | low |
| top sibling | 144.7 | 2115-01 carburettor 1.5 (right body, wrong engine); second-hand | [ZR02](http://autofaq.ru/articles/299/2369) | low |
| handling measured | roll | ZR (UA): longest stop in its group (no numbers printed), heavy roll, inside rear wheel lifts | [ZR UA](https://zaz-sens.infocar.ua/test7048_sens_id707.html) | med |

## kit_vaz2110 — VAZ-2110

Running gear: `sv_vaz21099` body with `GEAR_VAZ_21102` (21102, 1.5i 8v, 175/70 R13).

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 167 | Driver + passenger | [M110](https://autoprospect.ru/vaz/2110-zhiguli/1-obshhie-svedeniya.html) via reality.ts | high |
| 0-100 passport | 14 | Driver + passenger | same | high |
| brake80 ceiling | 38 | Gross 1480 kg | same | high |
| turn_circle passport | 10.4 | 2 × 5.2 m | same | high |
| brake100 measured | 55.0 | 21102 on standard 13-inch wheels, no ABS, Dmitrov; load and stops not printed (0.71 g mean) | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |
| brake100 measured | 57.4 | AR's own historic 2110, no ABS; year, engine and tyres not stated | [AR22](https://autoreview.ru/articles/kak-eto-rabotaet/espasi-i-absohrani) | med |
| top measured | 169.5 | 21102, Dmitrov | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |
| 60-100_4th measured | 14.4 | 21102 (21103: 14.2) | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |
| brake100 sibling | 56.5 | 21103 16v, 14-inch wheels, same session | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |
| brake_fade sibling | — | Repost of a ZR test: 2108 / 2110 / 2112 front brakes all met ≤ 38 m from 80 at 6.8–6.9 m/s² warm, pedal ≤ 50 kgf. Unvented 2108 brakes failed on cycle 7 (> 41 m), 2110 on cycle 14, 2112 on cycle 26; snippet | [drive2](https://www.drive2.ru/b/1946876/) | low |

## kit_vaz2111 — VAZ-2111 estate

Running gear: `sv_vaz21099` body with `GEAR_VAZ_2111` (1.5i 8v).

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 162 | Kerb 1040, payload 500 | [M110](https://autoprospect.ru/vaz/2110-zhiguli/1-obshhie-svedeniya.html) via reality.ts | high |
| 0-100 passport | 14 | — | same | high |
| brake80 ceiling | 38 | Gross 1540 kg | same | high |
| turn_circle passport | 10.4 | 2 × 5.2 m | same | high |
| top measured | 159.5 | 2111 1.5 8v (the exact engine), new stock car, R68 (claimed 165); second-hand | [ZR02](http://autofaq.ru/articles/299/2369) | low |
| 0-100 sibling | 12.0 | Tekniikan Maailma 18/2005, Lada 110 STW 1.6 16V, 66 kW, 1100 kg; snippet | [AWfi](https://www.autowiki.fi/index.php/Lada_110) | low |
| brake100 sibling | 55.0 | 21102 saloon, same brakes and wheels | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |

## kit_vaz2112 — VAZ-2112

Running gear: `sv_vaz21099` body with `GEAR_VAZ_21122` (1.5i 8v).

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 167 | — | [M110](https://autoprospect.ru/vaz/2110-zhiguli/1-obshhie-svedeniya.html) via reality.ts | high |
| 0-100 passport | 14 | — | same | high |
| brake80 ceiling | 38 | Gross 1495 kg | same | high |
| turn_circle passport | 10.4 | 2 × 5.2 m | same | high |
| top sibling | 179.8 | 2112 1.5 16v (66 kW), R68; second-hand | [ZR02](http://autofaq.ru/articles/299/2369) | low |
| top sibling | 169.5 | 21102 saloon, same 8v engine | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |
| brake100 sibling | 55.0 | 21102 saloon, same brakes and wheels | [ZR04](https://www.zr.ru/content/articles/10785-kak_popast_v_desatku/) | high |

## kit_vaz2121 — VAZ-2121 Niva

Running gear: `sv_niva`. 1.6, 4-speed, permanent 4x4, 175/80 R16 (or 6.95-16 cross-ply).

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 132 | Driver + passenger | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2121); [lada-niva](https://lada-niva.ru/niva/soobschenie-s-harakteristikami.html) via reality.ts | high |
| 0-100 passport | 23 | Driver + passenger | same | high |
| brake80 ceiling | 40 | Gross 1550 kg | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2121) via reality.ts | high |
| turn_circle passport | 11.0 | 2 × 5.5 m by the outer wheel; 5.8 m "габаритный" | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2121) | high |
| top measured | 126 | Mean in 4th (130 best; 5th OD 119). Cossack Cabrio 1.6 5-speed, 185SR15 Michelin snow tyres, test mass 1217 kg; damp, 6 °C, Millbrook | [AC87N](https://www.flickr.com/photos/triggerscarstuff/albums/72157611289350006/) | high |
| 0-60mph measured | 18.9 | Same. Standing ¼ mile 21.1 s | [AC87N](https://www.flickr.com/photos/triggerscarstuff/albums/72157611289350006/) | high |
| brake_g_30mph measured | 0.98 | 65 lb pedal, 9.4 m, damp, in neutral, no ABS. 0.90 g at 60 lb, 0.70 g at 50 lb; handbrake 0.34 g | [AC87N](https://www.flickr.com/photos/triggerscarstuff/albums/72157611289350006/) | high |
| brake_fade measured | 40→160 lb | 10 stops at 0.5 g from 62 mph; pedal 40–45 lb on stop 1, up to 80–160 lb on stop 8 | [AC87N](https://www.flickr.com/photos/triggerscarstuff/albums/72157611289350006/) | high |
| turn_circle measured | 10.8–11.0 | Between kerbs, R/L, on 185SR15; 3.3 turns lock to lock | [AC87N](https://www.flickr.com/photos/triggerscarstuff/albums/72157611289350006/) | high |
| 0-100 measured | 21.2–21.9 | Tuulilasi 4/1978 21.2; Tekniikan Maailma 2/1979 21.9 (57.5 kW, 1225 kg); snippet | [AWfi](https://www.autowiki.fi/index.php/Lada_4x4) | low |
| 0-80 measured | 12.5–13.4 | Same two tests | [AWfi](https://www.autowiki.fi/index.php/Lada_4x4) | low |
| top measured | 130–139 | Tuulilasi 130; TM 139 | [AWfi](https://www.autowiki.fi/index.php/Lada_4x4) | low |
| top measured | 131 | Polish *Motor* 35/1978, 4-speed, 6.95-16; "about 131"; timing not stated | [Motor PL](https://magazynauto.pl/wiadomosci/lada-niva-waz-2121-niwa-badanie-drogowe-motor-nr-35-1978,aid,4357) | med |
| turn_circle measured | 11.6 | Same; method not stated | [Motor PL](https://magazynauto.pl/wiadomosci/lada-niva-waz-2121-niwa-badanie-drogowe-motor-nr-35-1978,aid,4357) | med |
| brake100 sibling | 49.7 | 21214 1.7i: mean of 10 stops, half payload, Dunlop Grand Trek 215/65R16, no ABS | [ADAC11](https://assets.adac.de/image/upload/Autodatenbank/Autotest/AT4692_Lada_Niva_1_7i_Exclusiv/Lada_Niva_1_7i_Exclusiv.pdf) | high |
| brake100 sibling | 50.5–52.0 | 1.7i, warm 50.5 / cold 52.0; 185/75R16; no ABS | [AB02](https://www.autobild.de/artikel/unterwegs-mit-dem-lada-niva-35815.html) | high |
| brake100 sibling | 58.8 | 1.7i, 175/80-16 (asphalt or M+S unknown); method and load not stated. 80-0 42.0, 60-0 25.4, 120-0 71.7 | [PB00](https://importados.testdelayer.com.ar/test/lada-niva.htm) | med |
| brake80 sibling | 42.0 | Same | [PB00](https://importados.testdelayer.com.ar/test/lada-niva.htm) | med |
| 0-100 sibling | 16.3–20.7 | 1.7i: ADAC 19.0 (maybe the maker's), AB02 16.3 (outlier), PB00 20.7, drom.ru 19.2 (studded tyres, winter) | [ADAC11](https://assets.adac.de/image/upload/Autodatenbank/Autotest/AT4692_Lada_Niva_1_7i_Exclusiv/Lada_Niva_1_7i_Exclusiv.pdf), [AB02](https://www.autobild.de/artikel/unterwegs-mit-dem-lada-niva-35815.html), [PB00](https://importados.testdelayer.com.ar/test/lada-niva.htm), [drom](https://www.drom.ru/info/test-drive/lada-4x4-urban-renault-duster-38708.html) | med |
| 0-80 sibling | 11.6 | 1.7i (the text says 11.2) | [PB00](https://importados.testdelayer.com.ar/test/lada-niva.htm) | med |
| turn_circle sibling | 10.35–10.5 | 1.7i, 215/65R16, R/L | [ADAC11](https://assets.adac.de/image/upload/Autodatenbank/Autotest/AT4692_Lada_Niva_1_7i_Exclusiv/Lada_Niva_1_7i_Exclusiv.pdf) | high |
| dlc sibling | — | ADAC refused its 90 km/h evasive test: "tipping of the vehicle is likely"; heavy body movements | [ADAC11](https://assets.adac.de/image/upload/Autodatenbank/Autotest/AT4692_Lada_Niva_1_7i_Exclusiv/Lada_Niva_1_7i_Exclusiv.pdf) | high |
| handling measured | understeer | 1978, road tyres: neutral, slides at both ends (Motor PL); "mild, secure understeer", strong on snow on cross-plies (CAR 1979). 1.7i on modern tyres: front breaks away abruptly, lift-off sensitive (ADAC11) | [Motor PL](https://magazynauto.pl/wiadomosci/lada-niva-waz-2121-niwa-badanie-drogowe-motor-nr-35-1978,aid,4357), [CAR79](https://www.flickr.com/photos/triggerscarstuff/albums/72157629100098935/), [ADAC11](https://assets.adac.de/image/upload/Autodatenbank/Autotest/AT4692_Lada_Niva_1_7i_Exclusiv/Lada_Niva_1_7i_Exclusiv.pdf) | high |

## kit_vaz2131 — VAZ-2131 Niva

Running gear: `sv_niva_long`. 1.7, 5-speed, 175/80 R16.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 132 | 2131 1.7 carb (1.8: 135) | [niva-faq](https://www.niva-faq.msk.ru/tehnika/obsch/tehdann/213_312.htm) via reality.ts | high |
| 0-100 passport | 25 | 2131 1.7 carb (1.8: 22) | same | high |
| brake80 ceiling | 40 | Gross 1870 kg, from the 2121x family table | same | high |
| turn_circle passport | 12.6 | 2 × 6.3 m by the outer wheel | same | high |
| 0-100 sibling | 19.8 | 2131 body with the 1.7i (21214 distributed injection); the game car is the 1.7 carb. New, ~500 km; Dmitrov measuring complex; VLI-10 tyres | [ZR03](https://www.zr.ru/content/articles/9819-sto_kubikov_-_lishnije/) | high |
| 0-100 sibling | 26.3 | 2131 1.8 carb (VAZ-2130 engine), carburettor out of adjustment (tested as delivered on purpose) | [ZR03](https://www.zr.ru/content/articles/9819-sto_kubikov_-_lishnije/) | high (badly adjusted car) |
| kerb_mass measured | 1320 | Both cars weighed ~30 kg under the passport 1350 | [ZR03](https://www.zr.ru/content/articles/9819-sto_kubikov_-_lishnije/) | high |
| 0-100 sibling | 19.0 | Lada 4x4 Urban 5-door 1.7i; snippet | [drom](https://www.drom.ru/info/test-drive/lada-4x4-urban-5-door-suzuki-jimny-49428.html?page=5) | low |
| handling measured | — | Better straight-line stability than the 3-door; "slow and lazy" responses; turning circle "like a minibus" | [ZR retro](https://www.zr.ru/content/articles/906908-retro-test-pyatidvernoj-lady-4kh/) | high |

## kit_vaz1111 — VAZ-1111 Oka

Running gear: `cf_vaz1111`. 0.65 L 2-cylinder, 4-speed, 135/80 R12.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 120 | Driver + passenger | [manual](https://autoprospect.ru/vaz/1111-oka/1-4-tekhnicheskie-kharakteristiki.html) via reality.ts | high |
| 0-100 passport | 30 | Driver + passenger | same | high |
| brake80 ceiling | 38 | Gross 975 kg | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-1111) via reality.ts | high |
| coast50 floor | 500 | 1998 catalogue; load not stated | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-1111) | high |
| turn_circle passport | 9.2–9.6 | 2 × 4.6 m (1998 catalogue) vs 2 × 4.8 m (manual, used by reality.ts); the sources disagree | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-1111), [manual](https://autoprospect.ru/vaz/1111-oka/1-4-tekhnicheskie-kharakteristiki.html) | high |
| axle_kerb passport | 395/240 | Kerb front/rear kg (62/38 %) | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-1111) | high |
| 0-100 sibling | 16 | SeAZ-11116 (1.0 FAW, 53 hp, same body); "real top speed only just over 120"; AR 8/2007 quoted second-hand | [repost](https://uldwriancir.ucoz.ru/news/seaz_11116_oka/2014-02-14-286) | low |
| handling measured | understeer | AR (11113): at the limit "hopelessly sliding on its front wheels"; strong understeer, stable at speed. Brakes "inadequate"; the car can spin under full braking | [AR reprint](https://www.infocar.ua/test-drive/vaz/11113-oka/1921_.html), [AR reprint 2](https://www.infocar.ua/test-drive/vaz/11113-oka/1920_.html) | med |
| brakes measured | weak | ZR 2005: long pedal, "weak and vague brakes" | [ZR05](https://www.zr.ru/content/articles/11849-test_oka-ledi_-_daewoo_matiz_dve_po_nol_vosem/) | high |

## kit_gaz24 — GAZ-24 Volga

Running gear: `sv_gaz24`. 2.45 L ZMZ-24D, 4-speed, 7.35-14 cross-ply, all-drum brakes with a hydrovac.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 145 | No factory 0-100 | [manual](http://long-vehicle.narod.ru/gaz24/book24/24_tech.htm) via reality.ts | high |
| brake80 ceiling | 43.2 | Gross 1820 kg; the GAZ-24-10's figure (none found for the 1970 car) | [AO](https://www.autoopt.ru/auto/encyclopedia/car/gaz/mark/gaz-24-10) via reality.ts | med |
| turn_circle passport | 11.0 | 2 × 5.5 m | [manual](http://long-vehicle.narod.ru/gaz24/book24/24_tech.htm) via reality.ts | high |
| 0-100 measured | 23.5 | AR retrotest of a 1976 car on its original ИД-195 cross-plies; who measured it and how is not stated | [AR16V](https://autoreview.ru/articles/retrotest/gazgolder) | med |
| turn_circle measured | 12–12.6 | autowiki.fi 12.6 (no source); an owner review says 12; snippets | [AWfi](https://www.autowiki.fi/index.php/GAZ-24_Volga), [autoplenum](https://www.autoplenum.at/auto/gaz/24-wolga/limousine-1967/2-45-100-ps) | low |
| coast50 sibling | 500 | GAZ-24-10 saloon floor (530 m for the 24-12 estate); snippet | [AO](https://www.autoopt.ru/auto/encyclopedia/car/gaz/mark/gaz-24-10) | low |
| 0-100 sibling | 37.7 | Volga 24-2 Diesel (Indenor 2.1, 48 kW, 1525 kg), Tekniikan Maailma 3/1977, winter; 0-80 20.8; snippet | [AWfi](https://www.autowiki.fi/index.php/GAZ-24_Volga) | low |
| handling measured | dead band | On cross-plies the car ignores steering inputs under about 90°, then rolls heavily and the rear steps out sharply; slides are smooth. Caster set to 0° (wanders); 5.2 turns lock to lock. Hydrovac lags 1–2 s, then bites hard | [AR16V](https://autoreview.ru/articles/retrotest/gazgolder) | med |
| handling measured | — | ZR retrotest, first-series car: delayed response from linkage slack, large roll, drum brakes "not effective" | [ZR retro](https://www.zr.ru/content/articles/919666-retro-test-gaz-24-volga-ran/?page=2) | med |

## kit_gaz31029 — GAZ-31029 Volga

Running gear: `cf_gaz31029`. ZMZ-402, 4-speed, 205/70 R14 radial.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 145–150 | ru.wikipedia 145; avto-russia 150 | [wiki](https://ru.wikipedia.org/wiki/ГАЗ-31029), avto-russia via reality.ts | med |
| brake80 ceiling | 43.2 | The GAZ-24-10 ceiling (same chassis and brakes) | [AO](https://www.autoopt.ru/auto/encyclopedia/car/gaz/mark/gaz-24-10) via reality.ts | med |
| turn_circle passport | 11.2 | 2 × 5.6 m | [drom](https://www.drom.ru/catalog/gaz/31029_volga/83566/) via reality.ts | med |
| 0-100 passport | 19.5–20 | Wiki "20 s (ZMZ-402.10)", untraceable; kvata.ru 19.5 from an engine book. Not measured | [wiki](https://ru.wikipedia.org/wiki/ГАЗ-31029), [kvata](https://kvata.ru/remont-i-tyuning/gaz-31029.html) | low |
| brake_hw passport | — | Front drums on early cars; front discs standard from 1996; snippet | [kolesa](https://www.kolesa.ru/test-drive/to-li-buyvol-to-li-byk-to-li-tur-test-drayv-gaz-31029) | low |
| handling measured | wander | ZR long-term car: hard to hold straight even after box, toe and camber adjustment (by then on a ZMZ-4062) | [ZR97](https://www.zr.ru/content/articles/8815-volga_gaz-31029/) | high |

## kit_azlk2141 — AZLK-2141 Moskvich

Running gear: `sa_azlk2141`. The 2141-01 with the VAZ-2106 1.6 (76 hp), 5-speed, front-wheel drive.

| figure | value | conditions | source | confidence |
|---|---|---|---|---|
| top passport | 158 | 2141-01 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/moskvich/mark/moskvich-2141); [AP](https://autoprospect.ru/azlk/2141-moskvich/1-2-tekhnicheskie-dannye-i-kharakteristiki-avtomobilejj-moskvich.html) via reality.ts | high |
| 0-100 passport | 14.9 | — | same | high |
| brake80 ceiling | 43.2 | Gross 1455 kg | [AO](https://www.autoopt.ru/auto/encyclopedia/car/moskvich/mark/moskvich-2141) via reality.ts | high |
| coast50 floor | 550 | 2141-01 and 21412-01 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/moskvich/mark/moskvich-2141) | med |
| turn_circle passport | 10.0 | 2 × 5.0 m | [AO](https://www.autoopt.ru/auto/encyclopedia/car/moskvich/mark/moskvich-2141) via reality.ts | high |
| 0-100 measured | 17.5 | 2141 with the VAZ 1.6 (76 hp); proving-ground dynamometric road with professional equipment (Croma 2.0: 12.0) | [AR92](https://autoreview.ru/special/thirty-years/167367) | med-high |
| brake80 measured | 40 | Same test, no ABS (Croma with ABS: 31.2 m); load and stops not stated | [AR92](https://autoreview.ru/special/thirty-years/167367) | med-high |
| dlc measured | — | Lane-change ("смена полосы движения") limit 5.3 km/h below the Fiat Croma's; absolute value not published | [AR92](https://autoreview.ru/special/thirty-years/167367) | med |
| 0-100 sibling | 18.65 | 21412 (UZAM 1.5), AR 21/1995 | [AR95](https://autoreview.ru/special/thirty-years/167354) | high |
| 0-100 measured | 15.2 | 2141 with the "80 hp VAZ engine"; ZR measurement quoted by kolesa.ru; load not stated. Also 21412: 17.8 | [kolesa](https://www.kolesa.ru/article/tridtsatiletnie-daunshiftery-dlya-novykh-vremen-sravnivaem-vaz-2109-i-azlk-2141) | low-med |
| brake80 measured | 35–37 | Same article; unattributed; credits Ми-180 / БЛ-85 tyres | [kolesa](https://www.kolesa.ru/article/tridtsatiletnie-daunshiftery-dlya-novykh-vremen-sravnivaem-vaz-2109-i-azlk-2141) | low |
| brake_valve passport | 2 | Rear regulator: "передаточное число регулятора без пружины 2" (slope 0.5 past the knee); load rod on the rear axle; no cut-in pressure printed | [RK](http://www.remkomplekt.org/moskvich-2141/tormoznoe-upravlenie.html) | high |
| cx measured | 0.47 | AR wind tunnel, AR 9/1998 (factory claim 0.35) | [AR16M](https://autoreview.ru/articles/retrotest/audi-80-vtorogo-pokoleniya-protiv-vaz-2109-i-azlk-2141-mashiny-odnogo-urovnya-videobonus) | high |
| steering passport | 4.6 | Turns lock to lock (2109: 3.5) | [kolesa](https://www.kolesa.ru/article/tridtsatiletnie-daunshiftery-dlya-novykh-vremen-sravnivaem-vaz-2109-i-azlk-2141) | med |
| handling measured | — | Handling a "victim of comfort", less lively than the 2108; very stable on the motorway, no torque steer (equal driveshafts) | [ZR25](https://www.zr.ru/content/articles/975449-rannyaya-ptashka/?page=2) | high |

---

## Tyres

### Fitments and pressures (factory)

| car | tyre | pressure F/R kgf/cm² | source | confidence |
|---|---|---|---|---|
| VAZ-2105 | 165/80R13 (165R13) or 175/70R13 | 1.6/1.9 (165/80R13); 1.7/2.0 (175/70R13) | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2105) | med |
| VAZ-2106 | 165R13 or 175/70R13 | 1.6/1.9; 1.7/2.0 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2106) | med |
| VAZ-2121 | 175/80R16 ВлИ-10, or 6.95-16 cross-ply | 2.1/1.9; 1.8/1.7 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/vaz/mark/vaz-2121) | med |
| Moskvich-412 / ИЖ-21251 | 165/80R13 or 6.45-13 (165-13), МИ-166 / Я-370 / М-145 | 1.7/2.0 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/moskvich/mark/moskvich-412) | med |
| GAZ-24-10 | 205/70R14 ИД-220 radial | 2.0 | [AO](https://www.autoopt.ru/auto/encyclopedia/car/gaz/mark/gaz-24-10) | med |
| VAZ-2101 | 155-13 (6.15-13) И-151, load index 75 (387 kg); snippet | — | [r17](http://www.r17.com.ua/?details=Kama-I-151-155-82-13-75-P) | low |
| Road tests | SP4 155SR13 27/28 psi (M74); Kleber V12 165SR13 24/28 (M76); Bobruisk 165SR13 24/28 (AC86); Goodyear GT 165/70SR13 28/28 (AC87); Goodyear Arriva M+S P175/70R13 (CD89) | as listed | per test above | high |

### Tyre parameters

No cornering stiffness, relaxation length or self-aligning torque was found for any specific period Soviet tyre. Everything here except the first two rows is generic, and labelled so.

| tyre | parameter | value | conditions | source | confidence |
|---|---|---|---|---|---|
| И-151 155-13 (cross-ply, VAZ-2101 era) | cornering stiffness | 48.6 | Printed as "Н/град", nominal load and pressure (textbook table 7.1). That unit gives 2.8 kN/rad, below the text's own range; read as kgf/deg it is 27.3 kN/rad. Unit unresolved; snippet | [lecture.center](https://libr.lecture.center/logistika/vliyanie-bokovogo-uvoda-ustoychivost-37316.html) | low |
| М-61 5.20-13 (cross-ply) | cornering stiffness | 40.0 | Same table, same unit caveat | same | low |
| Generic passenger tyre | cornering stiffness per wheel | 15–40 kN/rad | Linear to 4–6° slip; falls with lower pressure | [Tyumen lectures §10.3](https://studfile.net/preview/9967274/page:34/) | med |
| Generic passenger tyre | cornering stiffness per wheel | 30–60 kN/rad | Course-design method; the lower-pressure tyre takes 2–4 kN/rad less | [NovSU](https://studfile.net/preview/2548079/page:7/) | med |
| Generic | cornering coefficient Cα/Fz | ≈0.2 /deg | At 100 % rated load | [Vorotović 2013](https://www.mas.bg.ac.rs/_media/istrazivanje/fme/vol41/1/08_gvorotovic.pdf) | med |
| Bias vs radial (generic) | cornering coefficient | 0.12 /deg bias; 0.16 /deg radial | Dixon 1996, cited by Vorotović | same | med |
| Generic | cornering stiffness | ≈867 N/deg | Gillespie 1992, cited by Vorotović | same | med |
| Bias (generic) | cornering / camber stiffness | 5–6 | Milliken, cited by Vorotović | same | med |
| Generic | slip angle at peak Fy | ≈18° (Wong); nonlinear from 6–12° (Soviet lecture) | — | [Wong ch.1](https://isy.gitlab-pages.liu.se/fs/en/courses/TSFS02/Lectures/WongChapter1.pdf), [lecture](https://studfile.net/preview/9967274/page:34/) | med |
| 175/70R14 (modern, nearest size) | peak lateral μ / critical slip | 1.04 / 12.3–13.1° | Drum stand, Fz 3.4 kN, 200 kPa, 22.2 m/s | [Sharshukov & Kapralov 2014](https://cyberleninka.ru/article/n/metodika-opredeleniya-harakteristik-bokovogo-stsepleniya-shiny-i-raschet-ih-otsenochnyh-parametrov-poluchennyh-v-stendovyh-usloviyah) | high (modern tyre) |
| 9 modern 14–16" radials | load sensitivity of μy | −50 % load: +8.2 %; +50 % load: −5.2 %; ±30 % pressure: ±1.5 %; mean critical slip 11.6° | Stand, 60 km/h, GOST 4754-97 nominal load | [cyberleninka](https://cyberleninka.ru/article/n/vliyanie-dinamicheskih-faktorov-na-harakteristiki-bokovogo-stsepleniya-shin-v-stendovyh-usloviyah) | high (modern) |
| Bias vs radial (generic) | dry peak/sliding μ | no significant difference | 64 km/h, dry asphalt | [Wong p.28](https://isy.gitlab-pages.liu.se/fs/en/courses/TSFS02/Lectures/WongChapter1.pdf) | high |
| Generic | peak / sliding μ | dry asphalt 0.8–0.9 / 0.75; wet 0.5–0.7 / 0.45–0.6; gravel 0.6 / 0.55; packed snow 0.2 / 0.15; ice 0.1 / 0.07 | Wong table 1.2 | [Wong p.29](https://isy.gitlab-pages.liu.se/fs/en/courses/TSFS02/Lectures/WongChapter1.pdf) | high |
| Test surface (GOST) | φ | dry 0.75 ± 0.05; wet 0.3–0.6 | Definition of the handling-test surface | [GOST 31507-2012 §5.2.7](https://files.stroyinf.ru/Data2/1/4293784/4293784416.pdf) | high |
| Radial (generic) | rolling resistance f(V) | 0.0136 + 0.40·10⁻⁷·V² | V in km/h; rated load and pressure | [Wong eq.1.1](https://isy.gitlab-pages.liu.se/fs/en/courses/TSFS02/Lectures/WongChapter1.pdf) | high |
| Bias (generic) | rolling resistance f(V) | 0.0169 + 0.19·10⁻⁶·V² | Same | [Wong eq.1.2](https://isy.gitlab-pages.liu.se/fs/en/courses/TSFS02/Lectures/WongChapter1.pdf) | high |
| Generic | f average | 0.013 asphalt; 0.02 rolled gravel; 0.05 unpaved | Bosch, via Wong table 1.1 | same | high |
| Generic (Russian) | f₀ | 0.014–0.018 asphalt; above 50 km/h f = f₀(1 + V²/20000) | Handbook | [mazbook](https://www.mazbook.ru/article/guide/explore/deystvuyuschie-na-avtomobil-sily) | low-med |
| Generic | relaxation length | 0.12–0.45 m; ≈0.3 m at 2 kN rising to 0.8 m at 7 kN; snippets | — | [wiki](https://en.wikipedia.org/wiki/Relaxation_length), [ScienceDirect](https://www.sciencedirect.com/topics/engineering/magic-formula) | low |

## Test methods behind the figures

| standard | defines | key conditions | source |
|---|---|---|---|
| ГОСТ 22895-77 | Type-approval brakes (the `brake80 ceiling` rows) | M1 test "ноль" (cold, < 100 °C): 80 km/h, pedal ≤ 50 kgf, S ≤ 43.2 m, j ≥ 7.0 m/s². Formula S = 0.10·v + v²/(26·j). Must stay inside a 3.5 m corridor. Hot test I: ≤ 52.1 m. Read from an OCR scan | [stroyinf](https://files.stroyinf.ru/Data2/1/4294831/4294831075.pdf) |
| Later VAZ manuals, "38 m" | Same 80 km/h ceiling at gross mass | Equivalent to ≈ 7.7 m/s² by the formula above [INFERENCE] | per-car rows |
| ГОСТ 25478-91 | In-service brake check | M1 built after 1981: 40 km/h, ≤ 12.9 m at gross mass (12.2 m kerb + 2), j ≥ 6.8 m/s², pedal ≤ 490 N | [meganorm](https://meganorm.ru/Data2/1/4294828/4294828964.pdf) |
| UN R13-H | Modern M1 brakes | 100 km/h, s ≤ 0.1v + 0.0060v² (70 m), MFDD ≥ 6.43 m/s²; brakes 65–100 °C; laden and unladen | [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A42023X0401) |
| ГОСТ 22576-90 (≈ UN R68) | 0-100, top speed | Load half payload but ≥ 180 kg; run-in ≥ 3000 km; coastdown from 50 km/h checked against the НТД before testing; wind ≤ 3 m/s; top speed ≥ 3 runs each way; acceleration result = mean of 4 runs | [meganorm](https://meganorm.ru/Data2/1/4294831/4294831321.htm) |
| ГОСТ 20306-90 | Fuel tests; coastdown use | Coastdown from 50 km/h passes if ≥ the НТД value (hence `coast50 floor`); dyno road load from 60→40 km/h coastdown | [meganorm](https://meganorm.ru/Data2/1/4294833/4294833035.htm) |
| ГОСТ 31507-2012 (successor to ОСТ 37.001.471-88) | Handling: "переставка" (lane change), "поворот" (turn), "рывок руля" (steering step) | Gross mass, dry φ 0.75. Переставка S = 20 m: norm 83 km/h for M1 (off-road M1 74). Turn R = 35 m: 72 km/h (off-road 67). Engines ≤ 1200 cm³: norms −5 %. Yaw overshoot ≤ 30 % at 2 m/s². Its steering-angle band reads as an understeer gradient of ≈ 1.1–7.3 deg/g [INFERENCE] | [stroyinf](https://files.stroyinf.ru/Data2/1/4293784/4293784416.pdf) |
| ISO 3888-1 | Double lane change | 125 m track; 3.5 m offset; lane widths 1.1–1.3·w + 0.25 | [ISO sample](https://cdn.standards.iteh.ai/samples/67973/daa839ed4aca420788d9b4a51cd6cc95/ISO-3888-1-2018.pdf) |
| ISO 3888-2 | Moose test | 61 m track; 1 m offset; section 3 width w + 1 | [ISO sample](https://cdn.standards.iteh.ai/samples/57253/5e8cdcc7c2fe4c0c8fe6f1de8beb5dba/ISO-3888-2-2011.pdf) |
| ISO 4138 | Steady-state circular (understeer gradient) | Standard radius 100 m; 40 m recommended minimum, 30 m absolute | [ISO sample](https://cdn.standards.iteh.ai/samples/81710/e68b32975ef242b99ffbe8f6189c7d37/ISO-4138-2021.pdf) |
| UK magazine brake test (Motor/Autocar) | `brake_g_30mph` rows | Peak deceleration from 30 mph at stepped pedal loads, in neutral, one stop per load. A tyre-and-pedal limit, not a 100-0 distance | per test |
| Car and Driver skidpad | `skidpad_g` | 300 ft (91.4 m) diameter circle, steady state | [CD89](https://www.caranddriver.com/reviews/a60370315/1989-lada-samara-archive-test/) |

---

## Coverage matrix

Key:
- `P`: passport or factory figure (a ceiling or floor where the test is brake80 or coast50).
- `M`: measured on this car (`m` = low confidence only).
- `S`: measured on a sibling.
- `D`: derived from a measured stop.
- `R`: relative only.
- `·`: nothing found.

| car | 0-80 | 0-100 | top | brake100 | brake80 | skidpad_g | dlc | coast50 | turn_circle | understeer |
|---|---|---|---|---|---|---|---|---|---|---|
| kit_vaz2101 | M | P M | P M | D | P | · | · | · | P M | · |
| kit_vaz2102 | · | P | P M | · | P | · | · | · | P | · |
| kit_vaz2103 | M | P M | P M | · | P | · | · | · | P | · |
| kit_vaz2104 | · | P | P S | m | P | · | · | · | P S | · |
| kit_vaz2105 | · | P | P S | · | P | · | · | P | P S | · |
| kit_vaz2106 | M | P M S | P M S | · | P D | · | · | P | P | · |
| kit_vaz2107 | · | P S | P S | · | P | · | · | P | P | · |
| kit_vaz2108 | m | P M | P M S | S(D) | P | S | · | P | P | · |
| kit_vaz2109 | · | P M | P M | m | P | S | · | P | P | · |
| kit_vaz21099 | S | P S | P S | S(D) | P | S | · | P | P | · |
| kit_vaz2115 | · | P | P S | · | P | · | · | · | P | · |
| kit_vaz2110 | · | P | P M | M | P | · | · | · | P | · |
| kit_vaz2111 | · | P S | P m | S | P | · | · | · | P | · |
| kit_vaz2112 | · | P | P S | S | P | · | · | · | P | · |
| kit_vaz2121 | m S | P m S | P M | S | P S | · | S (refused) | · | P M S | · |
| kit_vaz2131 | · | P S | P | · | P | · | · | · | P | · |
| kit_vaz1111 | · | P S | P | · | P | · | · | P | P | · |
| kit_gaz24 | S | M S | P | · | P | · | · | S | P m | · |
| kit_gaz31029 | · | P(low) | P | · | P | · | · | · | P | · |
| kit_azlk2141 | · | P M S | P | · | P M | · | R | P | P | · |

## Gaps

1. **Lateral grip is nearly unsourced.** The only measured steady-state value for any car is CD89's 0.71 g (Samara 1500, 91 m skidpad, M+S tyres). The `lat` targets in `tools/reality.ts` (0.64–0.78 g) have no source; the Samara's 0.78 is above the one measurement. UK magazines of the period did not publish lateral g, and no ZR or AR skidpad figure was reachable.
2. **No understeer gradient, roll angle per g, or steering-step response for any car.** Only qualitative handling text exists. It agrees across sources: the classics understeer progressively; the Samaras understeer with heavy roll, lift the inside rear and tuck in on lift-off; the Niva is near-neutral on 1978 road tyres and snaps into front push on modern ones; the Oka pushes hard; the GAZ-24 has a large dead band, then oversteers on cross-plies. ГОСТ 31507's band (~1.1–7.3 deg/g, an inference) is the only numeric bracket.
3. **Lane change (переставка / ISO 3888): no absolute speed for any car.** There is only AR92's "5.3 km/h below the Croma" for the 2141, and ADAC refusing the Niva. The ГОСТ 31507 norms (83 km/h at S = 20 m for M1, 74 for off-road M1, −5 % at ≤ 1200 cm³) are modern pass marks, not Soviet-car results.
4. **Measured coastdown: none.** Factory floors exist for the 2105/06/07, 2108/09/099, Oka (500 m) and 2141 (550 m). There is no factory figure for the 2101, 2103, 2104, 2110 family, either Niva, the 1970 GAZ-24 or the 31029. A ZR 2107 test measured coastdowns but the reprint drops the numbers.
5. **100-0 braking from first-hand sources** exists only for the 2110 (ZR04 55.0, AR22 57.4) and the Niva 1.7 siblings (ADAC11 49.7, AB02 50.5–52.0, PB00 58.8). AR's 2104 (49.4) and 2109 (44.7) are forum quotes. The classics have only 30–60 mph stops (PM74 → 49 m derived) and 30 mph peak g: 0.95–1.00 for the 1200, 0.76 pedal-limited for the Riva. Measured mean decelerations cluster at 0.64–0.80 g without ABS.
6. **No measured figure at all:** GAZ-31029 (everything) and Oka (performance and braking). GAZ-24 braking is also missing.
7. **Tyres:** no per-tyre cornering stiffness, relaxation length or aligning torque for any period tyre (М-145, МИ-16/166, Я-370, БИ-391, ВлИ-10, ИД-195/ИД-220, И-151, 7.35-14, 135/80R12). Litvinov 1971 (*Управляемость и устойчивость автомобиля*), Kapralov's 1998 MAMI dissertation and the НИИШП reports are where they would be; none is online as text.
8. **Places to look offline:** ZR archive issues are page scans with no OCR, e.g. the 2141 test series of 1988–90 and the 1992 №10 Volga issue (https://www.zr.ru/archive/zr/1988/10/ispytyvaiet-za-ruliem). The AR 1990s comparison tests (2110, Samara, 2141) are paywalled. The Tekniikan Maailma / Tuulilasi originals are the source of the autowiki.fi snippets. Missing UK tests: the Autocar/Motor Niva hard-top 1978–80 and the Volga 1970s. Dutch 1972–74 tests of the GAZ-24 (Delpher).
9. **Source disagreements to settle before they are used as targets:**
   - Samara turning radius: AO gives 5.0 m by the outer wheel; reality.ts uses 5.2.
   - Oka turning radius: the manual gives 4.8 m, the catalogue 4.6.
   - 2131 0-100: the passport's 25 s and the game's `engine_niva_1700` (sourced to the VAZ-21213 1.7 carb, 58 kW, in `tools/reality.ts`) are the carburettor car. ZR's measured 19.8 s is the 1.7i (21214 injection), so it is a sibling for the game car, not a direct target.
   - VAZ-2101 brake80 ceiling: AP gives 43.2 m, RK 38 m.
