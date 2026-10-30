# FilsPay logo

The team's logo (Bahrain-inspired "F" in a red circle, added 2026-10-30). Brand red `#B51931`.

| File | What it is | Used for |
|---|---|---|
| `filspay-logo-original.png` | The original file as designed (1774×887, white background) | Source; re-make the others from it |
| `filspay-logo-transparent.png` | Circle + "FilsPay", background removed, 1200 px wide | Wide places on a light background (the black "Pay" disappears on dark) |
| `filspay-mark-512.png` | The circle only, transparent, 512 px | Large icon, social preview |

Copies served by the apps (in each app's `public/`, so they ship in the web and admin builds):

| File | Size | Where |
|---|---|---|
| `favicon.png` | 64 px | Browser tab (both apps) |
| `apple-touch-icon.png` | 180 px, white background | Phone home-screen icon (both apps) |
| `filspay-mark.png` | 192 px | The logo next to "FilsPay" in headers and the sidebar |
| `filspay-logo.png` (web only) | 1200 px | Full logo where a wide light area needs it |

How they were made: cropped from the original with Python Pillow; the circle gets a smooth round
transparent edge; for the full logo only the white that touches the border is removed, so the white
"F" inside the circle stays.
