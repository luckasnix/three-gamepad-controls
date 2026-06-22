# Three.js Gamepad Controls

Gamepad support for [Three.js](https://threejs.org) controls, built on top of [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API).

## Architecture

<p align="center">
  <img src="./assets/architecture-diagram.webp" width="800" alt="Architecture diagram" />
</p>

## 📦 Installation

npm:

```bash
npm i three three-gamepad-controls
npm i -D @types/three # optional: for TypeScript projects
```

pnpm:

```bash
pnpm add three three-gamepad-controls
pnpm add -D @types/three # optional: for TypeScript projects
```

Yarn:

```bash
yarn add three three-gamepad-controls
yarn add -D @types/three # optional: for TypeScript projects
```

Deno:

When using `deno.json`, Deno stores dependencies in `imports` and does not separate `devDependencies`; `-D` only applies when writing to `package.json`.

```bash
# deno.json
deno add three @types/three three-gamepad-controls
```

```bash
# package.json
deno add --package-json three three-gamepad-controls
deno add --package-json -D @types/three # optional: for TypeScript projects
```

Bun:

```bash
bun add three three-gamepad-controls
bun add -d @types/three # optional: for TypeScript projects
```

## 📖 Documentation

- [Core](./docs/core.md) — The fundamental building blocks.
- [GamepadInput](./docs/gamepad-input.md) - Low-level reader for gamepad buttons, axes, sticks, and transitions.
- [GamepadControls](./docs/gamepad-controls.md) — Abstract base class for custom gamepad controls.
- [GamepadArcballControls](./docs/gamepad-arcball-controls.md) - Gamepad support for `ArcballControls`.
- [GamepadDragControls](./docs/gamepad-drag-controls.md) - Gamepad support for `DragControls`.
- [GamepadFirstPersonControls](./docs/gamepad-first-person-controls.md) — Gamepad support for `FirstPersonControls`.
- [GamepadFlyControls](./docs/gamepad-fly-controls.md) — Gamepad support for `FlyControls`.
- [GamepadMapControls](./docs/gamepad-map-controls.md) — Gamepad support for `MapControls`.
- [GamepadOrbitControls](./docs/gamepad-orbit-controls.md) — Gamepad support for `OrbitControls`.
- [GamepadPointerLockControls](./docs/gamepad-pointer-lock-controls.md) — Gamepad support for `PointerLockControls`.
- [GamepadTrackballControls](./docs/gamepad-trackball-controls.md) — Gamepad support for `TrackballControls`.
- [GamepadTransformControls](./docs/gamepad-transform-controls.md) — Gamepad support for `TransformControls`.
