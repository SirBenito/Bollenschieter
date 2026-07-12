# Retro Glassmorphic Breaker

Een uitdagende brick breaker met een moderne glassmorphic UI, audio synthese via Tone.js, en soepele physics.

## Mappenstructuur
- `index.html`: De hoofdstructuur en UI elementen, klaar om direct te serveren.
- `css/style.css`: Alle styling en animaties overzichtelijk bij elkaar.
- `js/game.js`: De game engine. De `requestAnimationFrame` loop is nu framerate onafhankelijk (gebruikt delta time) en rendering is geoptimaliseerd.

## Verbeteringen (Versie 2.0)
- **Modulair**: Code is opgesplitst voor makkelijker beheer via Git.
- **Delta Time Engine**: Physics en animaties draaien nu vloeiend op alle refresh rates, in plaats van op basis van frames.
- **Render optimalisaties**: Dure canvas effecten (zoals overbodige `shadowBlur`) per frame zijn verminderd voor betere performance.
