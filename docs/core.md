# Core

This module provides the fundamental building blocks used throughout the library to standardize gamepad inputs.

By directly implementing the [W3C Standard Gamepad mapping](https://www.w3.org/TR/gamepad/#dfn-standard-gamepad), these essential utilities serve as the foundation for both internal library mechanics and everyday developer use, allowing you to seamlessly handle common controller interactions in your [Three.js](https://threejs.org) projects.

Most modern controllers (PlayStation, Xbox, Switch Pro) follow this layout when connected to a browser.

## Constants

### `GAMEPAD_BUTTON`

An object containing the index mappings for all standard gamepad buttons.

Using this constant eliminates magic numbers from your codebase, making your input logic instantly readable and much easier to maintain.

| Key | Index | Description |
| --- | --- | --- |
| `South` | 0 | Bottom button in right cluster. |
| `East` | 1 | Right button in right cluster. |
| `West` | 2 | Left button in right cluster. |
| `North` | 3 | Top button in right cluster. |
| `LeftShoulder` | 4 | Top left front button. |
| `RightShoulder` | 5 | Top right front button. |
| `LeftTrigger` | 6 | Bottom left front button. |
| `RightTrigger` | 7 | Bottom right front button. |
| `Select` | 8 | Left button in center cluster. |
| `Start` | 9 | Right button in center cluster. |
| `LeftStick` | 10 | Left stick pressed button. |
| `RightStick` | 11 | Right stick pressed button. |
| `DPadUp` | 12 | Top button in left cluster. |
| `DPadDown` | 13 | Bottom button in left cluster. |
| `DPadLeft` | 14 | Left button in left cluster. |
| `DPadRight` | 15 | Right button in left cluster. |
| `Home` | 16 | Center button in center cluster. |

### `GAMEPAD_AXIS`

An object containing the index mappings for standard analog stick axes.

Similar to the button mappings, this constant allows you to reference axes by clear names rather than relying on obscure magic numbers, ensuring your code remains clean and self-documenting.

| Key | Index | Description |
| --- | --- | --- |
| `LeftX` | 0 | Horizontal axis for left stick. |
| `LeftY` | 1 | Vertical axis for left stick. |
| `RightX` | 2 | Horizontal axis for right stick. |
| `RightY` | 3  | Vertical axis for right stick. |

## Types

| Type | Description |
| --- | --- |
| `GamepadButtonKey` | Represents the keys of the `GAMEPAD_BUTTON` object. |
| `GamepadButtonValue` | Represents the values of the `GAMEPAD_BUTTON` object. |
| `GamepadAxisKey` | Represents the keys of the `GAMEPAD_AXIS` object. |
| `GamepadAxisValue` | Represents the values of the `GAMEPAD_AXIS` object. |
