# Third-party code in Lightleak PvP

Everything else in this project (code, arenas, textures drawn at runtime, synthesised sounds, the icon) is original work by the author, including the parts carried over from Lightleak.

| Library | Version | Licence | Where |
| --- | --- | --- | --- |
| three.js | r128 | MIT, © 2010–2021 three.js authors | `vendor/three.min.js` |
| three.js post-processing (EffectComposer, SSAO, UnrealBloom, SMAA and their shaders, from `examples/js`) | r128 | MIT, © 2010–2021 three.js authors | `vendor/three-post.js`, bundled unchanged |
| Rapier (`@dimforge/rapier3d-compat`) | 0.21.0 | Apache-2.0, © Dimforge | `vendor/rapier.mjs`, licence text in `vendor/RAPIER-LICENSE.txt` |
| ws | 8 | MIT, © Einar Otto Stangvik and contributors | installed by npm; used by the server only |

The desktop build also bundles Electron (MIT) and Chromium, whose licences electron-builder includes in the packaged app.
