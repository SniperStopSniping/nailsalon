# [1.28.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.27.2...v1.28.0) (2026-07-22)


### Bug Fixes

* **super-admin:** normalize configured phone so login accepts +1 or bare digits ([6201156](https://github.com/SniperStopSniping/nailsalon/commit/6201156416a48009e6699cf0a4d5a0fb6002f357))


### Features

* **super-admin:** allow salon URL changes ([07e882e](https://github.com/SniperStopSniping/nailsalon/commit/07e882ec2b2768024162416b1505be8595d3733c))

## [1.27.2](https://github.com/SniperStopSniping/nailsalon/compare/v1.27.1...v1.27.2) (2026-07-21)


### Bug Fixes

* **booking:** hide featured services during active search ([7015506](https://github.com/SniperStopSniping/nailsalon/commit/701550636e45d3fdaa084ea31b3ed2260f1c0dcc))

## [1.27.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.27.0...v1.27.1) (2026-07-21)


### Bug Fixes

* **admin:** restore Clerk context so the Add-ons tab loads ([f126105](https://github.com/SniperStopSniping/nailsalon/commit/f1261057ec41decbc825a3d8f0c7c47172ef4fd6))

# [1.27.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.26.0...v1.27.0) (2026-07-21)


### Bug Fixes

* **booking:** open the service step with nothing selected ([7a4b4f0](https://github.com/SniperStopSniping/nailsalon/commit/7a4b4f0ae61c696e50449de80f2242e928c35730))


### Features

* **booking:** use the Luster-branded combo art on every combo ([b6cb901](https://github.com/SniperStopSniping/nailsalon/commit/b6cb90191b33e0c8b886179d5ef9a605e0e13303))

# [1.26.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.25.0...v1.26.0) (2026-07-21)


### Bug Fixes

* **ci:** stop cutting a release from a failed CI run ([649a85c](https://github.com/SniperStopSniping/nailsalon/commit/649a85c60c195adfc5e4090a3d676fbc1201cb83))
* **e2e:** rebuild the fixture salon instead of failing forever without it ([7702695](https://github.com/SniperStopSniping/nailsalon/commit/7702695f62139590bcf7785821cf29f513df5aae))


### Features

* **booking:** use ultra-wide combo art sized to the card ([028680a](https://github.com/SniperStopSniping/nailsalon/commit/028680aef81c20c84ff6df482c05da85c449e5aa))

# [1.25.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.24.0...v1.25.0) (2026-07-21)


### Features

* **booking:** bare-nail art for no-colour services, better combo shots ([f3909b1](https://github.com/SniperStopSniping/nailsalon/commit/f3909b1fe5c50eda74a74d522b5c5e6332a216df))

# [1.24.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.23.1...v1.24.0) (2026-07-21)


### Bug Fixes

* **super-admin:** make permanent salon deletion work and stop partial destruction ([248a239](https://github.com/SniperStopSniping/nailsalon/commit/248a2390d5fa01d816b4618ef30cac8dfb2b6d54))
* **tooling:** stop the pre-commit hook generating and applying migrations ([549ca47](https://github.com/SniperStopSniping/nailsalon/commit/549ca4729e44bf45621a4af0c0fda3379dd85407))


### Features

* **booking:** give each service its own photo instead of one shared image ([88f353b](https://github.com/SniperStopSniping/nailsalon/commit/88f353bad6beea1092d25db977ffc2e81721fbaf))

## [1.23.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.23.0...v1.23.1) (2026-07-21)


### Bug Fixes

* **google-calendar:** stop a dropped connection from silently latching off ([09316fb](https://github.com/SniperStopSniping/nailsalon/commit/09316fb16609b32901408cb2736f33e02265e2b9))

# [1.23.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.22.1...v1.23.0) (2026-07-21)


### Bug Fixes

* **booking:** stop the client session silently rebinding a booking's identity ([ae9aa96](https://github.com/SniperStopSniping/nailsalon/commit/ae9aa965f94661a0b48b2349476c4ffb783313ed))


### Features

* **booking:** mark contact fields required and say when you're signed in ([ff2f25e](https://github.com/SniperStopSniping/nailsalon/commit/ff2f25e65081ba3a2111a75812036b9eeb8f98a3))

## [1.22.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.22.0...v1.22.1) (2026-07-20)


### Bug Fixes

* **manage:** let host-relative /manage links reach their route ([5cda4f2](https://github.com/SniperStopSniping/nailsalon/commit/5cda4f22432a7e69f9233ad4147db601b5f85865)), closes [#28](https://github.com/SniperStopSniping/nailsalon/issues/28)

# [1.22.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.21.0...v1.22.0) (2026-07-20)


### Bug Fixes

* **manage:** open the private appointment link and stop self-blocking reschedules ([3f7fe74](https://github.com/SniperStopSniping/nailsalon/commit/3f7fe74b684d492b130021e4d1aff4b0e56d5252))


### Features

* **reschedule:** unify the Smart Fit policy across both reschedule paths ([15c504f](https://github.com/SniperStopSniping/nailsalon/commit/15c504fb5a8127e0ee310dd24b13c95e2d50b263))

# [1.21.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.20.0...v1.21.0) (2026-07-20)


### Features

* **notifications:** email the salon on every booking, reschedule, cancellation ([2b433b2](https://github.com/SniperStopSniping/nailsalon/commit/2b433b2d8429a29ba07a5f241d5f450f271944c6))

# [1.20.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.19.1...v1.20.0) (2026-07-20)


### Bug Fixes

* **services:** hash the service id into add-on mapping row ids ([58a3b89](https://github.com/SniperStopSniping/nailsalon/commit/58a3b89ec99ea9070ee4c3d2f61a09167cac064e))
* **services:** transfer template keys safely and derive compat ids from the service row ([a4d4a51](https://github.com/SniperStopSniping/nailsalon/commit/a4d4a51d71e8dc2f84aebfd265cdfdeaa8b86d0f))


### Features

* **services:** canonical add-on compatibility, Luster Pedicure, category-leading order ([0557b63](https://github.com/SniperStopSniping/nailsalon/commit/0557b636b2ede1336f40a84f07f65e2209d94e67))
* **services:** complete canonical menu breadth, combos, and template-linking repair ([c747500](https://github.com/SniperStopSniping/nailsalon/commit/c747500c114e2778457ef4c6785ea45e38dd24e3))

## [1.19.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.19.0...v1.19.1) (2026-07-20)


### Bug Fixes

* **smart-fit:** replace ambiguous eligibility checkboxes with explicit modes ([95a6941](https://github.com/SniperStopSniping/nailsalon/commit/95a6941a1759a5d3d699d01dbb4620e523327b2c))
* **smart-fit:** stop the empty-state copy rendering in All mode ([f873c69](https://github.com/SniperStopSniping/nailsalon/commit/f873c6935656bb255af6a98b22a170d173e62a45))

# [1.19.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.18.4...v1.19.0) (2026-07-20)


### Bug Fixes

* **services:** reconcile availability and add-on compatibility ([d0395ed](https://github.com/SniperStopSniping/nailsalon/commit/d0395ed0a82bfe47765f6cf3f431a83191b13ba3))


### Features

* **services:** unify visible categories to Manicure/Pedicure/Combos + separate add-ons ([c54c1a7](https://github.com/SniperStopSniping/nailsalon/commit/c54c1a7f7f856f32c5d4d5675d553036dcf015b4))

## [1.18.4](https://github.com/SniperStopSniping/nailsalon/compare/v1.18.3...v1.18.4) (2026-07-20)


### Bug Fixes

* **luster:** approved Promotions → Shop → Learn hierarchy on the internal page ([f60849f](https://github.com/SniperStopSniping/nailsalon/commit/f60849fc8d83689570be720926a256fc3c0c0064))

## [1.18.3](https://github.com/SniperStopSniping/nailsalon/compare/v1.18.2...v1.18.3) (2026-07-20)


### Bug Fixes

* **admin:** render service detail in flow so the sticky chrome never hides the hero ([63d271e](https://github.com/SniperStopSniping/nailsalon/commit/63d271e3adb37829d25b37983f2420ead4c4e893))

## [1.18.2](https://github.com/SniperStopSniping/nailsalon/compare/v1.18.1...v1.18.2) (2026-07-20)


### Bug Fixes

* **admin:** obvious service edit + deactivate actions, inactive services stay ownable ([d622593](https://github.com/SniperStopSniping/nailsalon/commit/d62259352af7fa8f95bb1736732651ea4d199b22))
* **booking:** luster price authority + mobile service-page layout ([bc4a6eb](https://github.com/SniperStopSniping/nailsalon/commit/bc4a6ebd49d5a6446f59b8b4e012608cbf0b3b15))

## [1.18.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.18.0...v1.18.1) (2026-07-19)


### Bug Fixes

* **audit:** p9 audit — reschedule identity, salon-tz analytics, lifecycle hardening ([6d5e459](https://github.com/SniperStopSniping/nailsalon/commit/6d5e4591ba971698705f02acfe534f21f0fdde8d))

# [1.18.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.17.0...v1.18.0) (2026-07-19)


### Features

* **smart-fit:** reporting + attribution, identity-aware availability, date preservation (P7.5) ([b739e33](https://github.com/SniperStopSniping/nailsalon/commit/b739e33ff4bae596fee949e24e7b0f260773540b))

# [1.17.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.16.0...v1.17.0) (2026-07-19)


### Features

* **smart-fit:** owner settings UI, safe persistence, and permission enforcement (P7.4) ([f86192f](https://github.com/SniperStopSniping/nailsalon/commit/f86192faf6f23ac1b02e5c664a7f453999430e7d))

# [1.16.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.15.0...v1.16.0) (2026-07-19)


### Features

* **smart-fit:** customer booking UI — grouping, one nearby suggestion, dismissal, stale UX (P7.3) ([d1e63a1](https://github.com/SniperStopSniping/nailsalon/commit/d1e63a1159b0343617410518c2aa7a447b1592b6))

# [1.15.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.14.0...v1.15.0) (2026-07-19)


### Features

* **smart-fit:** wire availability, overlay, atomic confirmation, and persistence (P7.2) ([a733509](https://github.com/SniperStopSniping/nailsalon/commit/a733509797c308e41f06fd2d550166fa753c1d91))

# [1.14.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.13.1...v1.14.0) (2026-07-19)


### Features

* **smart-fit:** add config resolver and pure eligibility evaluator ([ee83eea](https://github.com/SniperStopSniping/nailsalon/commit/ee83eea9c6224eb8c138f6f5437ee287d696fa0e))

## [1.13.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.13.0...v1.13.1) (2026-07-19)


### Bug Fixes

* **checkout:** seed itemized checkout from the booked discount ([d9c2834](https://github.com/SniperStopSniping/nailsalon/commit/d9c2834bdf100850cd1655d46560a251f0e3142b))

# [1.13.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.12.1...v1.13.0) (2026-07-19)


### Features

* **admin:** add Integrations app to the More workspace ([43714ed](https://github.com/SniperStopSniping/nailsalon/commit/43714ed8981f65458cf2b8236094a60ba0c40d76))
* **checkout:** dedicated completion flow with items, photos, tax, and payments ([7d214f3](https://github.com/SniperStopSniping/nailsalon/commit/7d214f3f44e28f542eeb139b28684f6203d568e8))
* **clients:** client hub with overview, segments and reports ([f06472b](https://github.com/SniperStopSniping/nailsalon/commit/f06472b8cd41942d22aa0043010e5aec0a455fbd))
* **marketing:** honest Marketing workspace with assisted manual messaging ([7fc2035](https://github.com/SniperStopSniping/nailsalon/commit/7fc2035c0860f51d3e294361ac5404e0257a0282))
* **settings:** grouped Settings index with focused editing views ([efbaa39](https://github.com/SniperStopSniping/nailsalon/commit/efbaa3994baf6b4cb5cab1f567df4682d4d1c03f))

## [1.12.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.12.0...v1.12.1) (2026-07-19)


### Bug Fixes

* restore booking availability safely ([be2bab1](https://github.com/SniperStopSniping/nailsalon/commit/be2bab1506d0152c2a7a42e5e878ba97fbcc10ec))

# [1.12.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.11.0...v1.12.0) (2026-07-19)


### Bug Fixes

* **lint:** sort imports in salon services route ([6721148](https://github.com/SniperStopSniping/nailsalon/commit/672114863e7d62318a96a39ac9afb4baebb960d7))


### Features

* **services:** service library, starter menu, and template-driven onboarding ([d1fd382](https://github.com/SniperStopSniping/nailsalon/commit/d1fd38263cf2519d0ae180c032d0c86f7a484764))

# [1.11.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.10.4...v1.11.0) (2026-07-19)


### Bug Fixes

* **booking:** harden booking-category rollout after adversarial review ([64f6d55](https://github.com/SniperStopSniping/nailsalon/commit/64f6d557ccf65692e41a8faa00213ab63614a10f))


### Features

* **booking:** three-pill service categories and Luster-first featured services ([6f85c6c](https://github.com/SniperStopSniping/nailsalon/commit/6f85c6c3eb667b72a0fd81fe8c79ded92bed1321))

## [1.10.4](https://github.com/SniperStopSniping/nailsalon/compare/v1.10.3...v1.10.4) (2026-07-18)


### Bug Fixes

* repair public booking availability ([844557d](https://github.com/SniperStopSniping/nailsalon/commit/844557d0dd6b1530ffa1e3730157c279f8d1a24b))

## [1.10.3](https://github.com/SniperStopSniping/nailsalon/compare/v1.10.2...v1.10.3) (2026-07-17)


### Bug Fixes

* **google-events:** other Google events no longer block a conversion ([d707cfa](https://github.com/SniperStopSniping/nailsalon/commit/d707cfa36b2b81c9c2337e6c6014b63505de35fc))

## [1.10.2](https://github.com/SniperStopSniping/nailsalon/compare/v1.10.1...v1.10.2) (2026-07-17)


### Bug Fixes

* **google-events:** let conversions through the availability gate and make retry work ([05eabd7](https://github.com/SniperStopSniping/nailsalon/commit/05eabd7ed566307647686d8bf5a8d091a18bcec7))

## [1.10.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.10.0...v1.10.1) (2026-07-17)


### Bug Fixes

* handle retention campaign route params ([9c3eaca](https://github.com/SniperStopSniping/nailsalon/commit/9c3eaca8676397233c2f6f3117e117fcb4abdbba))

# [1.10.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.9.1...v1.10.0) (2026-07-17)


### Bug Fixes

* **e2e:** make the mobile footer spec runnable in every environment ([f25a5c2](https://github.com/SniperStopSniping/nailsalon/commit/f25a5c228d13b39ecef9af11390cd4a486946fc4))
* **retention:** close audited gaps in the retention assistant ([6703a0a](https://github.com/SniperStopSniping/nailsalon/commit/6703a0a3999225750bf0d4f2ee707c39bc2e4da2))


### Features

* add client retention and appointment tools ([30d70c4](https://github.com/SniperStopSniping/nailsalon/commit/30d70c40dc36e38da8020cb4dd052fd234f3700c))

## [1.9.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.9.0...v1.9.1) (2026-07-17)


### Bug Fixes

* **auth:** provide Clerk context on /api/appointments routes ([4c0b941](https://github.com/SniperStopSniping/nailsalon/commit/4c0b9415635a6de54c5b472cfdc207616842e235))

# [1.9.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.8.0...v1.9.0) (2026-07-17)


### Bug Fixes

* **appointments:** verified salon hint for multi-salon admin management ([ec0e3a0](https://github.com/SniperStopSniping/nailsalon/commit/ec0e3a0e268c315941d7bcfa9762e8780b79db74))


### Features

* **appointments:** shared useAppointmentActions hook + ConfirmDialog ([dbd3fef](https://github.com/SniperStopSniping/nailsalon/commit/dbd3fef24f9273b7b3aa343c19ed94249b860d0a))
* **calendar:** manage CRM appointments from the day detail panel ([2b52102](https://github.com/SniperStopSniping/nailsalon/commit/2b5210297d522e6f4fddaad63e29a97cdf774f11))
* **clients:** manage, change, cancel, and book appointments from the client profile ([69732a2](https://github.com/SniperStopSniping/nailsalon/commit/69732a2b058f0a4490010dd030bf7c5ece35c248))

# [1.8.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.7.1...v1.8.0) (2026-07-17)


### Bug Fixes

* **booking:** stop leaking appointment id/date in duplicate-booking 409 ([fd46a82](https://github.com/SniperStopSniping/nailsalon/commit/fd46a8227e87f353cce1cb422c43aa12d3d7b023))
* **recovery:** match by phone or email, send only to on-file address ([e0d7126](https://github.com/SniperStopSniping/nailsalon/commit/e0d71262a0fae487942766e37c89b5379ff84670))
* **recovery:** tighten types for settings and drizzle returning() ([e285cf2](https://github.com/SniperStopSniping/nailsalon/commit/e285cf2999375753379c74fe239a59fbb45e635a))


### Features

* **booking:** replace duplicate-booking dead end with recovery options ([e46659c](https://github.com/SniperStopSniping/nailsalon/commit/e46659cb867230a9cfe76733bd8a29e34bfd4e9a))
* **booking:** shared active-appointment matcher by contact ([0ad6fa3](https://github.com/SniperStopSniping/nailsalon/commit/0ad6fa3ba51873055919f442b40f735e82416799))
* **recovery:** find-booking accepts email or phone with honest result copy ([614b789](https://github.com/SniperStopSniping/nailsalon/commit/614b7899721bd5308f8fc2122a9f2f87c00b3653))

## [1.7.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.7.0...v1.7.1) (2026-07-17)


### Bug Fixes

* preserve Google event conversion sessions ([cae3770](https://github.com/SniperStopSniping/nailsalon/commit/cae37705f650c3512133142e010543f2a022fa83))

# [1.7.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.6.1...v1.7.0) (2026-07-17)


### Bug Fixes

* booking flow error recovery, salon timezone, contact preservation ([9b9c7b9](https://github.com/SniperStopSniping/nailsalon/commit/9b9c7b9d756424f4206e336ccba4bf480cebe891))
* mobile modal drag-vs-scroll, layout, and body scroll lock ([9d340dc](https://github.com/SniperStopSniping/nailsalon/commit/9d340dc78fe941c20800f9b6d1e7a2a828d151a0))
* prevent double-booking with database constraints and transaction guard ([9531b9b](https://github.com/SniperStopSniping/nailsalon/commit/9531b9b739e97b381381ecfb57adcb30c260fd7b))
* split multi-statement migrations for PGlite compatibility ([8210ca4](https://github.com/SniperStopSniping/nailsalon/commit/8210ca4e43a4d099704fbc697354974e27bd7512))
* stop cross-salon client identity disclosure in staff phone lookup ([ee23d24](https://github.com/SniperStopSniping/nailsalon/commit/ee23d24ce7c070df01a033e7358abb5c748ebf20))
* unify appointment status with canvas state and repair no-show tracking ([e83a6ef](https://github.com/SniperStopSniping/nailsalon/commit/e83a6ef54a4fd428b1822a0828597a9fc5cb3fc2))
* validated timezone picker, category visibility hint, remove dead modal ([56e708f](https://github.com/SniperStopSniping/nailsalon/commit/56e708f2b89ed5fa0b6e69ed3716457e5e7f3a1d))


### Features

* calendar overlap layout, visible now-line, and focused Today screen ([ea8aa61](https://github.com/SniperStopSniping/nailsalon/commit/ea8aa61b6fd5d78ae38b4641075d72273a4ec270))
* require an explicit blocking-calendar choice for Google Calendar readiness ([09b54a9](https://github.com/SniperStopSniping/nailsalon/commit/09b54a9b4d2f21d980a882702371c385a746df5e))
* surface client sensitivities and next-up marker on today's schedule ([71847bb](https://github.com/SniperStopSniping/nailsalon/commit/71847bb63980dcfb92efc06a7de7dbacbeee00ac))

## [1.6.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.6.0...v1.6.1) (2026-07-16)


### Bug Fixes

* prevent lost booking service taps ([8a6bfea](https://github.com/SniperStopSniping/nailsalon/commit/8a6bfea41e8d4d5bf8cca5156388f9c406a2f962))

# [1.6.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.5.1...v1.6.0) (2026-07-16)


### Bug Fixes

* owner identity relinking for multiple salons ([28969a7](https://github.com/SniperStopSniping/nailsalon/commit/28969a7194bbc1efbe05c432843cfe3a3037c619))
* repair owner signup and salon claims ([e3c1a8b](https://github.com/SniperStopSniping/nailsalon/commit/e3c1a8b59041df732681d21a2fd21d6bb1811972))
* restore owner dashboard Clerk context ([57ada1c](https://github.com/SniperStopSniping/nailsalon/commit/57ada1c207f272c6d5600b57b78e3982678be89c))
* route owner portal before locale middleware ([11dfd31](https://github.com/SniperStopSniping/nailsalon/commit/11dfd3111cab81967bc0ec176a7e7e57e0130278))
* satisfy release lint checks ([e60b759](https://github.com/SniperStopSniping/nailsalon/commit/e60b759d711261e0fa4ec25d8f74c542daec6156))
* supply CI integration secrets ([7662e42](https://github.com/SniperStopSniping/nailsalon/commit/7662e426114732dd07cc0a7d204e8f907f13bcd7))
* support owners with multiple salons ([e02076f](https://github.com/SniperStopSniping/nailsalon/commit/e02076fec7fd61fe37df8b17ef27ef589d6ad067))


### Features

* add branded Luster home gateway ([3352d81](https://github.com/SniperStopSniping/nailsalon/commit/3352d813b4ea5bac2ccfe4b2d39258b5e9a92a8f))
* add salon workspace and feature controls ([efcd3a0](https://github.com/SniperStopSniping/nailsalon/commit/efcd3a0050c426e46b75767d4f40365e73160150))
* add secure guest booking recovery ([f03e003](https://github.com/SniperStopSniping/nailsalon/commit/f03e003788bac990cc6beb5dd8089dd5d76734a0))
* add two-way calendar sync and email verification ([55a8c6f](https://github.com/SniperStopSniping/nailsalon/commit/55a8c6f27812d8246b3406b0b0c3d2dca5bf6bed))
* complete Luster nail-tech pilot experience ([10ec491](https://github.com/SniperStopSniping/nailsalon/commit/10ec4912b87e1a8a7cc0b446cadd07a9f50835fb))
* polish Luster workspace and fix feature sync ([f5c3e9d](https://github.com/SniperStopSniping/nailsalon/commit/f5c3e9d87b23049820c8c1c32eb3bc659c9c776d))
* repair Google calendar review and mobile schedule ([f0c37b1](https://github.com/SniperStopSniping/nailsalon/commit/f0c37b12b06fd604d10446dfdf99b39ad44697ed))

## [1.5.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.5.0...v1.5.1) (2026-07-10)


### Bug Fixes

* production-readiness cleanup for booking, staff, and admin surfaces ([6ef9999](https://github.com/SniperStopSniping/nailsalon/commit/6ef99990708c6ff45eeffea99d4e98c4c5271098))


### Reverts

* restore booking service light theme ([8552820](https://github.com/SniperStopSniping/nailsalon/commit/8552820215f8cc2a0a8e29b1f13bd139fb663733))

# [1.5.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.4.2...v1.5.0) (2026-07-06)


### Features

* darken booking service page ([cc8846d](https://github.com/SniperStopSniping/nailsalon/commit/cc8846d8c2d7d6fed0c98a06f6faf186b1169b80))

## [1.4.2](https://github.com/SniperStopSniping/nailsalon/compare/v1.4.1...v1.4.2) (2026-06-05)


### Bug Fixes

* resolve ci lint failures ([dd0758b](https://github.com/SniperStopSniping/nailsalon/commit/dd0758bd5eff3ae5078b1aa07e1b50e8d218c03d))

## [1.4.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.4.0...v1.4.1) (2026-06-05)


### Bug Fixes

* improve staff dashboard schedule and setup checks ([369e32e](https://github.com/SniperStopSniping/nailsalon/commit/369e32e4bafd67ded48c6ed295a40998eddd618b))

# [1.4.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.3.0...v1.4.0) (2026-03-25)


### Bug Fixes

* remove unused variables in BookTechClient ([d3b686f](https://github.com/SniperStopSniping/nailsalon/commit/d3b686fb86585919fe4a934b3d3b04123deb51a6))


### Features

* add booking flow enhancements, rewards system, and admin improvements ([bed2bbe](https://github.com/SniperStopSniping/nailsalon/commit/bed2bbe9af11583bf0845286fa57f6166b41be8a))

# [1.3.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.2.0...v1.3.0) (2025-12-13)


### Features

* **step-21e:** complete admin dashboard UI/UX overhaul ([0072b4b](https://github.com/SniperStopSniping/nailsalon/commit/0072b4bb015db06461092c5c4e8f1c1613e1ad71))

# [1.2.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.1.2...v1.2.0) (2025-12-13)


### Features

* **step-17:** Staff Phase 2 - Earnings, Time Off Requests, Notifications ([7c37435](https://github.com/SniperStopSniping/nailsalon/commit/7c3743590797b171b448ec80d0dca984b1957c73))

## [1.1.2](https://github.com/SniperStopSniping/nailsalon/compare/v1.1.1...v1.1.2) (2025-12-12)


### Bug Fixes

* wrap admin page in Suspense for useSearchParams ([b70351b](https://github.com/SniperStopSniping/nailsalon/commit/b70351b6326fb5f3458b63a755c4664e3603e41e))

## [1.1.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.1.0...v1.1.1) (2025-12-06)


### Bug Fixes

* resolve TypeScript type error in DB.ts for migratePg call ([0fcaf10](https://github.com/SniperStopSniping/nailsalon/commit/0fcaf1028aa61fe0f59908bbf6158b3581aa7e7b))

# [1.1.0](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.7...v1.1.0) (2025-12-06)


### Features

* Add referral system, gallery, staff appointments, and client preferences ([03bf3bf](https://github.com/SniperStopSniping/nailsalon/commit/03bf3bfcf045d74b8f8201ce36b5f63409a5c170))

## [1.0.7](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.6...v1.0.7) (2025-12-05)


### Bug Fixes

* add Suspense boundary and remove duplicate dashboard routes ([40e8d4f](https://github.com/SniperStopSniping/nailsalon/commit/40e8d4f5fcfada546160a957e5198f5dcaaeab6c))
* mark dynamic routes and add client directive to dashboard ([ecbaa50](https://github.com/SniperStopSniping/nailsalon/commit/ecbaa50dbcdee9982f1b3702d0fe8617a1f4de13))

## [1.0.6](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.5...v1.0.6) (2025-12-05)


### Bug Fixes

* add missing translations to French locale ([1e7cd88](https://github.com/SniperStopSniping/nailsalon/commit/1e7cd8822397b0ad6222043ca7e6745e406aa89d))

## [1.0.5](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.4...v1.0.5) (2025-12-05)


### Bug Fixes

* resolve all remaining TypeScript errors ([646fcef](https://github.com/SniperStopSniping/nailsalon/commit/646fcef9f4c79f36f05eb48eaf5b34e88db70aea))

## [1.0.4](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.3...v1.0.4) (2025-12-05)


### Bug Fixes

* add return to useEffects in BookServiceClient ([84d61e4](https://github.com/SniperStopSniping/nailsalon/commit/84d61e4d069cd261a3d9226650f5673c92b6b13d))

## [1.0.3](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.2...v1.0.3) (2025-12-05)


### Bug Fixes

* add return to name modal useEffect ([4d34ce8](https://github.com/SniperStopSniping/nailsalon/commit/4d34ce8e38119e1837b9cdad78d7530a55f7e147))

## [1.0.2](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.1...v1.0.2) (2025-12-05)


### Bug Fixes

* remove unused serviceIds variable ([1a726e2](https://github.com/SniperStopSniping/nailsalon/commit/1a726e2215ee2f391757d31f3f8ad2252bafcbe3))

## [1.0.1](https://github.com/SniperStopSniping/nailsalon/compare/v1.0.0...v1.0.1) (2025-12-05)


### Bug Fixes

* add explicit returns to useEffect callbacks for TypeScript ([78bee99](https://github.com/SniperStopSniping/nailsalon/commit/78bee99556a18259eadfcc6a0bbd4ff6a40c04f8))

# 1.0.0 (2025-12-04)


### Features

* add theme system, booking flow, SMS, database queries, and component updates ([0aaee7e](https://github.com/SniperStopSniping/nailsalon/commit/0aaee7ef4424a9a5d95e954e2bd58bd0477e4416))

## [1.7.6](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.7.5...v1.7.6) (2025-05-01)


### Bug Fixes

* update clerk to the latest version and update middlware to use await with auth ([2287192](https://github.com/ixartz/SaaS-Boilerplate/commit/2287192ddcf5b27a1f43ac2b7a992e065b990627))

## [1.7.5](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.7.4...v1.7.5) (2025-05-01)


### Bug Fixes

* clerk integration ([a9981cd](https://github.com/ixartz/SaaS-Boilerplate/commit/a9981cddcb4a0e2365066938533cd13225ce10a9))

## [1.7.4](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.7.3...v1.7.4) (2024-12-20)


### Bug Fixes

* remove custom framework configuration for i18n-ally vscode ([63f87fe](https://github.com/ixartz/SaaS-Boilerplate/commit/63f87feb3c0cb186c500ef9bed9cb50d7309224d))
* use new vitest vscode setting for preventing automatic opening of the test results ([2a2b945](https://github.com/ixartz/SaaS-Boilerplate/commit/2a2b945050f8d19883d6f2a8a6ec5ccf8b1f4173))

## [1.7.3](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.7.2...v1.7.3) (2024-11-07)


### Bug Fixes

* chnage dashboard index message button in french translation ([2f1dca8](https://github.com/ixartz/SaaS-Boilerplate/commit/2f1dca84cb05af52a959dd9630769ed661d8c69b))
* remove update deps github workflow, add separator in dashboard header ([fcf0fb4](https://github.com/ixartz/SaaS-Boilerplate/commit/fcf0fb48304ce45f6ceefa7d7eae11692655c749))

## [1.7.2](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.7.1...v1.7.2) (2024-10-17)


### Bug Fixes

* hide text in logo used in dashboard and add spacing for sign in button used in navbar ([a0eeda1](https://github.com/ixartz/SaaS-Boilerplate/commit/a0eeda12251551fd6a8e50222f46f3d47f0daad7))
* in dashboard, make the logo smaller, display without text ([f780727](https://github.com/ixartz/SaaS-Boilerplate/commit/f780727659fa58bbe6e4250dd63b2819369b7308))
* remove hydration error and unify with pro version 1.6.1 ([ea2d02b](https://github.com/ixartz/SaaS-Boilerplate/commit/ea2d02bd52de34c6cd2390d160ffe7f14319d5c3))

## [1.7.1](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.7.0...v1.7.1) (2024-10-04)


### Bug Fixes

* update logicalId in checkly configuration ([6e7a479](https://github.com/ixartz/SaaS-Boilerplate/commit/6e7a4795bff0b92d3681fadc36256aa957eb2613))

# [1.7.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.6.1...v1.7.0) (2024-10-04)


### Features

* update de Next.js Boilerplate v3.58.1 ([16aea65](https://github.com/ixartz/SaaS-Boilerplate/commit/16aea651ef93ed627e3bf310412cfd3651aeb3e4))

## [1.6.1](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.6.0...v1.6.1) (2024-08-31)


### Bug Fixes

* add demo banner at the top of the landing page ([09bf8c8](https://github.com/ixartz/SaaS-Boilerplate/commit/09bf8c8aba06eba1405fb0c20aeec23dfb732bb7))
* issue to build Next.js with Node.js 22.7, use 22.6 instead ([4acaef9](https://github.com/ixartz/SaaS-Boilerplate/commit/4acaef95edec3cd72a35405969ece9d55a2bb641))

# [1.6.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.5.0...v1.6.0) (2024-07-26)


### Features

* update to Next.js Boilerpalte v3.54 ([ae80843](https://github.com/ixartz/SaaS-Boilerplate/commit/ae808433e50d6889559fff382d4b9c595d34e04f))

# [1.5.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.4.0...v1.5.0) (2024-06-05)


### Features

* update to Drizzle Kit 0.22, Storybook 8, migrate to vitest ([c2f19cd](https://github.com/ixartz/SaaS-Boilerplate/commit/c2f19cd8e9dc983e0ad799da2474610b57b88f50))

# [1.4.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.3.0...v1.4.0) (2024-05-17)


### Features

* vscode jest open test result view on test fails and add unauthenticatedUrl in clerk middleware ([3cfcb6b](https://github.com/ixartz/SaaS-Boilerplate/commit/3cfcb6b00d91dabcb00cbf8eb2d8be6533ff672e))

# [1.3.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.2.1...v1.3.0) (2024-05-16)


### Features

* add custom framework for i18n-ally and replace deprecated Jest VSCode configuration ([a9889dc](https://github.com/ixartz/SaaS-Boilerplate/commit/a9889dc129aeeba8801f4f47e54d46e9515e6a29))
* create dashboard header component ([f3dc1da](https://github.com/ixartz/SaaS-Boilerplate/commit/f3dc1da451ab8dce90d111fe4bbc8d4bc99e4b01))
* don't redirect to organization-selection if the user is already on this page ([87da997](https://github.com/ixartz/SaaS-Boilerplate/commit/87da997b853fd9dcb7992107d2cb206817258910))
* make the landing page responsive and works on mobile ([27e908a](https://github.com/ixartz/SaaS-Boilerplate/commit/27e908a735ea13845a6cc42acc12e6cae3232b9b))
* make user dashboard responsive ([f88c9dd](https://github.com/ixartz/SaaS-Boilerplate/commit/f88c9dd5ac51339d37d1d010e5b16c7776c73b8d))
* migreate Env.mjs file to Env.ts ([2e6ff12](https://github.com/ixartz/SaaS-Boilerplate/commit/2e6ff124dcc10a3c12cac672cbb82ec4000dc60c))
* remove next-sitemap and use the native Next.js sitemap/robots.txt ([75c9751](https://github.com/ixartz/SaaS-Boilerplate/commit/75c9751d607b8a6a269d08667f7d9900797ff38a))
* upgrade to Clerk v5 and use Clerk's Core 2 ([a92cef0](https://github.com/ixartz/SaaS-Boilerplate/commit/a92cef026b5c85a703f707aabf42d28a16f07054))
* use Node.js version 20 and 22 in GitHub Actions ([226b5e9](https://github.com/ixartz/SaaS-Boilerplate/commit/226b5e970f46bfcd384ca60cd63ebb15516eca21))

## [1.2.1](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.2.0...v1.2.1) (2024-03-30)


### Bug Fixes

* redirect user to the landing page after signing out ([6e9f383](https://github.com/ixartz/SaaS-Boilerplate/commit/6e9f3839daaab56dd3cf3e57287ea0f3862b8588))

# [1.2.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.1.0...v1.2.0) (2024-03-29)


### Features

* add link to the GitHub repository ([ed42176](https://github.com/ixartz/SaaS-Boilerplate/commit/ed42176bdc2776cacc2c939bac45914a1ede8e51))

# [1.1.0](https://github.com/ixartz/SaaS-Boilerplate/compare/v1.0.0...v1.1.0) (2024-03-29)


### Features

* launching SaaS boilerplate for helping developers to build SaaS quickly ([7f24661](https://github.com/ixartz/SaaS-Boilerplate/commit/7f246618791e3a731347dffc694a52fa90b1152a))

# 1.0.0 (2024-03-29)


### Features

* initial commit ([d58e1d9](https://github.com/ixartz/SaaS-Boilerplate/commit/d58e1d97e11baa0a756bd038332eb84daf5a8327))
